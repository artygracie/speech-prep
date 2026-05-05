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
  return s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");
}

function isSubstantiveSub(op: WordOp): boolean {
  if (op.kind !== "sub") return false;
  const w = surfaceCore(op.written);
  const s = surfaceCore(op.spoken);
  if (!w || !s) return false;
  if (w === s) return false; // pure punctuation/case difference
  if (STOP_WORDS.has(w) && STOP_WORDS.has(s)) return false;
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
