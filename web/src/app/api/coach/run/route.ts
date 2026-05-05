// POST /api/coach/run
//
// Generates an ai_reports row for a session. Idempotent — if a report
// already exists, this is a no-op and returns 200.
//
// Triggered by the existing AutoRefresh / wake-handler flow once the
// transcript has landed. Auth model: the caller must own the session
// (we read the auth user from the request cookie via the SSR client),
// or be a privileged server caller passing INTERNAL_COACH_SECRET. In
// practice it's the user themselves clicking through to the report
// page that fires this — same shape as /api/sessions/wake.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildDiff,
  coalesceDiff,
  computeSectionMetrics,
  type ScriptSection,
  type TranscriptWord,
} from "@/lib/alignment";
import { generateCoachReport, type CoachInput } from "@/lib/ai-coach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let sessionId: string | null = null;
  try {
    const body = await req.json();
    sessionId = body?.session_id ?? null;
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!sessionId) return new Response("missing session_id", { status: 400 });

  // Authorize. Either a logged-in user who owns the session, or an
  // internal caller with the shared secret (e.g. a future cron worker
  // draining stuck sessions).
  const internalSecret = req.headers.get("x-internal-secret");
  const isInternal =
    !!process.env.INTERNAL_COACH_SECRET &&
    internalSecret === process.env.INTERNAL_COACH_SECRET;

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
      "id, user_id, speech_id, script_version_id, status, mode",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (sessErr || !session) return new Response("not found", { status: 404 });
  if (!isInternal && session.user_id !== userId) {
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
    return new Response("transcript not ready", { status: 409 });
  }

  const { data: secRows } = await admin
    .from("sections")
    .select("id, position, name, target_seconds, body")
    .eq("script_version_id", session.script_version_id)
    .order("position", { ascending: true });
  if (!secRows || secRows.length === 0) {
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

  const input: CoachInput = {
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
    })),
    transcriptText: (transcript.text as string | null) ?? "",
    diffCounts: { matched, paraphrased, skipped, improvised },
  };

  const report = await generateCoachReport(input);
  if (!report) {
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
    if (!e.before) return false;
    return body.toLowerCase().includes(e.before.toLowerCase());
  });

  const { error: insErr } = await admin.from("ai_reports").insert({
    session_id: sessionId,
    user_id: session.user_id,
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
    return new Response(`insert failed: ${insErr.message}`, { status: 500 });
  }

  return new Response("ok");
}
