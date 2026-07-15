// Pause-math unit tests. Fabricated word arrays with known gaps so the
// thresholds are exercised exactly at, below, and above the boundary.
//
// Run: pnpm test

import { describe, expect, it } from "vitest";
import {
  SECTION_PAUSE_MIN_GAP_MS,
  TRANSCRIPT_PAUSE_MIN_GAP_MS,
  computeSectionMetrics,
  countPauses,
  sumPauseMs,
  type ScriptSection,
  type TranscriptWord,
} from "./alignment";

// Build a word array from [durationMs, gapToNextMs] specs. The gap of the
// last entry is ignored.
function wordsFromGaps(
  specs: Array<{ text: string; durMs?: number; gapAfterMs?: number }>,
): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  let cursor = 0;
  for (const s of specs) {
    const dur = s.durMs ?? 200;
    out.push({ word: s.text, startMs: cursor, endMs: cursor + dur });
    cursor += dur + (s.gapAfterMs ?? 100);
  }
  return out;
}

describe("sumPauseMs", () => {
  it("sums only gaps strictly greater than the threshold", () => {
    const words = wordsFromGaps([
      { text: "one", gapAfterMs: 400 },   // below — ignored
      { text: "two", gapAfterMs: 500 },   // exactly at — ignored (strict >)
      { text: "three", gapAfterMs: 501 }, // above — counted
      { text: "four", gapAfterMs: 2000 }, // above — counted
      { text: "five" },
    ]);
    expect(sumPauseMs(words, SECTION_PAUSE_MIN_GAP_MS)).toBe(501 + 2000);
  });

  it("returns 0 for empty and single-word arrays", () => {
    expect(sumPauseMs([], SECTION_PAUSE_MIN_GAP_MS)).toBe(0);
    expect(
      sumPauseMs([{ startMs: 0, endMs: 300 }], SECTION_PAUSE_MIN_GAP_MS),
    ).toBe(0);
  });

  it("ignores overlapping words (negative gaps)", () => {
    const words: TranscriptWord[] = [
      { word: "a", startMs: 0, endMs: 500 },
      { word: "b", startMs: 300, endMs: 700 }, // overlaps the previous word
      { word: "c", startMs: 1500, endMs: 1800 }, // 800ms gap — counted
    ];
    expect(sumPauseMs(words, SECTION_PAUSE_MIN_GAP_MS)).toBe(800);
  });
});

describe("countPauses", () => {
  it("counts only gaps strictly greater than the threshold", () => {
    const words = wordsFromGaps([
      { text: "one", gapAfterMs: 999 },   // below — ignored
      { text: "two", gapAfterMs: 1000 },  // exactly at — ignored (strict >)
      { text: "three", gapAfterMs: 1001 }, // above — counted
      { text: "four", gapAfterMs: 5000 },  // above — counted
      { text: "five" },
    ]);
    expect(countPauses(words, TRANSCRIPT_PAUSE_MIN_GAP_MS)).toBe(2);
  });

  it("returns 0 for empty and single-word arrays", () => {
    expect(countPauses([], TRANSCRIPT_PAUSE_MIN_GAP_MS)).toBe(0);
    expect(
      countPauses([{ startMs: 0, endMs: 300 }], TRANSCRIPT_PAUSE_MIN_GAP_MS),
    ).toBe(0);
  });
});

describe("computeSectionMetrics pause_ms_total", () => {
  it("sums >500ms gaps within the section's word span", () => {
    const sections: ScriptSection[] = [
      { id: "s1", position: 0, targetSeconds: 10, body: "hello there my friend" },
    ];
    const words = wordsFromGaps([
      { text: "hello", gapAfterMs: 100 },   // ignored
      { text: "there", gapAfterMs: 800 },   // counted
      { text: "my", gapAfterMs: 1200 },     // counted
      { text: "friend" },
    ]);
    const [m] = computeSectionMetrics(sections, words);
    expect(m.pauseMsTotal).toBe(800 + 1200);
  });

  it("keeps pause totals per section", () => {
    const sections: ScriptSection[] = [
      { id: "s1", position: 0, targetSeconds: 5, body: "alpha beta gamma" },
      { id: "s2", position: 1, targetSeconds: 5, body: "delta epsilon zeta" },
    ];
    const words = wordsFromGaps([
      { text: "alpha", gapAfterMs: 700 },   // s1
      { text: "beta", gapAfterMs: 100 },    // s1
      { text: "gamma", gapAfterMs: 3000 },  // boundary gap — belongs to neither span
      { text: "delta", gapAfterMs: 100 },   // s2
      { text: "epsilon", gapAfterMs: 900 }, // s2
      { text: "zeta" },
    ]);
    const [m1, m2] = computeSectionMetrics(sections, words);
    expect(m1.pauseMsTotal).toBe(700);
    expect(m2.pauseMsTotal).toBe(900);
  });

  it("reports 0 pause for a section with no aligned words", () => {
    const sections: ScriptSection[] = [
      { id: "s1", position: 0, targetSeconds: 5, body: "completely different words" },
      { id: "s2", position: 1, targetSeconds: 5, body: "" },
    ];
    const words = wordsFromGaps([
      { text: "completely", gapAfterMs: 2000 },
      { text: "different", gapAfterMs: 100 },
      { text: "words" },
    ]);
    const metrics = computeSectionMetrics(sections, words);
    const m2 = metrics.find((m) => m.sectionId === "s2")!;
    expect(m2.pauseMsTotal).toBe(0);
    expect(m2.wordStartIdx).toBeNull();
  });
});
