import { describe, expect, it } from "vitest";
import {
  countWords,
  inferOccasion,
  spokenTimeLabel,
  titleFromFilename,
} from "./intake";

describe("titleFromFilename", () => {
  it("strips extension and trailing draft markers", () => {
    expect(titleFromFilename("Ally Wedding Toast - Final Draft.pdf")).toBe(
      "Ally Wedding Toast",
    );
  });
  it("title-cases all-lowercase separator names", () => {
    expect(titleFromFilename("best_man_speech_v2.docx")).toBe("Best Man Speech");
  });
  it("strips stacked markers", () => {
    expect(titleFromFilename("Eulogy for Grandpa Joe FINAL v3 copy.txt")).toBe(
      "Eulogy for Grandpa Joe",
    );
  });
  it("keeps intentional casing", () => {
    expect(titleFromFilename("Toast for Marisol.pdf")).toBe("Toast for Marisol");
  });
  it("handles a filename that is only markers", () => {
    expect(titleFromFilename("draft v2.txt")).toBe("");
  });
});

describe("spokenTimeLabel", () => {
  const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
  it("empty text → empty label", () => {
    expect(spokenTimeLabel("")).toBe("");
  });
  it("short text reads under a minute", () => {
    expect(spokenTimeLabel(words(60))).toBe("under a minute");
  });
  it("145 words ≈ 1 minute", () => {
    expect(spokenTimeLabel(words(145))).toBe("about 1 minute");
  });
  it("~1000 words ≈ 7 minutes", () => {
    expect(spokenTimeLabel(words(1000))).toBe("about 7 minutes");
  });
  it("half-minute granularity", () => {
    expect(spokenTimeLabel(words(360))).toBe("about 2½ minutes");
  });
});

describe("inferOccasion", () => {
  it("reads maid of honor from the text", () => {
    expect(
      inferOccasion("Ally Toast.pdf", "Good evening! I'm Grace, Ally's maid of honor."),
    ).toBe("Maid of honor");
  });
  it("reads best man from the filename", () => {
    expect(inferOccasion("best man speech for tom.docx", "")).toBe("Best man");
  });
  it("falls back to wedding toast on wedding words", () => {
    expect(inferOccasion("Toast.pdf", "When the bride first told me...")).toBe(
      "Wedding toast",
    );
  });
  it("eulogy beats wedding when both could match", () => {
    expect(inferOccasion("eulogy.pdf", "a toast to her memory")).toBe("Eulogy");
  });
  it("returns null when unsure", () => {
    expect(inferOccasion("notes.txt", "quarterly numbers are up")).toBe(null);
  });
});

describe("countWords", () => {
  it("counts across newlines", () => {
    expect(countWords("one two\nthree\n\nfour")).toBe(4);
  });
});
