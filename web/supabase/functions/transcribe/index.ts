// transcribe — Phase 3 edge function.
//
// Input: { session_id: string }
// Effects:
//   1. Loads the session row + the recorded audio file from Storage
//   2. POSTs the audio to Deepgram Nova-3 with word-level timing
//   3. Persists a `transcripts` row (text + words[])
//   4. Loads the script sections that were active at record time
//   5. Runs Needleman–Wunsch alignment, computes per-section metrics,
//      writes `section_metrics` rows
//   6. Updates the session status to 'transcribed'
//   7. Fires the `coach` edge function in the background so the AI
//      report shows up shortly after the pacing report
//
// Auth: this function runs unauthenticated (verify_jwt: false). It uses
// the service role key server-to-server so RLS doesn't apply, and it
// only takes a session_id — it doesn't expose data to the caller.
//
// Required env vars on the edge function (Supabase → Project settings
// → Edge Functions → Secrets):
//   - SUPABASE_URL                (auto-injected)
//   - SUPABASE_SERVICE_ROLE_KEY   (auto-injected)
//   - DEEPGRAM_API_KEY            (you add this)
//
// If DEEPGRAM_API_KEY is missing, the function returns 503 quickly so
// the recording flow doesn't appear to hang.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================
// Tiny logger — visible in the Supabase function logs UI.
// ============================================================
function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log("[transcribe]", ...args);
}
function logError(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.error("[transcribe]", ...args);
}

// ============================================================
// Alignment library — mirror of web/src/lib/alignment.ts. Edge
// functions can't import from the Next.js project, so we keep one
// canonical copy in TypeScript and a shadow copy here.
// ============================================================

const FILLERS = new Set(["uh", "um", "umm", "uhh", "er", "erm", "ah", "like"]);

type TranscriptWord = {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  isFiller?: boolean;
};
type ScriptSection = { id: string; body: string; targetSeconds: number; position: number };
type SectionMetric = {
  sectionId: string;
  position: number;
  targetSeconds: number;
  actualSeconds: number;
  deltaSeconds: number;
  wpm: number | null;
  fillerCount: number;
  pauseMsTotal: number;
  wordStartIdx: number | null;
  wordEndIdx: number | null;
};

function normaliseToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

type ScriptToken = { sectionId: string; position: number; token: string };
function tokeniseScript(sections: ScriptSection[]): ScriptToken[] {
  const out: ScriptToken[] = [];
  for (const s of sections) {
    if (!s.body) continue;
    for (const raw of s.body.split(/\s+/)) {
      const token = normaliseToken(raw);
      if (!token) continue;
      out.push({ sectionId: s.id, position: s.position, token });
    }
  }
  return out;
}

type TranscriptToken = { idx: number; token: string; startMs: number; endMs: number; isFiller: boolean };
function tokeniseTranscript(words: TranscriptWord[]): TranscriptToken[] {
  return words
    .map((w, idx) => {
      const token = normaliseToken(w.word);
      const isFiller = w.isFiller ?? FILLERS.has(token);
      return { idx, token, startMs: w.startMs, endMs: w.endMs, isFiller };
    })
    .filter((t) => t.token.length > 0);
}

const MATCH = 2;
const PREFIX = 1;
const MISMATCH = -1;
const GAP = -1;

type Pair = { s: number | null; t: number | null };

function score(a: string, b: string): number {
  if (a === b) return MATCH;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b.slice(0, 3)) || b.startsWith(a.slice(0, 3)))) return PREFIX;
  return MISMATCH;
}

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
      const diag = dp[(i - 1) * stride + (j - 1)] + score(sTok, tTok);
      const up = dp[(i - 1) * stride + j] + GAP;
      const left = dp[i * stride + (j - 1)] + GAP;
      dp[i * stride + j] = Math.max(diag, up, left);
    }
  }
  const pairs: Pair[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const here = dp[i * stride + j];
    const sTok = scriptTokens[i - 1].token;
    const tTok = transcriptTokens[j - 1].token;
    const diag = dp[(i - 1) * stride + (j - 1)] + score(sTok, tTok);
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

function computeSectionMetrics(
  sections: ScriptSection[],
  transcriptWords: TranscriptWord[],
): SectionMetric[] {
  const scriptTokens = tokeniseScript(sections);
  const transcriptTokens = tokeniseTranscript(transcriptWords);
  const pairs = alignNW(scriptTokens, transcriptTokens);

  type Acc = {
    sectionId: string;
    position: number;
    targetSeconds: number;
    transcriptIdxs: number[];
    fillerCount: number;
  };
  const accBy: Record<string, Acc> = {};
  for (const s of sections) {
    accBy[s.id] = {
      sectionId: s.id,
      position: s.position,
      targetSeconds: s.targetSeconds,
      transcriptIdxs: [],
      fillerCount: 0,
    };
  }
  let currentSection: string | null = sections[0]?.id ?? null;
  for (const p of pairs) {
    if (p.s !== null) currentSection = scriptTokens[p.s].sectionId;
    if (p.t !== null && currentSection) {
      accBy[currentSection].transcriptIdxs.push(p.t);
      const tt = transcriptTokens[p.t];
      if (tt.isFiller) accBy[currentSection].fillerCount += 1;
    }
  }
  const out: SectionMetric[] = [];
  for (const s of sections) {
    const a = accBy[s.id];
    if (a.transcriptIdxs.length === 0) {
      out.push({
        sectionId: s.id,
        position: s.position,
        targetSeconds: s.targetSeconds,
        actualSeconds: 0,
        deltaSeconds: -s.targetSeconds,
        wpm: null,
        fillerCount: 0,
        pauseMsTotal: 0,
        wordStartIdx: null,
        wordEndIdx: null,
      });
      continue;
    }
    a.transcriptIdxs.sort((x, y) => x - y);
    const startIdx = a.transcriptIdxs[0];
    const endIdx = a.transcriptIdxs[a.transcriptIdxs.length - 1];
    const actualMs = Math.max(0, transcriptTokens[endIdx].endMs - transcriptTokens[startIdx].startMs);
    const actualSeconds = +(actualMs / 1000).toFixed(2);
    const wordCount = a.transcriptIdxs.length;
    const wpm = actualSeconds > 0 ? +((wordCount / actualSeconds) * 60).toFixed(2) : null;
    out.push({
      sectionId: s.id,
      position: s.position,
      targetSeconds: s.targetSeconds,
      actualSeconds,
      deltaSeconds: +(actualSeconds - s.targetSeconds).toFixed(2),
      wpm,
      fillerCount: a.fillerCount,
      pauseMsTotal: 0,
      wordStartIdx: transcriptTokens[startIdx]?.idx ?? null,
      wordEndIdx: transcriptTokens[endIdx]?.idx ?? null,
    });
  }
  out.sort((a, b) => a.position - b.position);
  return out;
}

// ============================================================
// Deepgram client
// ============================================================

type DeepgramWord = {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word?: string;
};

type DeepgramResponse = {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        words?: DeepgramWord[];
      }>;
    }>;
  };
};

async function transcribeWithDeepgram(
  audio: ArrayBuffer,
  mimeType: string,
): Promise<{ text: string; words: TranscriptWord[]; raw: DeepgramResponse }> {
  const apiKey = Deno.env.get("DEEPGRAM_API_KEY");
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY not set");

  const params = new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    punctuate: "true",
    filler_words: "true",
    language: "en",
  });
  const url = `https://api.deepgram.com/v1/listen?${params.toString()}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": mimeType || "audio/webm",
    },
    body: audio,
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Deepgram ${resp.status}: ${body.slice(0, 400)}`);
  }
  const json = (await resp.json()) as DeepgramResponse;
  const alt = json.results?.channels?.[0]?.alternatives?.[0];
  const text = alt?.transcript ?? "";
  const dgWords = alt?.words ?? [];
  const words: TranscriptWord[] = dgWords.map((w) => ({
    word: w.punctuated_word ?? w.word,
    startMs: Math.round(w.start * 1000),
    endMs: Math.round(w.end * 1000),
    confidence: w.confidence,
  }));
  return { text, words, raw: json };
}

// ============================================================
// Chain into the coach edge function. Best-effort, fire-and-forget.
// ============================================================
async function fireCoach(sessionId: string): Promise<void> {
  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/coach`;
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
      // Don't tie the transcribe response to the coach response.
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Coach not deployed or ANTHROPIC_API_KEY not set — fine, the
    // transcript + pacing report still ship.
  }
}

// ============================================================
// Handler
// ============================================================

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { session_id } = (await req.json().catch(() => ({}))) as {
    session_id?: string;
  };
  if (!session_id) {
    return new Response(JSON.stringify({ error: "session_id required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (!Deno.env.get("DEEPGRAM_API_KEY")) {
    log("DEEPGRAM_API_KEY missing; skipping transcription");
    return new Response(JSON.stringify({ skipped: true }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    // 1) Load the session row.
    const { data: session, error: sessionErr } = await supabase
      .from("sessions")
      .select("id, user_id, speech_id, script_version_id, audio_path, audio_mime, status")
      .eq("id", session_id)
      .single();
    if (sessionErr || !session) throw sessionErr ?? new Error("session not found");
    if (!session.audio_path) throw new Error("session has no audio_path");
    if (session.status === "transcribed") {
      // Idempotent re-run — just fire the coach again.
      void fireCoach(session_id);
      return new Response(JSON.stringify({ already: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    // 2) Fetch the audio blob from Storage.
    const { data: audioBlob, error: dlErr } = await supabase.storage
      .from("recordings")
      .download(session.audio_path);
    if (dlErr || !audioBlob) throw dlErr ?? new Error("download failed");
    const audioBuf = await audioBlob.arrayBuffer();

    // 3) Transcribe.
    log("transcribing", { session_id, bytes: audioBuf.byteLength });
    const { text, words, raw } = await transcribeWithDeepgram(
      audioBuf,
      session.audio_mime ?? audioBlob.type ?? "audio/webm",
    );
    log("transcribed", { session_id, words: words.length });

    // 4) Persist transcript.
    const fillerCount = words.reduce((a, w) => a + (FILLERS.has(normaliseToken(w.word)) ? 1 : 0), 0);
    const { error: trErr } = await supabase.from("transcripts").upsert(
      {
        session_id,
        user_id: session.user_id,
        provider: "deepgram",
        model: "nova-3",
        language: "en",
        text,
        words: words as unknown as Record<string, unknown>[],
        filler_count: fillerCount,
        pause_count: 0,
        raw: raw as unknown as Record<string, unknown>,
      },
      { onConflict: "session_id" },
    );
    if (trErr) throw trErr;

    // 5) Load sections for the recorded version, run alignment, write
    //    section_metrics. We delete any prior rows for this session
    //    first so re-runs don't double-insert.
    const { data: secRows, error: secErr } = await supabase
      .from("sections")
      .select("id, position, target_seconds, body")
      .eq("script_version_id", session.script_version_id)
      .order("position", { ascending: true });
    if (secErr) throw secErr;

    const sections: ScriptSection[] =
      (secRows ?? []).map((s) => ({
        id: s.id,
        position: s.position,
        targetSeconds: s.target_seconds,
        body: s.body,
      }));

    if (sections.length > 0 && words.length > 0) {
      const metrics = computeSectionMetrics(sections, words);
      await supabase.from("section_metrics").delete().eq("session_id", session_id);
      const { error: metricsErr } = await supabase.from("section_metrics").insert(
        metrics.map((m) => ({
          session_id,
          section_id: m.sectionId,
          user_id: session.user_id,
          position: m.position,
          actual_seconds: m.actualSeconds,
          target_seconds: m.targetSeconds,
          delta_seconds: m.deltaSeconds,
          wpm: m.wpm,
          filler_count: m.fillerCount,
          pause_ms_total: m.pauseMsTotal,
          word_start_idx: m.wordStartIdx,
          word_end_idx: m.wordEndIdx,
        })),
      );
      if (metricsErr) throw metricsErr;
    }

    // 6) Mark session done.
    await supabase.from("sessions").update({ status: "transcribed" }).eq("id", session_id);

    // 7) Kick off the coach.
    void fireCoach(session_id);

    return new Response(
      JSON.stringify({ ok: true, words: words.length, sections: sections.length }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    logError(err);
    await supabase.from("sessions").update({ status: "failed" }).eq("id", session_id);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
