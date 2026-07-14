// coach — edge function (v7).
//
// Input:  { session_id: string }
// Effect: produces an ai_reports row with a structured coaching summary,
//         per-section notes, and concrete suggested_edits.
//
// v7 adds audio-derived signals to the prompt:
//   - pause distribution per section (counts of >0.5s, >1s, >2s gaps)
//   - longest pause within each section (with timestamp)
//   - the gap between the last word of section N and the first word of
//     section N+1 (transition pacing)
//   - filler-word timestamps so the coach can pinpoint stumbles
//   - WPM variance per section (steady delivery vs. choppy)
//
// All of these are derived deterministically from word-level timings
// Deepgram already emits, so no additional API spend.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-4-6";
const PROMPT_VERSION = 2;

function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log("[coach]", ...args);
}
function logError(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.error("[coach]", ...args);
}

// ============================================================
// Types
// ============================================================
type PerSectionNote = {
  section_id: string;
  headline: string;
  what_landed: string;
  what_to_work_on: string;
};
type SuggestedEdit = {
  id: string;
  kind: "cut" | "adopt" | "rephrase";
  section_id: string;
  before?: string;
  after?: string;
  reason: string;
};
type CoachReport = {
  summary: string;
  per_section: PerSectionNote[];
  suggested_edits: SuggestedEdit[];
};

type TranscriptWord = {
  word: string;
  startMs: number;
  endMs: number;
  isFiller?: boolean;
  confidence?: number;
};

const FILLERS = new Set(["uh", "um", "umm", "uhh", "er", "erm", "ah", "like"]);

function normalise(raw: string): string {
  return raw.toLowerCase().replace(/[‘’']/g, "").replace(/[^a-z0-9]+/g, "");
}

// ============================================================
// Audio signals — derived from word-level timings
// ============================================================

type AudioSignal = {
  section_id: string;
  section_name: string;
  // Pause buckets: count of inter-word gaps in each band (in seconds).
  // Excludes the gap before the first word.
  pauses_500ms: number;
  pauses_1s: number;
  pauses_2s: number;
  // Longest single pause (gap before *some* word in this section).
  longest_pause_ms: number;
  longest_pause_at_ms: number; // wall-clock timestamp from session start
  // Words per minute computed across each ~10s window in the section,
  // then we summarize variance: stdev / mean. Higher = choppier.
  wpm_variance_ratio: number | null;
  // Filler word timestamps (truncated to first 5).
  filler_examples: { word: string; atMs: number }[];
  // Transition: gap between last word of this section and first of
  // the next section. -1 if this is the last section.
  transition_gap_ms: number;
};

function computeAudioSignals(
  sections: Array<{ id: string; name: string; body: string }>,
  metricsRows: Array<{
    section_id: string;
    word_start_idx: number | null;
    word_end_idx: number | null;
  }>,
  words: TranscriptWord[],
): AudioSignal[] {
  const out: AudioSignal[] = [];
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const m = metricsRows.find((x) => x.section_id === sec.id);
    if (!m || m.word_start_idx == null || m.word_end_idx == null) {
      // No timing for this section — emit a stub so per-section ordering
      // stays aligned in the prompt.
      out.push({
        section_id: sec.id,
        section_name: sec.name,
        pauses_500ms: 0,
        pauses_1s: 0,
        pauses_2s: 0,
        longest_pause_ms: 0,
        longest_pause_at_ms: 0,
        wpm_variance_ratio: null,
        filler_examples: [],
        transition_gap_ms: -1,
      });
      continue;
    }

    const start = m.word_start_idx;
    const end = Math.min(words.length - 1, m.word_end_idx);
    const slice = words.slice(start, end + 1);

    // ---------- Pause distribution ----------
    let p500 = 0, p1k = 0, p2k = 0;
    let longestMs = 0;
    let longestAt = 0;
    for (let i = 1; i < slice.length; i++) {
      const gap = slice[i].startMs - slice[i - 1].endMs;
      if (gap >= 500) p500++;
      if (gap >= 1000) p1k++;
      if (gap >= 2000) p2k++;
      if (gap > longestMs) {
        longestMs = gap;
        longestAt = slice[i - 1].endMs;
      }
    }

    // ---------- WPM variance per ~10s window ----------
    const sectionStartMs = slice[0]?.startMs ?? 0;
    const sectionEndMs = slice[slice.length - 1]?.endMs ?? sectionStartMs;
    const dur = sectionEndMs - sectionStartMs;
    let wpmVar: number | null = null;
    if (dur >= 5000 && slice.length >= 8) {
      const windows: number[] = [];
      const winSize = 10_000;
      for (let t = sectionStartMs; t < sectionEndMs; t += winSize) {
        const winEnd = Math.min(sectionEndMs, t + winSize);
        const winWords = slice.filter((w) => w.startMs >= t && w.startMs < winEnd).length;
        const winSec = (winEnd - t) / 1000;
        if (winSec >= 3) windows.push((winWords / winSec) * 60);
      }
      if (windows.length >= 2) {
        const mean = windows.reduce((a, b) => a + b, 0) / windows.length;
        if (mean > 0) {
          const variance =
            windows.reduce((a, b) => a + (b - mean) ** 2, 0) / windows.length;
          const stdev = Math.sqrt(variance);
          wpmVar = +(stdev / mean).toFixed(2);
        }
      }
    }

    // ---------- Filler examples ----------
    const fillerExamples: { word: string; atMs: number }[] = [];
    for (const w of slice) {
      if (fillerExamples.length >= 5) break;
      const isFiller =
        w.isFiller === true || FILLERS.has(normalise(w.word));
      if (isFiller) fillerExamples.push({ word: w.word, atMs: w.startMs });
    }

    // ---------- Transition gap ----------
    let transitionGap = -1;
    if (si < sections.length - 1) {
      const nextSec = sections[si + 1];
      const nextM = metricsRows.find((x) => x.section_id === nextSec.id);
      if (nextM?.word_start_idx != null && words[nextM.word_start_idx]) {
        const lastEnd = slice[slice.length - 1]?.endMs ?? 0;
        transitionGap = words[nextM.word_start_idx].startMs - lastEnd;
        if (transitionGap < 0) transitionGap = 0;
      }
    }

    out.push({
      section_id: sec.id,
      section_name: sec.name,
      pauses_500ms: p500,
      pauses_1s: p1k,
      pauses_2s: p2k,
      longest_pause_ms: longestMs,
      longest_pause_at_ms: longestAt,
      wpm_variance_ratio: wpmVar,
      filler_examples: fillerExamples,
      transition_gap_ms: transitionGap,
    });
  }
  return out;
}

// ============================================================
// Prompt builders
// ============================================================

function buildSystemBlocks(
  speechTitle: string,
  occasion: string | null,
  sections: Array<{ id: string; name: string; target_seconds: number; body: string }>,
) {
  const sectionsBlock = sections
    .map(
      (s, i) =>
        `[${i + 1}] section_id=${s.id}\nname=${s.name}\ntarget_seconds=${s.target_seconds}\nbody:\n${s.body}`,
    )
    .join("\n\n---\n\n");

  return [
    {
      type: "text",
      text:
`You are a speech coach. You're reviewing a single rehearsal recording against the speaker's script. Your job is to give specific, useful, non-generic feedback that tells the speaker what to do differently next time.

You must respond with a single JSON object that conforms to this schema (no prose, no markdown fences):

{
  "summary": string,                 // 1–3 sentences, the headline takeaway
  "per_section": [                   // one item per section, in order
    {
      "section_id": string,
      "headline": string,            // ≤5 words, names what stood out
      "what_landed": string,         // what worked, plain English, 1–2 sentences
      "what_to_work_on": string      // what to fix, 1–2 sentences, concrete
    }
  ],
  "suggested_edits": [               // 0–3 items — only the highest-impact ones
    {
      "id": string,                  // short slug, e.g. "cut-gas-station"
      "kind": "cut" | "adopt" | "rephrase",
      "section_id": string,
      "before": string,              // optional; the exact original text being changed
      "after": string,               // optional; the proposed replacement (or omit for cut)
      "reason": string               // 1 sentence on why this helps
    }
  ]
}

Rules:
- Be specific. Reference exact lines from the script or the transcript.
- Don't say "speak with confidence." Say which line, in which section, lost momentum.
- Use the audio signals to give DELIVERY feedback, not just text feedback:
  * Long pauses inside a section (>2s) often signal the speaker losing their place.
  * A pause >2s right before a punchline or callback can be intentional and effective — don't flag it as a problem if it preceded a strong line.
  * A high WPM variance ratio (>0.35) means the section was choppy. Worth flagging if it correlates with skipped lines or fillers.
  * A flat WPM variance ratio (<0.10) over a long section can mean monotone delivery.
  * Multiple fillers ("um", "uh") in one section, especially at consistent positions, suggest a phrase the speaker stumbles on every time — propose a rephrase that flows better.
  * Transition gaps >3s between sections suggest the speaker isn't sure how to bridge — may indicate a missing connective sentence in the script.
- If a section ran more than 25% over target, name what to cut.
- If the speaker improvised a line that was clearly stronger than what they wrote, propose an "adopt" edit.
- Skipped lines that read fine: don't push to keep them — silence is information.
- Keep total output under 400 words.
- Output JSON only.`,
    },
    {
      type: "text",
      text: `Speech: ${speechTitle}\nOccasion: ${occasion ?? "unspecified"}\n\nThe script the speaker wrote, broken into sections:\n\n${sectionsBlock}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

function buildUserMessage(
  metrics: Array<{
    section_id: string;
    name: string;
    target_seconds: number;
    actual_seconds: number;
    delta_seconds: number;
    wpm: number | null;
    filler_count: number;
  }>,
  signals: AudioSignal[],
  diffRows: Array<
    | { kind: "match"; spoken: string; written: string; sectionId: string }
    | { kind: "paraphrase"; spoken: string; written: string; sectionId: string }
    | { kind: "skipped"; written: string; sectionId: string }
    | { kind: "improv"; spoken: string; sectionId: string | null }
  >,
  tags: Array<{ kind: string; label: string; atMs: number }>,
) {
  const metricsBlock = metrics
    .map(
      (m) =>
        `${m.name} (section_id=${m.section_id}): target ${m.target_seconds}s, actual ${m.actual_seconds}s, delta ${m.delta_seconds >= 0 ? "+" : ""}${m.delta_seconds}s, wpm ${m.wpm ?? "?"}, fillers ${m.filler_count}`,
    )
    .join("\n");

  const signalsBlock = signals
    .map((s) => {
      const fillers = s.filler_examples.length
        ? s.filler_examples.map((f) => `"${f.word}" @ ${(f.atMs / 1000).toFixed(1)}s`).join(", ")
        : "none";
      const variance =
        s.wpm_variance_ratio == null
          ? "n/a (section too short)"
          : s.wpm_variance_ratio.toFixed(2);
      const transition =
        s.transition_gap_ms < 0
          ? "(last section)"
          : `${(s.transition_gap_ms / 1000).toFixed(1)}s to next`;
      return (
        `${s.section_name} (section_id=${s.section_id}):\n` +
        `  pauses: ${s.pauses_500ms} >0.5s, ${s.pauses_1s} >1s, ${s.pauses_2s} >2s\n` +
        `  longest pause: ${(s.longest_pause_ms / 1000).toFixed(1)}s @ ${(s.longest_pause_at_ms / 1000).toFixed(1)}s\n` +
        `  wpm variance ratio: ${variance}\n` +
        `  filler instances: ${fillers}\n` +
        `  transition: ${transition}`
      );
    })
    .join("\n\n");

  const diffBlock = diffRows
    .map((r) => {
      switch (r.kind) {
        case "match":
          return `[match] section=${r.sectionId}\n  ${r.spoken}`;
        case "paraphrase":
          return `[paraphrase] section=${r.sectionId}\n  written: ${r.written}\n  spoken:  ${r.spoken}`;
        case "skipped":
          return `[skipped] section=${r.sectionId}\n  written: ${r.written}`;
        case "improv":
          return `[improv] section=${r.sectionId ?? "—"}\n  spoken: ${r.spoken}`;
      }
    })
    .join("\n\n");

  const tagsBlock = tags.length
    ? tags.map((t) => `${t.label} at ${(t.atMs / 1000).toFixed(1)}s`).join("; ")
    : "none";

  return (
`Per-section pacing (this session):\n${metricsBlock || "(no data)"}

Delivery signals (this session):
${signalsBlock || "(no data)"}

Alignment between script and transcript (this session):
${diffBlock || "(no transcript)"}

Live notes the speaker self-flagged during the recording: ${tagsBlock}

Return the JSON report now.`
  );
}

// ============================================================
// Anthropic call
// ============================================================

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

async function callAnthropic(
  systemBlocks: ReturnType<typeof buildSystemBlocks>,
  userText: string,
): Promise<{ report: CoachReport; usage: AnthropicResponse["usage"]; raw: AnthropicResponse }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: systemBlocks,
      messages: [{ role: "user", content: userText }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Anthropic ${resp.status}: ${body.slice(0, 400)}`);
  }
  const json = (await resp.json()) as AnthropicResponse;
  const text = json.content?.find((c) => c.type === "text")?.text ?? "";

  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  let report: CoachReport;
  try {
    report = JSON.parse(cleaned) as CoachReport;
  } catch (err) {
    throw new Error(`Coach returned non-JSON: ${cleaned.slice(0, 200)}\n\n${err}`);
  }
  if (!Array.isArray(report.per_section)) report.per_section = [];
  if (!Array.isArray(report.suggested_edits)) report.suggested_edits = [];
  if (typeof report.summary !== "string") report.summary = "";
  return { report, usage: json.usage, raw: json };
}

// ============================================================
// Diff rebuilder — inline copy of the alignment library, since edge
// functions can't share modules.
// ============================================================
type ScriptToken = { sectionId: string; token: string };
type TranscriptToken = { idx: number; token: string };
function tokeniseScript(
  sections: Array<{ id: string; body: string }>,
): ScriptToken[] {
  const out: ScriptToken[] = [];
  for (const s of sections) {
    if (!s.body) continue;
    for (const raw of s.body.split(/\s+/)) {
      const token = normalise(raw);
      if (!token) continue;
      out.push({ sectionId: s.id, token });
    }
  }
  return out;
}
function tokeniseTranscript(words: TranscriptWord[]): TranscriptToken[] {
  return words
    .map((w, idx) => ({ idx, token: normalise(w.word) }))
    .filter((t) => t.token.length > 0);
}

const MATCH = 2, PREFIX = 1, MISMATCH = -1, GAP = -1;
function tokenScore(a: string, b: string): number {
  if (a === b) return MATCH;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b.slice(0, 3)) || b.startsWith(a.slice(0, 3)))) return PREFIX;
  return MISMATCH;
}

type Pair = { s: number | null; t: number | null };
function alignNW(scriptTokens: ScriptToken[], transcriptTokens: TranscriptToken[]): Pair[] {
  const n = scriptTokens.length;
  const m = transcriptTokens.length;
  if (n === 0 || m === 0) return [];
  const stride = m + 1;
  const dp = new Int32Array((n + 1) * stride);
  for (let i = 0; i <= n; i++) dp[i * stride] = i * GAP;
  for (let j = 0; j <= m; j++) dp[j] = j * GAP;
  for (let i = 1; i <= n; i++) {
    const sTok = scriptTokens[i - 1].token;
    for (let j = 1; j <= m; j++) {
      const tTok = transcriptTokens[j - 1].token;
      const diag = dp[(i - 1) * stride + (j - 1)] + tokenScore(sTok, tTok);
      const up = dp[(i - 1) * stride + j] + GAP;
      const left = dp[i * stride + (j - 1)] + GAP;
      dp[i * stride + j] = Math.max(diag, up, left);
    }
  }
  const pairs: Pair[] = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const here = dp[i * stride + j];
    const sTok = scriptTokens[i - 1].token;
    const tTok = transcriptTokens[j - 1].token;
    const diag = dp[(i - 1) * stride + (j - 1)] + tokenScore(sTok, tTok);
    const up = dp[(i - 1) * stride + j] + GAP;
    if (here === diag) { pairs.push({ s: i - 1, t: j - 1 }); i--; j--; }
    else if (here === up) { pairs.push({ s: i - 1, t: null }); i--; }
    else { pairs.push({ s: null, t: j - 1 }); j--; }
  }
  while (i > 0) pairs.push({ s: --i, t: null });
  while (j > 0) pairs.push({ s: null, t: --j });
  pairs.reverse();
  return pairs;
}

type DiffRow =
  | { kind: "match"; spoken: string; written: string; sectionId: string }
  | { kind: "paraphrase"; spoken: string; written: string; sectionId: string }
  | { kind: "skipped"; written: string; sectionId: string }
  | { kind: "improv"; spoken: string; sectionId: string | null };

function buildDiff(
  sections: Array<{ id: string; body: string }>,
  words: TranscriptWord[],
): DiffRow[] {
  const sTokens = tokeniseScript(sections);
  const tTokens = tokeniseTranscript(words);
  const pairs = alignNW(sTokens, tTokens);

  const out: DiffRow[] = [];
  let runKind: "match" | "skipped" | "improv" | null = null;
  let runScript: string[] = [];
  let runSpoken: string[] = [];
  let runSection: string | null = null;

  function flush() {
    if (!runKind) return;
    if (runKind === "match") {
      const written = runScript.join(" ");
      const spoken = runSpoken.join(" ");
      out.push({
        kind: written.toLowerCase() === spoken.toLowerCase() ? "match" : "paraphrase",
        spoken,
        written,
        sectionId: runSection ?? "",
      });
    } else if (runKind === "skipped") {
      out.push({ kind: "skipped", written: runScript.join(" "), sectionId: runSection ?? "" });
    } else {
      out.push({ kind: "improv", spoken: runSpoken.join(" "), sectionId: runSection });
    }
    runKind = null;
    runScript = [];
    runSpoken = [];
  }

  for (const p of pairs) {
    if (p.s !== null && p.t !== null) {
      const sec = sTokens[p.s].sectionId;
      if (runKind !== "match" || runSection !== sec) { flush(); runKind = "match"; runSection = sec; }
      runScript.push(sTokens[p.s].token);
      runSpoken.push(words[tTokens[p.t].idx]?.word ?? tTokens[p.t].token);
    } else if (p.s !== null && p.t === null) {
      const sec = sTokens[p.s].sectionId;
      if (runKind !== "skipped" || runSection !== sec) { flush(); runKind = "skipped"; runSection = sec; }
      runScript.push(sTokens[p.s].token);
    } else if (p.s === null && p.t !== null) {
      if (runKind !== "improv") { flush(); runKind = "improv"; }
      runSpoken.push(words[tTokens[p.t].idx]?.word ?? tTokens[p.t].token);
    }
  }
  flush();
  return out;
}

// ============================================================
// Handler
// ============================================================

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const { session_id } = (await req.json().catch(() => ({}))) as { session_id?: string };
  if (!session_id) {
    return new Response(JSON.stringify({ error: "session_id required" }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }
  if (!Deno.env.get("ANTHROPIC_API_KEY")) {
    return new Response(JSON.stringify({ skipped: true }), {
      status: 503, headers: { "content-type": "application/json" },
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  try {
    const { data: session, error: sErr } = await supabase
      .from("sessions")
      .select("id, user_id, speech_id, script_version_id, tags, status")
      .eq("id", session_id)
      .single();
    if (sErr || !session) throw sErr ?? new Error("session not found");

    const { data: speech } = await supabase
      .from("speeches")
      .select("title, occasion")
      .eq("id", session.speech_id)
      .single();

    const { data: secRows, error: secErr } = await supabase
      .from("sections")
      .select("id, name, position, target_seconds, body")
      .eq("script_version_id", session.script_version_id)
      .order("position", { ascending: true });
    if (secErr) throw secErr;
    const sections = secRows ?? [];

    const { data: metricsRaw } = await supabase
      .from("section_metrics")
      .select(
        "section_id, position, target_seconds, actual_seconds, delta_seconds, wpm, filler_count, word_start_idx, word_end_idx",
      )
      .eq("session_id", session_id)
      .order("position", { ascending: true });
    const metricsRows = metricsRaw ?? [];

    const { data: transcript } = await supabase
      .from("transcripts")
      .select("text, words")
      .eq("session_id", session_id)
      .maybeSingle();
    if (!transcript) throw new Error("no transcript yet — run transcribe first");

    const words = (transcript.words ?? []) as TranscriptWord[];

    const diffRows = buildDiff(sections.map((s) => ({ id: s.id, body: s.body })), words);

    // NEW in v7: derive audio signals from word-level timings
    const signals = computeAudioSignals(
      sections.map((s) => ({ id: s.id, name: s.name, body: s.body })),
      metricsRows,
      words,
    );

    const systemBlocks = buildSystemBlocks(
      speech?.title ?? "untitled speech",
      speech?.occasion ?? null,
      sections.map((s) => ({
        id: s.id, name: s.name, target_seconds: s.target_seconds, body: s.body,
      })),
    );

    const metricsForPrompt = metricsRows.map((m) => {
      const sec = sections.find((s) => s.id === m.section_id);
      return {
        section_id: m.section_id,
        name: sec?.name ?? "",
        target_seconds: m.target_seconds,
        actual_seconds: m.actual_seconds,
        delta_seconds: m.delta_seconds,
        wpm: m.wpm,
        filler_count: m.filler_count,
      };
    });

    const userText = buildUserMessage(
      metricsForPrompt,
      signals,
      diffRows,
      Array.isArray(session.tags) ? session.tags as Array<{ kind: string; label: string; atMs: number }> : [],
    );

    log("coaching", { session_id, sections: sections.length, signals: signals.length });
    const { report, usage, raw } = await callAnthropic(systemBlocks, userText);

    const { error: insErr } = await supabase.from("ai_reports").upsert(
      {
        session_id,
        user_id: session.user_id,
        provider: "anthropic",
        model: MODEL,
        prompt_version: PROMPT_VERSION,
        summary: report.summary,
        per_section: report.per_section as unknown as Record<string, unknown>[],
        suggested_edits: report.suggested_edits as unknown as Record<string, unknown>[],
        input_tokens: usage?.input_tokens ?? null,
        output_tokens: usage?.output_tokens ?? null,
        cached_input_tokens: (usage?.cache_read_input_tokens ?? 0),
        raw: raw as unknown as Record<string, unknown>,
      },
      { onConflict: "session_id" },
    );
    if (insErr) throw insErr;

    return new Response(
      JSON.stringify({
        ok: true,
        suggested_edits: report.suggested_edits.length,
        cached: usage?.cache_read_input_tokens ?? 0,
        prompt_version: PROMPT_VERSION,
      }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    logError(err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
