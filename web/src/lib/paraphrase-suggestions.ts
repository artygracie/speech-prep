// Deterministic paraphrase promotion.
//
// When the alignment classifies a span as a "paraphrase" — the speaker
// said it differently than they wrote it — there's a chance the spoken
// phrasing is *better* than the written one (more natural, tighter,
// landed cleaner). This module emits suggested_edit rows of kind
// "rephrase" directly from the coalesced diff, before the AI coach
// has a chance to weigh in. The coach (T1.4) will eventually augment
// or override these, but until it lands, this gives users the
// "you said it better than you wrote it" moment immediately.
//
// We're conservative on what to promote:
//   - Need at least one substantive `sub` op (a word swap that isn't
//     a stop word and changed the surface meaningfully).
//   - The paraphrase span must include at least 3 word ops total
//     (otherwise it's a single-word edit — too noisy).
//   - We skip paraphrases that are mostly insertions, since those are
//     usually filler / disfluency, not improved phrasing.

import type { DiffRow, WordOp } from "./alignment";

export type PromotedSuggestion = {
  id: string;
  kind: "rephrase";
  section_id: string;
  before: string;
  after: string;
  reason: string;
  source: "paraphrase";
};

const STOP_WORDS = new Set([
  "i", "a", "an", "the", "and", "or", "but", "of", "to", "is", "it", "in",
  "on", "at", "for", "with", "as", "be", "so", "if", "that", "this",
  "you", "we", "are", "was", "were", "have", "has", "had", "do", "does",
  "did", "will", "would", "could", "should", "may", "might", "can",
]);

function surfaceCore(s: string): string {
  // Mirror the alignment library's surfaceCore: strip apostrophes
  // (curly + straight) so "don't" / "don't" / "dont" all collapse the
  // same way. Without this, suggested edits would carry phantom subs
  // for cosmetic differences.
  return s
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// Number ↔ word equivalents that aren't real rewordings — the speaker
// said "fifty" because that's how digits are pronounced; the script
// happened to write "50". Promoting this as "you said it better" is
// noise. Same goes the other direction (script "fifty", spoken "50"
// from a transcriber that emits digits).
const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
  fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18",
  nineteen: "19", twenty: "20", thirty: "30", forty: "40",
  fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90",
  hundred: "100", thousand: "1000", million: "1000000",
};

function isNumberWordPair(a: string, b: string): boolean {
  if (NUMBER_WORDS[a] === b || NUMBER_WORDS[b] === a) return true;
  return false;
}

// US/UK spelling variants we don't want to promote as paraphrases.
// Pairs are stored both directions for cheap lookup.
const SPELLING_VARIANTS = new Set<string>([
  "toward|towards",
  "towards|toward",
  "color|colour",
  "colour|color",
  "honor|honour",
  "honour|honor",
  "favor|favour",
  "favour|favor",
  "labor|labour",
  "labour|labor",
  "center|centre",
  "centre|center",
  "theater|theatre",
  "theatre|theater",
  "organize|organise",
  "organise|organize",
  "realize|realise",
  "realise|realize",
  "recognize|recognise",
  "recognise|recognize",
  "analyze|analyse",
  "analyse|analyze",
  "traveled|travelled",
  "travelled|traveled",
  "canceled|cancelled",
  "cancelled|canceled",
  "modeling|modelling",
  "modelling|modeling",
]);

function isSpellingVariant(a: string, b: string): boolean {
  return SPELLING_VARIANTS.has(`${a}|${b}`);
}

// Tiny edit-distance check for proper-noun mishearings ("Halverson" vs
// "Haverson"). We don't want to promote the spoken version as the
// "better wording" because it's just an ASR error on a name. Threshold
// is ≤2 absolute edits AND ≤25% of the length, so "Halverson"/"Haverson"
// (1 edit, 11% of 9 chars) qualifies but "later"/"sooner" doesn't.
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function isLikelyMishearing(a: string, b: string): boolean {
  const longer = Math.max(a.length, b.length);
  if (longer < 5) return false; // too short — small edit dist is meaningful
  const d = levenshtein(a, b);
  return d > 0 && d <= 2 && d / longer <= 0.25;
}

function isSubstantiveSub(op: WordOp): boolean {
  if (op.kind !== "sub") return false;
  const w = surfaceCore(op.written);
  const s = surfaceCore(op.spoken);
  if (!w || !s) return false;
  if (w === s) return false; // pure punctuation/case difference
  if (STOP_WORDS.has(w) && STOP_WORDS.has(s)) return false;
  if (isNumberWordPair(w, s)) return false;
  if (isSpellingVariant(w, s)) return false;
  if (isLikelyMishearing(w, s)) return false;
  return true;
}

// Render a paraphrase ops list as the "before" (the script's wording)
// and "after" (what the speaker actually said). We drop deletion words
// from the after, drop insertion words from the before, and use spoken
// surface for subs in the after.
function buildBeforeAfter(ops: WordOp[]): { before: string; after: string } {
  const before: string[] = [];
  const after: string[] = [];
  for (const op of ops) {
    switch (op.kind) {
      case "equal":
        before.push(op.text);
        after.push(op.text);
        break;
      case "sub":
        before.push(op.written);
        after.push(op.spoken);
        break;
      case "del":
        before.push(op.written);
        break;
      case "ins":
        after.push(op.spoken);
        break;
    }
  }
  return { before: before.join(" ").trim(), after: after.join(" ").trim() };
}

export function promoteParaphrases(
  diff: DiffRow[],
  sessionId: string,
): PromotedSuggestion[] {
  const out: PromotedSuggestion[] = [];
  let counter = 0;
  for (const row of diff) {
    if (row.kind !== "paraphrase") continue;
    if (row.ops.length < 3) continue;

    const subCount = row.ops.filter(isSubstantiveSub).length;
    if (subCount < 1) continue;

    const insCount = row.ops.filter((o) => o.kind === "ins").length;
    const totalNonEqual = row.ops.filter((o) => o.kind !== "equal").length;
    if (totalNonEqual === 0) continue;
    // If the row is dominated by insertions (filler/disfluency), skip it.
    if (insCount / totalNonEqual > 0.6) continue;

    const { before, after } = buildBeforeAfter(row.ops);
    if (!before || !after || before.toLowerCase() === after.toLowerCase()) continue;

    counter += 1;
    out.push({
      id: `paraphrase-${sessionId}-${counter}`,
      kind: "rephrase",
      section_id: row.sectionId,
      before,
      after,
      reason:
        "You said this differently than you wrote it — keeping the spoken phrasing.",
      source: "paraphrase",
    });
  }
  return out;
}

// Merge paraphrase-promoted suggestions with the coach's own suggested
// edits. The coach's edits take precedence — if a coach edit already
// targets the same section with a similar `before`, we drop the
// paraphrase one to avoid duplication.
export function mergeSuggestedEdits<
  T extends { kind: string; section_id: string; before?: string; after?: string },
>(
  coachEdits: T[],
  promoted: PromotedSuggestion[],
): (T | PromotedSuggestion)[] {
  const seen = new Set<string>();
  for (const e of coachEdits) {
    if (e.before) seen.add(`${e.section_id}::${surfaceCore(e.before).slice(0, 40)}`);
  }
  const filtered = promoted.filter((p) => {
    const key = `${p.section_id}::${surfaceCore(p.before).slice(0, 40)}`;
    return !seen.has(key);
  });
  return [...coachEdits, ...filtered];
}
