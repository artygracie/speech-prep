// Anonymous demo report — the rehearsal loop with nothing persisted.
//
// Takes one recording of a fixed sample speech and returns a real coach
// report. No auth, no session row, no storage object, no ai_reports insert.
// The audio lives in memory for the duration of the request and is never
// written down.
//
// The script is NOT an input. It's the server-side sample, which means an
// unauthenticated endpoint never feeds caller-supplied prose into a model
// call, and the only thing the caller controls is the audio.
//
// Why a separate route rather than a demo branch inside /api/coach/run:
// that route is built around a session id and does ownership checks,
// entitlement debits, and idempotency against ai_reports — every one of
// which is meaningless without a user. Sharing the *libraries* (alignment,
// ai-coach) and not the plumbing keeps the authed path unchanged.
//
// Spend guards live in @/lib/demo-limits.

import {
  buildDiff,
  coalesceDiff,
  computeSectionMetrics,
  type ScriptSection,
} from "@/lib/alignment";
import { generateCoachReport, type CoachInput } from "@/lib/ai-coach";
import { DeepgramUnavailableError, transcribeBuffer } from "@/lib/deepgram";
import { MAX_AUDIO_BYTES } from "@/lib/demo-config";
import { allowIp, clientIp, withinGlobalDailyCap } from "@/lib/demo-limits";
import {
  SAMPLE_OCCASION,
  SAMPLE_SECTIONS,
  SAMPLE_TITLE,
} from "@/lib/demo-sample";
import { track } from "@/lib/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Deepgram (a few seconds) plus a Sonnet coach call (10-30s). Same
// headroom as /api/coach/run.
export const maxDuration = 60;

const ALLOWED_MIME = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
];

// Stable ids so the client can match report entries to the section list it
// already has. Position doubles as the id because the sample never changes.
const sectionId = (i: number) => `demo-${i}`;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req);
  if (!allowIp(ip)) {
    return json({ error: "rate_limited", message: "Too many demo runs. Try again later." }, 429);
  }
  if (!(await withinGlobalDailyCap())) {
    return json(
      { error: "busy", message: "The demo is at capacity today. Sign up for a free rehearsal." },
      503,
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "bad_request", message: "Expected multipart form data." }, 400);
  }

  const anonId = String(form.get("anon_id") ?? "").trim() || null;
  const audio = form.get("audio");

  if (!(audio instanceof Blob)) {
    return json({ error: "no_audio", message: "No recording was attached." }, 400);
  }
  if (audio.size === 0) {
    return json({ error: "empty_audio", message: "That recording was empty." }, 400);
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return json({ error: "audio_too_large", message: "That recording is too long for the demo." }, 413);
  }

  // Deepgram needs a concrete content type. MediaRecorder reports things
  // like "audio/webm;codecs=opus" — keep the base type, drop the codecs.
  const rawType = (audio.type || "audio/webm").split(";")[0]!.trim();
  const contentType = ALLOWED_MIME.includes(rawType) ? rawType : "audio/webm";

  const sections: ScriptSection[] = SAMPLE_SECTIONS.map((s, i) => ({
    id: sectionId(i),
    body: s.body,
    targetSeconds: s.target_seconds,
    position: i,
  }));

  try {
    const buf = await audio.arrayBuffer();
    const { text, words } = await transcribeBuffer(buf, contentType);

    if (words.length === 0) {
      return json(
        {
          error: "no_speech",
          message: "We couldn't hear any speech in that recording. Check your mic and try again.",
        },
        422,
      );
    }

    const metrics = computeSectionMetrics(sections, words);
    const diff = coalesceDiff(buildDiff(sections, words));

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
      // Script-in-hand: they're reading it off the screen, so the coach
      // should critique delivery, not memorisation.
      mode: "with-script",
      speechTitle: SAMPLE_TITLE,
      occasion: SAMPLE_OCCASION,
      sections: SAMPLE_SECTIONS.map((s, i) => ({
        id: sectionId(i),
        name: s.name,
        body: s.body,
        targetSeconds: s.target_seconds,
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
      transcriptText: text,
      words,
      tags: [],
      diffCounts: { matched, paraphrased, skipped, improvised },
    };

    const report = await generateCoachReport(input);
    if (!report) {
      console.error("[demo/report] coach returned null", {
        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
        wordCount: words.length,
      });
      return json({ error: "coach_unavailable", message: "The coach is unavailable right now." }, 503);
    }

    await track(
      "demo_report",
      {
        word_count: words.length,
        duration_ms: words.length ? words[words.length - 1]!.endMs : 0,
        matched,
        skipped,
      },
      { anonId },
    );

    // Deliberately no ai_reports insert: nothing about this run is stored.
    return json({ report, transcriptText: text, metrics }, 200);
  } catch (err) {
    if (err instanceof DeepgramUnavailableError) {
      console.error("[demo/report] DEEPGRAM_API_KEY is not set");
      return json({ error: "transcription_unavailable", message: "Transcription is unavailable." }, 503);
    }
    console.error("[demo/report] failed:", err);
    return json({ error: "internal", message: "Something went wrong. Try again." }, 500);
  }
}
