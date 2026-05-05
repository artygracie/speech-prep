// Deterministic paraphrase promotion + suggested-edit dedupe.
//
// When the alignment classifies a span as a "paraphrase" — the speaker
// said it differently than they wrote it — there's a chance the spoken
// phrasing is *better* than the written one (more natural, tighter,
// landed cleaner). This module emits suggested_edit rows of kind
// "rephrase" directly from the coalesced diff, before the AI coach
// has a chance to weigh in. The coach generally beats heuristic
// promotion in quality, so when the two sources overlap on the same
// span, the coach's edit wins.
//
// We're conservative on what to promote:
//   - Need at least one substantive `sub` op (a word swap that isn't
//     a stop word and changed the surface meaningfully).
//   - The paraphrase span must include at least 3 word ops total
//     (otherwise it's a single-word edit — too noisy).
//   - We skip paraphrases that are mostly insertions, since those are
//     usually filler / disfluency, not improved phrasing.
//
// Dedupe is interval-based: each edit's `before` (or `after` for
// adopt) is mapped to a token range within the section body, and
// edits with overlapping ranges collapse to one with a precedence
// rule. This fixes the long-standing bug where the coach and the
// paraphrase promoter both proposed an edit on the same line and the
// user saw two cards saying nearly the same thing.

import type { DiffRow, WordOp } from "./alignment";

export type SuggestedEditProvenance = "coach" | "user-flag" | "alignment";

export type PromotedSuggestion = {
  id: string;
  kind: "rephrase";
  section_id: string;
  before: string;
  after: string;
  reason: string;
  source: "paraphrase";
  provenance: SuggestedEditProvenance;
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
      provenance: "alignment",
    });
  }
  return out;
}

// ===== Interval-based dedupe =====
//
// The shape of the problem: an edit targets a span of words inside a
// section's body. Two edits target the same span if their interval
// representations overlap meaningfully. We resolve each edit's
// "before" string to a (startToken, endToken) interval; edits without
// a before (e.g., bare adopt) get a phantom interval at the section's
// tail so they don't collide with anything else.

type EditLike = {
  id: string;
  kind: string;
  section_id: string;
  before?: string;
  after?: string;
};

// Tokenise the same way the alignment lib does — surfaceCore'd word
// tokens. We don't need byte-perfect alignment, just stable spans.
function tokenise(s: string): string[] {
  return s
    .split(/\s+/)
    .map((w) => surfaceCore(w))
    .filter((w) => w.length > 0);
}

// Find the [start, end) token-range for `needle` inside `haystack`.
// Returns null if it doesn't occur. Case- and punctuation-insensitive,
// matched on tokenised forms.
function findInterval(
  haystackTokens: string[],
  needle: string,
): [number, number] | null {
  const ns = tokenise(needle);
  if (ns.length === 0) return null;
  outer: for (let i = 0; i + ns.length <= haystackTokens.length; i++) {
    for (let j = 0; j < ns.length; j++) {
      if (haystackTokens[i + j] !== ns[j]) continue outer;
    }
    return [i, i + ns.length];
  }
  return null;
}

// Overlap fraction of two intervals: |A ∩ B| / min(|A|, |B|). We use
// min length (rather than union) so a small edit nested inside a big
// one still reads as ~100% overlap — the small one is dominated.
function overlapFraction(
  a: [number, number],
  b: [number, number],
): number {
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  if (hi <= lo) return 0;
  const inter = hi - lo;
  const lenA = a[1] - a[0];
  const lenB = b[1] - b[0];
  return inter / Math.max(1, Math.min(lenA, lenB));
}

// Higher number = wins ties when intervals overlap. Tuned to match the
// PRD's stated precedence:
//   coach rephrase > alignment adopt > alignment rephrase > coach adopt > coach cut
function precedence(
  kind: string,
  provenance: SuggestedEditProvenance | undefined,
): number {
  const p = provenance ?? "coach";
  if (p === "coach" && kind === "rephrase") return 100;
  if (p === "alignment" && kind === "adopt") return 80;
  if (p === "alignment" && kind === "rephrase") return 60;
  if (p === "coach" && kind === "adopt") return 50;
  if (p === "coach" && kind === "drill") return 40;
  if (p === "coach" && kind === "cut") return 30;
  if (p === "user-flag") return 70;
  return 10;
}

// Merge paraphrase-promoted suggestions with the coach's own suggested
// edits. Within each section, edits whose token-intervals overlap by
// ≥50% are collapsed; the higher-precedence edit survives. Edits
// without a resolvable interval (no before substring, or "adopt" with
// only an after) are kept as-is.
//
// Section bodies must be supplied so we can resolve `before` strings
// to token-ranges. If a body is missing, we fall back to the legacy
// prefix-key dedupe so we never crash a render.
const OVERLAP_THRESHOLD = 0.5;

export function mergeSuggestedEdits<
  T extends EditLike & { provenance?: SuggestedEditProvenance },
>(
  coachEdits: T[],
  promoted: PromotedSuggestion[],
  sectionBodyById?: Map<string, string>,
): (T | PromotedSuggestion)[] {
  // Stamp coach edits with provenance "coach" if missing (defensive —
  // the coach pipeline now sets this directly, but old reports may not).
  const stampedCoach: T[] = coachEdits.map((e) =>
    e.provenance ? e : ({ ...e, provenance: "coach" as const } as T),
  );

  // Without bodies we can't compute intervals — fall back to the
  // legacy prefix dedupe. The render path always supplies bodies, but
  // tests / fallbacks may not.
  if (!sectionBodyById) {
    const seen = new Set<string>();
    for (const e of stampedCoach) {
      if (e.before) seen.add(`${e.section_id}::${surfaceCore(e.before).slice(0, 40)}`);
    }
    const filtered = promoted.filter((p) => {
      const key = `${p.section_id}::${surfaceCore(p.before).slice(0, 40)}`;
      return !seen.has(key);
    });
    return [...stampedCoach, ...filtered];
  }

  type Indexed = {
    edit: T | PromotedSuggestion;
    section: string;
    interval: [number, number] | null;
    score: number;
  };
  const tokensBySection = new Map<string, string[]>();
  for (const [sid, body] of sectionBodyById.entries()) {
    tokensBySection.set(sid, tokenise(body));
  }

  const all: (T | PromotedSuggestion)[] = [...stampedCoach, ...promoted];
  const indexed: Indexed[] = all.map((e) => {
    const tokens = tokensBySection.get(e.section_id) ?? [];
    const probe = e.before ?? e.after ?? "";
    const interval = probe ? findInterval(tokens, probe) : null;
    return {
      edit: e,
      section: e.section_id,
      interval,
      score: precedence(e.kind, (e as { provenance?: SuggestedEditProvenance }).provenance),
    };
  });

  // Sort by score descending so the highest-precedence edit gets
  // visited first; subsequent overlapping edits are dropped.
  indexed.sort((a, b) => b.score - a.score);

  const kept: Indexed[] = [];
  for (const candidate of indexed) {
    let dropped = false;
    for (const winner of kept) {
      if (winner.section !== candidate.section) continue;
      if (!winner.interval || !candidate.interval) continue;
      if (overlapFraction(winner.interval, candidate.interval) >= OVERLAP_THRESHOLD) {
        dropped = true;
        break;
      }
    }
    if (!dropped) kept.push(candidate);
  }

  // Restore the original presentation order: coach edits first (in
  // their input order), then promoted edits. Within each group, keep
  // only the survivors. This stops the visual order from jumping
  // around just because precedence reordering happened internally.
  const survivorIds = new Set(kept.map((k) => k.edit.id));
  const survivingCoach = stampedCoach.filter((e) => survivorIds.has(e.id));
  const survivingPromoted = promoted.filter((e) => survivorIds.has(e.id));
  return [...survivingCoach, ...survivingPromoted];
}
