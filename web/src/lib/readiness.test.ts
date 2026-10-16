// Unit tests for the "Am I ready?" verdict.

import { describe, expect, it } from "vitest";
import { assessReadiness, fmtClock, type ReadinessInput } from "./readiness";

const base: ReadinessInput = {
  occasion: "Best man",
  mode: "with-script",
  runSeconds: 240,
  targetSeconds: 240,
  spokenWords: 560, // 140 wpm
  accuracy: 0.95,
};

const check = (input: ReadinessInput, key: string) =>
  assessReadiness(input).checks.find((c) => c.key === key)!;

describe("assessReadiness", () => {
  it("calls a from-memory take on time with high recall ready", () => {
    const r = assessReadiness({ ...base, mode: "freestyle", accuracy: 0.93 });
    expect(r.verdict).toBe("ready");
  });

  it("never calls a read-along take ready, however clean", () => {
    const r = assessReadiness({ ...base, accuracy: 1 });
    expect(r.verdict).toBe("close");
    expect(r.headline).toMatch(/from memory/);
  });

  it("leads with length when the take runs past the typical range", () => {
    const r = assessReadiness({ ...base, mode: "freestyle", runSeconds: 400, spokenWords: 900 });
    expect(r.verdict).toBe("not-yet");
    expect(r.headline).toContain("1:40 long");
    expect(check({ ...base, runSeconds: 400 }, "length").detail).toContain("3 to 5 minutes");
  });

  it("judges occasions without a guide against the script's target", () => {
    const onTime = check({ ...base, occasion: "Vows", runSeconds: 110, targetSeconds: 100 }, "length");
    expect(onTime.status).toBe("good");
    const long = check({ ...base, occasion: null, runSeconds: 130, targetSeconds: 100 }, "length");
    expect(long.status).toBe("watch");
    expect(long.detail).toContain("about 1:40");
  });

  it("asks for more read-throughs when a read-along take strays from the script", () => {
    expect(assessReadiness({ ...base, accuracy: 0.6 }).verdict).toBe("not-yet");
  });

  it("flags low recall from memory as not yet", () => {
    expect(assessReadiness({ ...base, mode: "freestyle", accuracy: 0.5 }).verdict).toBe("not-yet");
  });

  it("flags a rushed pace without changing the verdict", () => {
    const r = assessReadiness({ ...base, spokenWords: 800 }); // 200 wpm
    expect(r.checks.find((c) => c.key === "pace")!.status).toBe("watch");
    expect(r.verdict).toBe("close");
  });
});

describe("fmtClock", () => {
  it("formats minutes and seconds", () => {
    expect(fmtClock(65)).toBe("1:05");
    expect(fmtClock(0)).toBe("0:00");
  });
});
