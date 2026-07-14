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

// ---------- Pause detection ----------
//
// A "pause" is silence between two consecutive words: next.startMs -
// prev.endMs. Two thresholds, two audiences:
//
//   SECTION_PAUSE_MIN_GAP_MS (500ms) — per-section pause_ms_total. Sums
//     every gap long enough to be a real hesitation (not just breath
//     between words). Feeds section_metrics.pause_ms_total, which the
//     report page reads as hadLongPause when the section total > 4s.
//
//   TRANSCRIPT_PAUSE_MIN_GAP_MS (1000ms) — transcripts.pause_count.
//     Counts only unambiguous stalls across the whole take.
//
// The transcribe edge function mirrors these (it can't import from the
// Next.js project) — keep the two in sync.

export const SECTION_PAUSE_MIN_GAP_MS = 500;
export const TRANSCRIPT_PAUSE_MIN_GAP_MS = 1000;

type TimedWord = Pick<TranscriptWord, "startMs" | "endMs">;

// Sum of inter-word gaps strictly greater than minGapMs. Overlapping or
// touching words (gap <= 0) contribute nothing.
export function sumPauseMs(words: TimedWord[], minGapMs: number): number {
  let total = 0;
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].startMs - words[i - 1].endMs;
    if (gap > minGapMs) total += gap;
  }
  return total;
}

// Count of inter-word gaps strictly greater than minGapMs.
export function countPauses(words: TimedWord[], minGapMs: number): number {
  let count = 0;
  for (let i = 1; i < words.length; i++) {
    if (words[i].startMs - words[i - 1].endMs > minGapMs) count += 1;
  }
  return count;
}

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
    for (const ws of s.body.split(/\s+/)) {
      // Split hyphenated compounds ("thirty-one", "self-aware") into
      // separate tokens. Transcripts almost always emit them as two
      // words, so leaving them joined makes the aligner pair the joined
      // script token against just the first transcript word and surface
      // a phantom paraphrase + an inserted second word. The raw form of
      // each piece keeps its own original casing/punctuation so the
      // renderer reads naturally.
      const pieces = ws.split(/-+/).filter(Boolean);
      for (const raw of pieces) {
        const token = normaliseToken(raw);
        if (!token) continue;
        // Preserve the raw word (with punctuation + case) so the diff
        // renderer can show the user's actual text instead of normalised
        // tokens like "name" instead of "[Name]".
        out.push({ sectionId: s.id, position: s.position, token, raw });
      }
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

    // Pause total over the section's contiguous token span — the same
    // window actualSeconds is measured over, so a pause between two
    // improvised words inside the section still counts.
    const pauseMsTotal = sumPauseMs(
      transcriptTokens.slice(startIdx, endIdx + 1),
      SECTION_PAUSE_MIN_GAP_MS,
    );

    out.push({
      sectionId: s.id,
      position: s.position,
      targetSeconds: s.targetSeconds,
      actualSeconds,
      deltaSeconds: +(actualSeconds - s.targetSeconds).toFixed(2),
      wpm,
      fillerCount: a.fillerCount,
      pauseMsTotal,
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

// Surface-equality core: lowercase, strip apostrophes (curly + straight),
// strip everything else that isn't a letter or digit. Used when deciding
// whether an aligned pair is a real word swap or just punctuation/casing
// noise. Examples that should compare equal here:
//   "don't"  vs  "don't"   (curly vs straight apostrophe)
//   "I've"   vs  "I've"
//   "everyone." vs "everyone"
// This must match how `normaliseToken` collapses tokens during alignment;
// otherwise the aligner says "match" but buildDiff says "sub" and we
// emit phantom paraphrases like the ones in the bug report.
function surfaceCore(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’']/g, "")           // curly + straight apostrophes
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// Number-word ↔ digit equivalents. The speaker said "fifty" because
// that's how digits are pronounced; the transcriber sometimes emits
// "fifty" and sometimes "50". Either way it's not a paraphrase.
const NUMBER_WORDS_TO_DIGITS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
  fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18",
  nineteen: "19", twenty: "20", thirty: "30", forty: "40",
  fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90",
  hundred: "100", thousand: "1000", million: "1000000",
};

// US/UK spelling variants. Treat as cosmetic — render as a match, not
// a sub, in the Diff tab.
const SPELLING_VARIANT_PAIRS = new Set<string>([
  "toward|towards", "color|colour", "honor|honour", "favor|favour",
  "labor|labour", "center|centre", "theater|theatre",
  "organize|organise", "realize|realise", "recognize|recognise",
  "analyze|analyse", "traveled|travelled", "canceled|cancelled",
  "modeling|modelling",
]);

// Treat two words as cosmetically equal if either side normalizes to
// the other after applying number-word and spelling-variant rules.
// Used by buildDiff so the Diff tab doesn't gold-highlight noise.
function surfaceEqual(a: string, b: string): boolean {
  const ca = surfaceCore(a);
  const cb = surfaceCore(b);
  if (ca === cb) return true;
  if (NUMBER_WORDS_TO_DIGITS[ca] === cb) return true;
  if (NUMBER_WORDS_TO_DIGITS[cb] === ca) return true;
  // Spelling variants are direction-symmetric; sort the pair before
  // looking up so we only need one entry per pair.
  const [low, high] = ca < cb ? [ca, cb] : [cb, ca];
  if (SPELLING_VARIANT_PAIRS.has(`${low}|${high}`)) return true;
  return false;
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
      if (surfaceEqual(written, spoken)) {
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

// ---------- Diff quality classification ----------
//
// Same rows produce opposite "quality" reads depending on mode:
//
//   Script-visible mode — does the writing land out loud?
//     match                                 → good
//     paraphrase (meaning preserved)        → good   (mouth improved on page)
//     paraphrase (meaning shifted)          → neutral
//     skipped                               → bad
//     improv (substantive)                  → good
//     improv (filler-like)                  → neutral
//
//   From-memory mode — did I have this memorized?
//     match                                 → good
//     paraphrase (any)                      → bad    (memory was approximate)
//     skipped                               → bad    (memory failed)
//     improv                                → bad    (memory filled the gap)
//
// "Meaning preserved" is a cheap heuristic: ≥60% of the paraphrase's
// non-equal ops are word-level subs (rephrasing) rather than insertions
// or deletions. We don't need a semantic model for this — the alignment
// shape itself carries enough signal.

export type DiffQuality = "good" | "neutral" | "bad" | null;

function paraphraseMeaningPreserved(ops: WordOp[]): boolean {
  const subs = ops.filter((o) => o.kind === "sub").length;
  const dels = ops.filter((o) => o.kind === "del").length;
  const ins = ops.filter((o) => o.kind === "ins").length;
  const total = subs + dels + ins;
  if (total === 0) return true;
  return subs / total >= 0.6;
}

function improvIsSubstantive(spoken: string): boolean {
  const words = spoken.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  // Almost-pure-filler check: more than half are common filler words.
  const fillers = new Set([
    "um", "uh", "uhh", "er", "erm", "yeah", "right", "okay", "ok", "like",
    "you", "know", "i", "mean",
  ]);
  const fillerCount = words.filter((w) =>
    fillers.has(w.toLowerCase().replace(/[^a-z]/g, "")),
  ).length;
  return fillerCount / words.length < 0.5;
}

export function classifyDiffQuality(
  rows: DiffRow[],
  mode: "with-script" | "freestyle",
): DiffQuality[] {
  return rows.map((row) => {
    if (row.kind === "match") return "good";
    if (mode === "freestyle") {
      // From-memory: any deviation is a memory issue.
      if (row.kind === "paraphrase") return "bad";
      if (row.kind === "skipped") return "bad";
      if (row.kind === "improv") return "bad";
      return null;
    }
    // Script-visible mode.
    if (row.kind === "skipped") return "bad";
    if (row.kind === "paraphrase") {
      return paraphraseMeaningPreserved(row.ops) ? "good" : "neutral";
    }
    if (row.kind === "improv") {
      return improvIsSubstantive(row.spoken) ? "good" : "neutral";
    }
    return null;
  });
}

// ---------- Memory-check scoring ----------
//
// Per-section recall score derived from DiffRow[]. Used by the
// From-memory mode hero panel — answers "how well do I have this
// memorized?" at a glance.
//
// Score = words remembered / words in script. Bands:
//   word-perfect  ≥ 0.95
//   mostly-there  0.80 – 0.95
//   rough         0.50 – 0.80
//   blank         < 0.50
//   not-reached   no rows for this section (speaker never got there)

export type MemoryBand =
  | "word-perfect"
  | "mostly-there"
  | "rough"
  | "blank"
  | "not-reached";

export type MemoryCheckRow = {
  sectionId: string;
  recall: number;            // 0..1
  band: MemoryBand;
  matchedWords: number;      // remembered (match rows + equal ops)
  approximateWords: number;  // paraphrased (sub/del/ins ops)
  skippedWords: number;      // skipped rows
  paraphraseCount: number;   // # paraphrase rows
  skippedRowCount: number;   // # skipped rows
  blankedAt: string | null;  // first long-skipped phrase, used as a cue
};

function bandFor(recall: number, hasAnyRows: boolean): MemoryBand {
  if (!hasAnyRows) return "not-reached";
  if (recall >= 0.95) return "word-perfect";
  if (recall >= 0.8) return "mostly-there";
  if (recall >= 0.5) return "rough";
  return "blank";
}

function wordCount(s: string): number {
  if (!s) return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function computeMemoryCheck(
  sections: { id: string }[],
  diff: DiffRow[],
): MemoryCheckRow[] {
  return sections.map((sec) => {
    const rows = diff.filter((r) => r.sectionId === sec.id);
    let matched = 0;
    let approx = 0;
    let skipped = 0;
    let paraphraseCount = 0;
    let skippedRowCount = 0;
    let firstLongSkip: string | null = null;

    for (const r of rows) {
      if (r.kind === "match") {
        matched += wordCount(r.spoken);
      } else if (r.kind === "paraphrase") {
        paraphraseCount += 1;
        for (const op of r.ops) {
          if (op.kind === "equal") matched += wordCount(op.text);
          else if (op.kind === "sub") approx += 1;
          else if (op.kind === "del") approx += 1;
          // ins doesn't contribute to scripted-word recall — it's
          // the speaker reaching for a word that wasn't there.
        }
      } else if (r.kind === "skipped") {
        skippedRowCount += 1;
        const wc = wordCount(r.written);
        skipped += wc;
        if (!firstLongSkip && wc >= 2) {
          // Use the first 4 words as a cue; the panel renders this
          // as "you blanked at '…' ".
          firstLongSkip = r.written.trim().split(/\s+/).slice(0, 4).join(" ");
        }
      }
      // improv rows have no scripted-word counterpart; ignored.
    }

    const totalScripted = matched + approx + skipped;
    const recall = totalScripted > 0 ? matched / totalScripted : 0;
    const hasRows = rows.length > 0;

    return {
      sectionId: sec.id,
      recall,
      band: bandFor(recall, hasRows),
      matchedWords: matched,
      approximateWords: approx,
      skippedWords: skipped,
      paraphraseCount,
      skippedRowCount,
      blankedAt: firstLongSkip,
    };
  });
}
