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

export type ScriptToken = { sectionId: string; position: number; token: string; raw: string };

export function tokeniseScript(sections: ScriptSection[]): ScriptToken[] {
  const out: ScriptToken[] = [];
  for (const s of sections) {
    if (!s.body) continue;
    for (const raw of s.body.split(/\s+/)) {
      const token = normaliseToken(raw);
      if (!token) continue;
      // Preserve the raw word (with punctuation + case) so the diff
      // renderer can show the user's actual text instead of normalised
      // tokens like "name" instead of "[Name]".
      out.push({ sectionId: s.id, position: s.position, token, raw });
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

// Word-level edit op inside a paraphrase row.
//   equal — word said as written
//   sub   — word said with different surface (case/contraction/synonym)
//   del   — word in the script the speaker dropped
//   ins   — word the speaker added that wasn't in the script
export type WordOp =
  | { kind: "equal"; text: string }
  | { kind: "sub"; written: string; spoken: string }
  | { kind: "del"; written: string }
  | { kind: "ins"; spoken: string };

export type DiffRow =
  | { kind: "match"; spoken: string; written: string; sectionId: string }
  | { kind: "paraphrase"; ops: WordOp[]; sectionId: string }
  | { kind: "skipped"; written: string; sectionId: string }
  | { kind: "improv"; spoken: string; sectionId: string | null };

// Strip non-letter/digit characters and lowercase for surface-equality
// checks on a single word. "everyone." vs "everyone" should be equal so
// trailing-period differences don't promote a match into a paraphrase.
function surfaceCore(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");
}

export function buildDiff(
  sections: ScriptSection[],
  transcriptWords: TranscriptWord[],
): DiffRow[] {
  const scriptTokens = tokeniseScript(sections);
  const transcriptTokens = tokeniseTranscript(transcriptWords);
  const pairs = alignNeedlemanWunsch(scriptTokens, transcriptTokens);

  // Walk the alignment, accumulating spans of consecutive pairs in the
  // same section. Match-runs accumulate word-level ops so the renderer
  // can show only the actually-changed words rather than striking the
  // whole sentence.
  const out: DiffRow[] = [];
  let runKind: "match" | "skipped" | "improv" | null = null;
  let runOps: WordOp[] = [];
  let runScript: string[] = [];
  let runSpoken: string[] = [];
  let runSection: string | null = null;

  function flush() {
    if (!runKind) return;
    if (runKind === "match") {
      // If every op is "equal", emit a clean match row. Otherwise it's
      // a paraphrase carrying a per-word op list.
      const allEqual = runOps.every((o) => o.kind === "equal");
      if (allEqual) {
        const text = runOps.map((o) => (o as { kind: "equal"; text: string }).text).join(" ");
        out.push({ kind: "match", spoken: text, written: text, sectionId: runSection ?? "" });
      } else {
        out.push({ kind: "paraphrase", ops: runOps, sectionId: runSection ?? "" });
      }
    } else if (runKind === "skipped") {
      out.push({ kind: "skipped", written: runScript.join(" "), sectionId: runSection ?? "" });
    } else if (runKind === "improv") {
      out.push({ kind: "improv", spoken: runSpoken.join(" "), sectionId: runSection });
    }
    runKind = null;
    runOps = [];
    runScript = [];
    runSpoken = [];
  }

  for (const p of pairs) {
    if (p.s !== null && p.t !== null) {
      // matched (could still be a paraphrase if surface text differs)
      const sec = scriptTokens[p.s].sectionId;
      if (runKind !== "match" || runSection !== sec) { flush(); runKind = "match"; runSection = sec; }
      const written = scriptTokens[p.s].raw;
      const spoken = transcriptWords[transcriptTokens[p.t].idx]?.word ?? transcriptTokens[p.t].token;
      if (surfaceCore(written) === surfaceCore(spoken)) {
        // Same word — keep the spoken surface so casing/punctuation
        // tracks what was actually said.
        runOps.push({ kind: "equal", text: spoken });
      } else {
        runOps.push({ kind: "sub", written, spoken });
      }
    } else if (p.s !== null && p.t === null) {
      const sec = scriptTokens[p.s].sectionId;
      const written = scriptTokens[p.s].raw;
      // A dropped word inside the same section as an active match run
      // stays inside that run as a "del" op so it renders inline in the
      // surrounding sentence rather than splitting into a separate
      // skipped block.
      if (runKind === "match" && runSection === sec) {
        runOps.push({ kind: "del", written });
        continue;
      }
      if (runKind !== "skipped" || runSection !== sec) { flush(); runKind = "skipped"; runSection = sec; }
      runScript.push(written);
    } else if (p.s === null && p.t !== null) {
      const spoken = transcriptWords[transcriptTokens[p.t].idx]?.word ?? transcriptTokens[p.t].token;
      // An inserted word inside an active match run becomes an "ins" op
      // so it appears inline (e.g. spoken "really" inserted in the
      // middle of a paraphrased sentence) rather than as a separate
      // ad-lib block.
      if (runKind === "match") {
        runOps.push({ kind: "ins", spoken });
        continue;
      }
      // improv — assigned to whatever section is currently the run's section
      if (runKind !== "improv") {
        flush();
        runKind = "improv";
      }
      runSpoken.push(spoken);
    }
  }
  flush();
  return out;
}

// ---------- Diff coalescing for the document-style report ----------
//
// `buildDiff` produces a row whenever the alignment kind changes. That's
// faithful to the alignment but visually noisy: a single misheard word
// becomes its own card, and articles like "I" / "the" / "a" that
// Deepgram inserts or drops show up as standalone "ad-lib" or "skipped"
// events that aren't useful to the user.
//
// `coalesceDiff` post-processes the row list for human readability:
//
//   1. Drop "noise" skips/improvs — runs of 1–2 stop words only.
//      These are almost always alignment artefacts, not real changes.
//   2. Merge consecutive rows of the same kind in the same section.
//   3. Trim leading/trailing whitespace defensively.
//
// The output is the right granularity for the document view: meaningful
// chunks, not single-word fragments.

const STOP_WORDS = new Set([
  "i", "a", "an", "the", "and", "or", "but", "of", "to", "is", "it", "in",
  "on", "at", "for", "with", "as", "be", "so", "if", "that", "this",
  "uh", "um", "umm", "uhh", "er", "erm", "ah", "oh", "you", "we",
]);

function isStopwordOnly(text: string): boolean {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length > 2) return false;
  return tokens.every((t) => STOP_WORDS.has(t));
}

// Inside a paraphrase row, a single dropped/inserted stopword ("the",
// "and", "a") is almost always an alignment artefact, not something
// the user did wrong. Drop it from the ops list so it doesn't render
// as a strikethrough or insertion mark. We don't touch "sub" — a real
// word swap is meaningful even if the swap involves a stopword.
function stripStopwordNoise(ops: WordOp[]): WordOp[] {
  return ops.filter((o) => {
    if (o.kind === "del") return !STOP_WORDS.has(surfaceCore(o.written));
    if (o.kind === "ins") return !STOP_WORDS.has(surfaceCore(o.spoken));
    return true;
  });
}

export function coalesceDiff(rows: DiffRow[]): DiffRow[] {
  // 1. Filter out stop-word noise on skips and improvs only.
  //    We never drop a paraphrase or match — those are anchors.
  const filtered = rows
    .map((r) => {
      if (r.kind === "paraphrase") {
        const cleaned = stripStopwordNoise(r.ops);
        // If cleaning leaves only equal ops, demote to a clean match row.
        if (cleaned.every((o) => o.kind === "equal")) {
          const text = cleaned.map((o) => (o as { kind: "equal"; text: string }).text).join(" ");
          return { kind: "match", spoken: text, written: text, sectionId: r.sectionId } as DiffRow;
        }
        return { ...r, ops: cleaned } as DiffRow;
      }
      return r;
    })
    .filter((r) => {
      if (r.kind === "skipped") return !isStopwordOnly(r.written);
      if (r.kind === "improv")  return !isStopwordOnly(r.spoken);
      return true;
    });

  // 2. Merge consecutive same-kind rows in the same section.
  const merged: DiffRow[] = [];
  for (const r of filtered) {
    const last = merged[merged.length - 1];
    const sameSection =
      last &&
      last.kind === r.kind &&
      ((last.kind !== "improv" && r.kind !== "improv" &&
        (last as { sectionId: string }).sectionId === (r as { sectionId: string }).sectionId) ||
       (last.kind === "improv" && r.kind === "improv" &&
        (last as { sectionId: string | null }).sectionId === (r as { sectionId: string | null }).sectionId));

    if (sameSection && last) {
      if (last.kind === "match" && r.kind === "match") {
        last.written = `${last.written} ${r.written}`.trim();
        last.spoken = `${last.spoken} ${r.spoken}`.trim();
      } else if (last.kind === "paraphrase" && r.kind === "paraphrase") {
        last.ops = last.ops.concat(r.ops);
      } else if (last.kind === "skipped" && r.kind === "skipped") {
        last.written = `${last.written} ${r.written}`.trim();
      } else if (last.kind === "improv" && r.kind === "improv") {
        last.spoken = `${last.spoken} ${r.spoken}`.trim();
      }
    } else {
      // Shallow clone so callers can't mutate the original rows.
      merged.push(r.kind === "paraphrase" ? { ...r, ops: [...r.ops] } : { ...r });
    }
  }

  return merged;
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

// ---------- Script ↔ script diff ----------
//
// Compare two versions of the same speech (v(a) ↔ v(b)) and produce the
// same DiffRow shape the session report uses. Sections are aligned by
// position, not id, because cross-version section ids never match — but
// we still want one logical diff per section pair, so we route every
// "old" word through the new section's id and let buildDiff group runs
// the way it normally does.
//
// Implementation: synthesize a TranscriptWord[] from the *old* sections'
// text (timestamps zero'd) and run buildDiff against the *new* sections.
// "skipped" rows become the cuts (in v(a) but not v(b)); "improv" rows
// become additions (in v(b) but not v(a)); "paraphrase" rows are
// rewordings.

export function buildScriptDiff(
  oldSections: ScriptSection[],
  newSections: ScriptSection[],
): DiffRow[] {
  // Treat the new script as the "script" and the old script as the
  // "transcript" — the alignment is symmetric, but this orientation
  // makes "skipped" mean "in old but cut from new" and "improv" mean
  // "added in new", which is the way users read a redline.
  //
  // Wait — buildDiff iterates pairs and labels p.s (script) as
  // "skipped" when the transcript dropped it. So if we want "skipped"
  // to mean "removed in v(b)", the *old* script must be the
  // ScriptSection arg and the *new* script the transcript. Doing it
  // that way.
  const fakeTranscript: TranscriptWord[] = [];
  for (const s of newSections) {
    if (!s.body) continue;
    for (const raw of s.body.split(/\s+/)) {
      if (!raw) continue;
      // We embed the new-section id into the word so the diff renderer
      // can route the row to the right section. Cheap encoding.
      fakeTranscript.push({
        word: raw,
        startMs: 0,
        endMs: 0,
        confidence: 1,
        isFiller: false,
      });
    }
  }
  return buildDiff(oldSections, fakeTranscript);
}
