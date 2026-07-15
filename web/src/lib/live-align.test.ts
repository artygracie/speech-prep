import { describe, expect, it } from "vitest";
import { emptyState, ingestWord, tokeniseScript, type LiveState } from "./live-align";

const SECTIONS = [
  { id: "open", position: 0, body: "Good evening everyone tonight" },
  { id: "story", position: 1, body: "Let me tell a story" },
];

function speak(state: LiveState, tokens: ReturnType<typeof tokeniseScript>, words: string[]) {
  let s = state;
  let t = 0;
  for (const w of words) {
    s = ingestWord(s, tokens, { word: w, startMs: t, endMs: t + 300 });
    t += 400;
  }
  return s;
}

describe("live section advancement", () => {
  const tokens = tokeniseScript(SECTIONS);

  it("stays on the current section mid-way through it", () => {
    const s = speak(emptyState(tokens), tokens, ["good", "evening"]);
    expect(s.currentSectionId).toBe("open");
  });

  it("advances when the section's LAST word is spoken — not the next section's first", () => {
    const s = speak(emptyState(tokens), tokens, [
      "good",
      "evening",
      "everyone",
      "tonight", // last token of "open"
    ]);
    expect(s.currentSectionId).toBe("story");
  });

  it("still advances on the next section's first word when the tail was skipped", () => {
    const s = speak(emptyState(tokens), tokens, ["good", "evening", "let"]);
    // "everyone tonight" skipped; matching "let" lands in `story`.
    expect(s.currentSectionId).toBe("story");
    expect(s.skipped).toBeGreaterThan(0);
  });

  it("keeps the final section highlighted after its last word", () => {
    const all = SECTIONS.flatMap((sec) => sec.body.toLowerCase().split(" "));
    const s = speak(emptyState(tokens), tokens, all);
    expect(s.currentSectionId).toBe("story");
    expect(s.matched).toBe(all.length);
  });

  it("does not advance on an improv word in the gap", () => {
    const s0 = speak(emptyState(tokens), tokens, ["good", "evening", "everyone"]);
    // Off-script rambling before finishing the section: still `open`.
    const s1 = ingestWord(s0, tokens, { word: "hmm", startMs: 2000, endMs: 2200 });
    expect(s1.currentSectionId).toBe("open");
  });
});
