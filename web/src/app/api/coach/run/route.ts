// POST /api/coach/run
//
// Generates an ai_reports row for a session. Idempotent — if a report
// already exists, this is a no-op and returns 200.
//
// Triggered by (a) the transcribe edge function once the transcript +
// section metrics have landed, and (b) the AutoRefresh / wake-handler
// flow as a belt-and-braces retry. Auth model: the caller must own the
// session (we read the auth user from the request cookie via the SSR
// client), or be a privileged pipeline caller passing the shared
// secret in the `x-coach-trigger` header (COACH_TRIGGER_SECRET —
// compared timing-safe).

import { timingSafeEqual } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildDiff,
  coalesceDiff,
  computeSectionMetrics,
  type ScriptSection,
  type TranscriptWord,
} from "@/lib/alignment";
import {
  generateCoachReport,
  type CoachInput,
  type CoachLiveTag,
} from "@/lib/ai-coach";
import { resolveMode } from "@/lib/modes";

// Constant-time check of the pipeline trigger header. False when the
// secret isn't configured — the header path is then simply disabled.
function isPipelineCaller(req: Request): boolean {
  const secret = process.env.COACH_TRIGGER_SECRET;
  const header = req.headers.get("x-coach-trigger");
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sonnet coach calls run 10-30s comfortably; the Vercel default of
// 10s for non-paid tiers (and 15s on Hobby) silently kills them. 60s
// is enough headroom for slow takes without holding the function open
// when something's truly stuck.
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  let sessionId: string | null = null;
  try {
    const body = await req.json();
    sessionId = body?.session_id ?? null;
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!sessionId) return new Response("missing session_id", { status: 400 });

  // Authorize. Either a logged-in user who owns the session, or a
  // pipeline caller with the shared trigger secret (the transcribe
  // edge function, or a future cron worker draining stuck sessions).
  const isInternal = isPipelineCaller(req);

  const supabase = await createClient();
  let userId: string | null = null;
  if (!isInternal) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return new Response("unauthorized", { status: 401 });
    userId = user.id;
  }

  // Use the admin client for cross-user writes after we've verified
  // ownership, so we're consistent with how the existing transcribe
  // pipeline writes ai_reports rows.
  const admin = createAdminClient();

  // Load session + verify ownership (RLS-bypass admin client is fine
  // because we're checking user_id explicitly).
  const { data: session, error: sessErr } = await admin
    .from("sessions")
    .select(
      "id, user_id, speech_id, script_version_id, status, mode, tags",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (sessErr || !session) {
    console.error("[coach/run] session not found", { sessionId, sessErr });
    return new Response("not found", { status: 404 });
  }
  if (!isInternal && session.user_id !== userId) {
    console.error("[coach/run] forbidden", { sessionId, userId, owner: session.user_id });
    return new Response("forbidden", { status: 403 });
  }

  // Idempotent: if a report already exists, we're done. Don't waste a
  // model call. Caller can DELETE the row to force a re-run if needed.
  const { data: existing } = await admin
    .from("ai_reports")
    .select("id")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (existing) return new Response("already exists", { status: 200 });

  // Need the transcript and the section bodies to coach against.
  const { data: transcript } = await admin
    .from("transcripts")
    .select("text, words")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (
    !transcript?.words ||
    !Array.isArray(transcript.words) ||
    transcript.words.length === 0
  ) {
    console.error("[coach/run] transcript not ready", { sessionId });
    return new Response("transcript not ready", { status: 409 });
  }

  const { data: secRows } = await admin
    .from("sections")
    .select("id, position, name, target_seconds, body")
    .eq("script_version_id", session.script_version_id)
    .order("position", { ascending: true });
  if (!secRows || secRows.length === 0) {
    console.error("[coach/run] script has no sections", {
      sessionId,
      scriptVersionId: session.script_version_id,
    });
    return new Response("script has no sections", { status: 409 });
  }

  const { data: speech } = await admin
    .from("speeches")
    .select("title, occasion")
    .eq("id", session.speech_id)
    .maybeSingle();

  const sections: ScriptSection[] = secRows.map((r) => ({
    id: r.id,
    body: r.body ?? "",
    targetSeconds: r.target_seconds ?? 0,
    position: r.position,
  }));
  const words = transcript.words as unknown as TranscriptWord[];
  const metrics = computeSectionMetrics(sections, words);
  const diff = coalesceDiff(buildDiff(sections, words));

  // Diff counts the coach uses to size its critique without having to
  // reason from raw rows.
  let matched = 0,
    paraphrased = 0,
    skipped = 0,
    improvised = 0;
  for (const r of diff) {
    if (r.kind === "match") matched += 1;
    else if (r.kind === "paraphrase") paraphrased += 1;
    else if (r.kind === "skipped") skipped += 1;
    else if (r.kind === "improv") improvised += 1;
  }

  // Note: the transcript words go in alongside the text. The old edge
  // coach fed the model only the alignment diff — which is empty when
  // the script sections have no bodies — and that's how "no audio was
  // recorded" reports got written over real transcripts. The unified
  // coach always sees the words (and ai-coach.ts enforces it).
  const input: CoachInput = {
    mode: resolveMode(session.mode),
    speechTitle: speech?.title ?? "Untitled",
    occasion: speech?.occasion ?? null,
    sections: secRows.map((r) => ({
      id: r.id,
      name: r.name,
      body: r.body ?? "",
      targetSeconds: r.target_seconds ?? 0,
    })),
    metrics: metrics.map((m) => ({
      sectionId: m.sectionId,
      actualSeconds: m.actualSeconds,
      deltaSeconds: m.deltaSeconds,
      wpm: m.wpm,
      fillerCount: m.fillerCount,
      pauseMsTotal: m.pauseMsTotal,
      wordStartIdx: m.wordStartIdx,
      wordEndIdx: m.wordEndIdx,
    })),
    transcriptText: (transcript.text as string | null) ?? "",
    words,
    tags: (Array.isArray(session.tags) ? session.tags : []) as CoachLiveTag[],
    diffCounts: { matched, paraphrased, skipped, improvised },
  };

  const report = await generateCoachReport(input);
  if (!report) {
    console.error("[coach/run] coach generation returned null", {
      sessionId,
      hasApiKey: !!process.env.ANTHROPIC_API_KEY,
      sectionCount: secRows.length,
      transcriptWords: (transcript.words as unknown[]).length,
    });
    return new Response("coach unavailable", { status: 503 });
  }

  // Validate that suggested-edit "before" strings actually appear in
  // the right section body. If they don't, the apply-suggestions code
  // would silently no-op, so we drop them rather than store fiction.
  const sectionBodyById = new Map<string, string>(
    secRows.map((r) => [r.id, r.body ?? ""]),
  );
  const validEdits = report.suggested_edits.filter((e) => {
    const body = sectionBodyById.get(e.section_id);
    if (!body) return false;
    if (e.kind === "adopt") return !!e.after;
    if (e.kind === "drill") return true; // drill has no before/after; targets a section
    if (!e.before) return false;
    return body.toLowerCase().includes(e.before.toLowerCase());
  });

  const { error: insErr } = await admin.from("ai_reports").insert({
    session_id: sessionId,
    user_id: session.user_id,
    headline: report.headline,
    summary: report.summary,
    per_section: report.per_section,
    suggested_edits: validEdits,
    prompt_version: report.prompt_version,
    input_tokens: report.input_tokens,
    output_tokens: report.output_tokens,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    raw: { dropped_edits: report.suggested_edits.length - validEdits.length },
  });
  if (insErr) {
    console.error("[coach/run] insert failed", {
      sessionId,
      error: insErr.message,
      details: insErr.details,
      hint: insErr.hint,
    });
    return new Response(`insert failed: ${insErr.message}`, { status: 500 });
  }

  console.log("[coach/run] success", {
    sessionId,
    suggestedEdits: validEdits.length,
    droppedEdits: report.suggested_edits.length - validEdits.length,
    inputTokens: report.input_tokens,
    outputTokens: report.output_tokens,
  });
  return new Response("ok");
}
