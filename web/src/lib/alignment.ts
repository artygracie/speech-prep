// Transcript ↔ script alignment.
//
// Given a script (a sequence of {sectionId, text}) and a transcript (a
// sequence of {word, startMs, endMs}), produce per-section metrics:
//
//   - actual_seconds  — time spent on that section, in seconds
//   - delta_seconds   — actual - target
//   - wpm             — words per minute, derived
//   - word range      — [startIdx, endIdx) into the transcript word array
//   - filler count    — uh / um / like / you know
//
// We do this in two passes:
//
//  1. Tokenise the script into a flat array of {sectionId, normalisedToken}.
//     Tokenise the transcript the same way.
//  2. Run Needleman–Wunsch on the two token arrays. The result is a
//     traceback that pairs script tokens to transcript tokens (or to gaps).
//     For each script token we know which transcript word index "won".
//  3. Group transcript indices by sectionId. The first/last word indices
//     bound the section. Section duration = endMs - startMs.
//
// This is purely deterministic. It runs in O(n*m) which for a 5-minute
// speech (~750 words) and a 5-minute transcript is well under 1M cells —
// negligible.

export type ScriptSection = { id: string; body: string; targetSeconds: number; position: number };

export type TranscriptWord = {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  isFiller?: boolean;
};

export type SectionMetric = {
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

// ---------- Tokenisation ----------

const FILLERS = new Set([
  "uh", "um", "umm", "uhh", "er", "erm", "ah",
  "like", // contextual; only counted as filler when stand-alone (heuristic only)
]);

function normaliseToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’']/g, "")        // strip apostrophes
    .replace(/[^a-z0-9]+/g, "");            // strip punctuation
}

export type ScriptToken = { sectionId: string; position: number; token: string };

export function tokeniseScript(sections: ScriptSection[]): ScriptToken[] {
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

export type TranscriptToken = { idx: number; token: string; startMs: number; endMs: number; isFiller: boolean };

export function tokeniseTranscript(words: TranscriptWord[]): TranscriptToken[] {
  return words.map((w, idx) => {
    const token = normaliseToken(w.word);
    const isFiller = w.isFiller ?? FILLERS.has(token);
    return { idx, token, startMs: w.startMs, endMs: w.endMs, isFiller };
  }).filter((t) => t.token.length > 0);
}

// ---------- Needleman–Wunsch ----------
//
// Standard global alignment. We score:
//   exact match     +2
//   prefix match    +1   (dog ↔ dogs, run ↔ ran etc.)
//   mismatch        -1
//   gap             -1
//
// The traceback yields a list of pairs (scriptIdx | null, transcriptIdx | null).

const MATCH = 2;
const PREFIX = 1;
const MISMATCH = -1;
const GAP = -1;

type Pair = { s: number | null; t: number | null };

function score(a: string, b: string): number {
  if (a === b) return MATCH;
  // Cheap prefix similarity for stem-ish matches.
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b.slice(0, 3)) || b.startsWith(a.slice(0, 3)))) {
    return PREFIX;
  }
  return MISMATCH;
}

export function alignNeedlemanWunsch(
  scriptTokens: ScriptToken[],
  transcriptTokens: TranscriptToken[],
): Pair[] {
  const n = scriptTokens.length;
  const m = transcriptTokens.length;
  if (n === 0 || m === 0) return [];

  // Use a flat Int32Array for the DP grid. Score range is bounded by
  // (n+m) * MATCH < 2^31 for any realistic speech, so int math is safe.
  const dp = new Int32Array((n + 1) * (m + 1));
  const stride = m + 1;
  // Initialize edges with gap penalty.
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

  // Traceback.
  const pairs: Pair[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const here = dp[i * stride + j];
    const sTok = scriptTokens[i - 1].token;
    const tTok = transcriptTokens[j - 1].token;
    const diag = dp[(i - 1) * stride + (j - 1)] + score(sTok, tTok);
    const up = dp[(i - 1) * stride + j] + GAP;
    if (here === diag) {
      pairs.push({ s: i - 1, t: j - 1 });
      i--; j--;
    } else if (here === up) {
      pairs.push({ s: i - 1, t: null });
      i--;
    } else {
      pairs.push({ s: null, t: j - 1 });
      j--;
    }
  }
  while (i > 0) { pairs.push({ s: --i, t: null }); }
  while (j > 0) { pairs.push({ s: null, t: --j }); }
  pairs.reverse();
  return pairs;
}

// ---------- Section assignment ----------
//
// Given the alignment, we know which transcript words landed in which
// script section. Section boundaries in the transcript come from the
// outermost matched/aligned indices per section. Words that aligned to a
// gap (improvised speech with no script counterpart) get assigned to the
// most recently-closed section so they show up as "improv" within that
// section's window — this keeps the timing honest even when the speaker
// goes off script.

export function computeSectionMetrics(
  sections: ScriptSection[],
  transcriptWords: TranscriptWord[],
): SectionMetric[] {
  const scriptTokens = tokeniseScript(sections);
  const transcriptTokens = tokeniseTranscript(transcriptWords);
  const pairs = alignNeedlemanWunsch(scriptTokens, transcriptTokens);

  // Per-section bookkeeping.
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

  // Track which section is "current" while walking the alignment.
  let currentSection: string | null = sections[0]?.id ?? null;
  for (const p of pairs) {
    if (p.s !== null) {
      currentSection = scriptTokens[p.s].sectionId;
    }
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
    const startMs = transcriptTokens[startIdx].startMs;
    const endMs = transcriptTokens[endIdx].endMs;
    const actualMs = Math.max(0, endMs - startMs);
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
      pauseMsTotal: 0, // populated by a separate pass over `words` if we track gaps
      // Translate token indices back to original word indices in the
      // transcript array (tokenisation may drop punctuation-only entries).
      wordStartIdx: transcriptTokens[startIdx]?.idx ?? null,
      wordEndIdx: transcriptTokens[endIdx]?.idx ?? null,
    });
  }
  out.sort((a, b) => a.position - b.position);
  return out;
}

// ---------- Diff rendering ----------
//
// Given the same alignment, produce the row list the report's diff view
// wants: matched | paraphrase | skipped | improv.

export type DiffRow =
  | { kind: "match"; spoken: string; written: string; sectionId: string }
  | { kind: "paraphrase"; spoken: string; written: string; sectionId: string }
  | { kind: "skipped"; written: string; sectionId: string }
  | { kind: "improv"; spoken: string; sectionId: string | null };

export function buildDiff(
  sections: ScriptSection[],
  transcriptWords: TranscriptWord[],
): DiffRow[] {
  const scriptTokens = tokeniseScript(sections);
  const transcriptTokens = tokeniseTranscript(transcriptWords);
  const pairs = alignNeedlemanWunsch(scriptTokens, transcriptTokens);

  // Walk the alignment, accumulating spans of consecutive pairs of the
  // same kind. We yield one DiffRow per span.
  const out: DiffRow[] = [];
  let runKind: "match" | "skipped" | "improv" | null = null;
  let runScript: string[] = [];
  let runSpoken: string[] = [];
  let runSection: string | null = null;

  function flush() {
    if (!runKind) return;
    if (runKind === "match") {
      // Distinguish between exact match and paraphrase: if any script-aligned
      // pair within the run had differing surface text, mark it paraphrase.
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
    } else if (runKind === "improv") {
      out.push({ kind: "improv", spoken: runSpoken.join(" "), sectionId: runSection });
    }
    runKind = null;
    runScript = [];
    runSpoken = [];
  }

  for (const p of pairs) {
    if (p.s !== null && p.t !== null) {
      // matched (could still be a paraphrase if surface text differs)
      const sec = scriptTokens[p.s].sectionId;
      if (runKind !== "match" || runSection !== sec) { flush(); runKind = "match"; runSection = sec; }
      runScript.push(transcriptWords[transcriptTokens[p.t].idx]?.word ? scriptTokens[p.s].token : scriptTokens[p.s].token);
      runSpoken.push(transcriptWords[transcriptTokens[p.t].idx]?.word ?? transcriptTokens[p.t].token);
    } else if (p.s !== null && p.t === null) {
      const sec = scriptTokens[p.s].sectionId;
      if (runKind !== "skipped" || runSection !== sec) { flush(); runKind = "skipped"; runSection = sec; }
      runScript.push(scriptTokens[p.s].token);
    } else if (p.s === null && p.t !== null) {
      // improv — assigned to whatever section is currently the run's section
      if (runKind !== "improv") {
        flush();
        runKind = "improv";
      }
      runSpoken.push(transcriptWords[transcriptTokens[p.t].idx]?.word ?? transcriptTokens[p.t].token);
    }
  }
  flush();
  return out;
}

// ---------- Convenience wrapper ----------

export function alignSession(
  sections: ScriptSection[],
  transcriptWords: TranscriptWord[],
): { metrics: SectionMetric[]; diff: DiffRow[] } {
  return {
    metrics: computeSectionMetrics(sections, transcriptWords),
    diff: buildDiff(sections, transcriptWords),
  };
}
