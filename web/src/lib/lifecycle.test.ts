// Unit tests for the lifecycle engine's date-aware behavior.
//
// Focus: the three event-date buckets (<7 days compressed, 7–30 full
// arc, >30/no date unchanged), the daysUntil helper, and the Wave-2
// nextNudge hook. The pre-date decision tree is covered incidentally
// (fresh speech, lock, drill) — the point here is that a date changes
// exactly what it should and nothing else.

import { describe, expect, it } from "vitest";
import {
  daysUntil,
  nextNudge,
  parseDateOnly,
  recommendNext,
  type RecommendationInput,
  type SectionSignal,
  type SessionSignal,
} from "./lifecycle";

const SECTIONS: SectionSignal[] = [
  { id: "sec-1", name: "Open", position: 0 },
  { id: "sec-2", name: "Story", position: 1 },
];

const NO_EDITS = { cut: 0, adopt: 0, rephrase: 0, drill: 0 };

function withScriptTake(
  id: string,
  overrides: Partial<SessionSignal> = {},
): SessionSignal {
  return {
    id,
    mode: "with-script",
    versionAtTime: 1,
    createdAt: new Date(2026, 6, 13, 10, 0),
    memoryBands: [],
    coachEditCounts: { ...NO_EDITS },
    produced_followup_version: false,
    ...overrides,
  };
}

function freestyleTake(
  id: string,
  bands: SessionSignal["memoryBands"],
  overrides: Partial<SessionSignal> = {},
): SessionSignal {
  return {
    ...withScriptTake(id, overrides),
    mode: "freestyle",
    memoryBands: bands,
    ...overrides,
  };
}

function input(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    speechId: "sp-1",
    currentVersion: 1,
    sessions: [],
    sections: SECTIONS,
    daysUntilEvent: null,
    ...overrides,
  };
}

// ─── daysUntil ───────────────────────────────────────────────────────

describe("daysUntil", () => {
  const now = new Date(2026, 6, 14, 23, 30); // Tue Jul 14, late evening

  it("returns 0 on the event day regardless of time", () => {
    expect(daysUntil("2026-07-14", now)).toBe(0);
  });

  it("returns 1 for tomorrow even minutes before midnight", () => {
    expect(daysUntil("2026-07-15", now)).toBe(1);
  });

  it("returns negative for past dates", () => {
    expect(daysUntil("2026-07-10", now)).toBe(-4);
  });

  it("returns null for missing or malformed dates", () => {
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil("not-a-date", now)).toBeNull();
    expect(daysUntil("2026-7-4", now)).toBeNull();
  });

  it("parses the date string in local time, not UTC", () => {
    // Naive Date parsing would make "2026-07-15" UTC midnight, which is
    // still Jul 14 in western timezones and would read as 0 days.
    expect(parseDateOnly("2026-07-15")?.getDate()).toBe(15);
  });
});

// ─── Bucket: no date, or >30 days (current behavior) ────────────────

describe("recommendNext — no date or >30 days out", () => {
  it("fresh speech familiarizes", () => {
    expect(recommendNext(input()).phase).toBe("familiarize");
  });

  it("one clean Script-visible take does NOT lock yet", () => {
    const rec = recommendNext(input({ sessions: [withScriptTake("s1")] }));
    expect(rec.phase).not.toBe("lock");
  });

  it("two clean Script-visible takes lock", () => {
    const rec = recommendNext(
      input({ sessions: [withScriptTake("s2"), withScriptTake("s1")] }),
    );
    expect(rec.phase).toBe("lock");
    expect(rec.rationale).not.toMatch(/days out/);
  });

  it("a date >30 days out changes nothing", () => {
    const far = { daysUntilEvent: 45, eventDate: parseDateOnly("2026-08-28") };
    const one = recommendNext(input({ ...far, sessions: [withScriptTake("s1")] }));
    expect(one.phase).not.toBe("lock");
    const two = recommendNext(
      input({ ...far, sessions: [withScriptTake("s2"), withScriptTake("s1")] }),
    );
    expect(two.phase).toBe("lock");
    expect(two.rationale).not.toMatch(/days out/);
  });
});

// ─── Bucket: 7–30 days (full arc, date-aware copy) ──────────────────

describe("recommendNext — 7–30 days out", () => {
  const dated = {
    daysUntilEvent: 12,
    eventDate: parseDateOnly("2026-07-26"), // a Sunday
  };

  it("keeps the two-take lock threshold", () => {
    const rec = recommendNext(input({ ...dated, sessions: [withScriptTake("s1")] }));
    expect(rec.phase).not.toBe("lock");
  });

  it("lock copy references the weekday countdown", () => {
    const rec = recommendNext(
      input({ ...dated, sessions: [withScriptTake("s2"), withScriptTake("s1")] }),
    );
    expect(rec.phase).toBe("lock");
    expect(rec.rationale).toMatch(/Sunday is 12 days out — this week is for locking the script/);
    expect(rec.signals).toContain("days_until_event:12");
  });

  it("tighten copy stays calm this far out", () => {
    const rec = recommendNext(
      input({
        ...dated,
        sessions: [
          withScriptTake("s1", { coachEditCounts: { ...NO_EDITS, cut: 2 } }),
        ],
      }),
    );
    expect(rec.phase).toBe("tighten");
    expect(rec.rationale).toBe("Apply the suggestions you like, then record again.");
  });
});

// ─── Bucket: <7 days (compressed arc) ────────────────────────────────

describe("recommendNext — under 7 days out", () => {
  const dated = {
    daysUntilEvent: 5,
    eventDate: parseDateOnly("2026-07-19"), // a Sunday
  };

  it("locks after a single clean Script-visible take", () => {
    const rec = recommendNext(input({ ...dated, sessions: [withScriptTake("s1")] }));
    expect(rec.phase).toBe("lock");
    expect(rec.signals).toContain("compressed_arc");
    expect(rec.rationale).toMatch(/Sunday is 5 days out/);
  });

  it("tighten copy nudges toward locking", () => {
    const rec = recommendNext(
      input({
        ...dated,
        sessions: [
          withScriptTake("s1", { coachEditCounts: { ...NO_EDITS, rephrase: 1 } }),
        ],
      }),
    );
    expect(rec.phase).toBe("tighten");
    expect(rec.rationale).toMatch(/time to lock the script/);
  });

  it("still drills the weakest section from a freestyle take", () => {
    const rec = recommendNext(
      input({
        ...dated,
        sessions: [
          freestyleTake("s2", [
            { sectionId: "sec-1", band: "word-perfect" },
            { sectionId: "sec-2", band: "blank" },
          ]),
          withScriptTake("s1"),
        ],
      }),
    );
    expect(rec.phase).toBe("memorize_section");
    expect(rec.primaryAction.href).toContain("section=sec-2");
  });

  it("speech day with reps in the bank → one full run, then rest", () => {
    const rec = recommendNext(
      input({
        daysUntilEvent: 0,
        eventDate: parseDateOnly("2026-07-14"),
        sessions: [withScriptTake("s1")],
      }),
    );
    expect(rec.phase).toBe("polish");
    expect(rec.headline).toBe("Speech day.");
    expect(rec.signals).toContain("event_day");
  });

  it("speech day with zero sessions still familiarizes", () => {
    const rec = recommendNext(
      input({ daysUntilEvent: 0, eventDate: parseDateOnly("2026-07-14") }),
    );
    expect(rec.phase).toBe("familiarize");
  });
});

// ─── nextNudge (Wave-2 email hook) ───────────────────────────────────

describe("nextNudge", () => {
  const afternoon = new Date(2026, 6, 14, 14, 0); // Tue Jul 14, 2pm
  const speech = (eventDate: string | null) => ({
    id: "sp-1",
    currentVersion: 1,
    eventDate: eventDate ? parseDateOnly(eventDate) : null,
  });

  it("nudges this evening at 19:00 when the user hasn't practiced today", () => {
    const nudge = nextNudge(speech(null), [], SECTIONS, afternoon);
    expect(nudge).not.toBeNull();
    expect(nudge!.when).toEqual(new Date(2026, 6, 14, 19, 0));
    expect(nudge!.subjectKey).toBe("read_aloud");
    expect(nudge!.phase).toBe("familiarize");
  });

  it("spaces to tomorrow evening when the user already practiced today", () => {
    const sessions = [withScriptTake("s1", { createdAt: new Date(2026, 6, 14, 10, 0) })];
    const nudge = nextNudge(speech(null), sessions, SECTIONS, afternoon);
    expect(nudge!.when).toEqual(new Date(2026, 6, 15, 19, 0));
  });

  it("pushes past-cutoff evenings to tomorrow", () => {
    const lateNight = new Date(2026, 6, 14, 22, 0);
    const nudge = nextNudge(speech(null), [], SECTIONS, lateNight);
    expect(nudge!.when).toEqual(new Date(2026, 6, 15, 19, 0));
  });

  it("inside the evening window, the nudge moment is now", () => {
    const evening = new Date(2026, 6, 14, 19, 30);
    const nudge = nextNudge(speech(null), [], SECTIONS, evening);
    expect(nudge!.when).toEqual(evening);
  });

  it("goes quiet once the event has passed", () => {
    expect(nextNudge(speech("2026-07-10"), [], SECTIONS, afternoon)).toBeNull();
  });

  it("goes quiet when there is no script to practice", () => {
    expect(nextNudge(speech(null), [], [], afternoon)).toBeNull();
  });

  it("event-day morning: one light-run nudge at 09:00", () => {
    const earlyEventDay = new Date(2026, 6, 14, 7, 0);
    const sessions = [withScriptTake("s1", { createdAt: new Date(2026, 6, 13, 20, 0) })];
    const nudge = nextNudge(speech("2026-07-14"), sessions, SECTIONS, earlyEventDay);
    expect(nudge!.when).toEqual(new Date(2026, 6, 14, 9, 0));
    expect(nudge!.subjectKey).toBe("event_day");
  });

  it("event-day after the morning slot: no more nudges", () => {
    const lateEventDay = new Date(2026, 6, 14, 12, 0);
    expect(nextNudge(speech("2026-07-14"), [], SECTIONS, lateEventDay)).toBeNull();
  });

  it("never schedules an evening rep on the event day — shifts to the morning run", () => {
    // Event is tomorrow; user practiced today, so the spaced slot would
    // be tomorrow evening — after the event. Expect event-day 09:00.
    const sessions = [withScriptTake("s1", { createdAt: new Date(2026, 6, 14, 10, 0) })];
    const nudge = nextNudge(speech("2026-07-15"), sessions, SECTIONS, afternoon);
    expect(nudge!.when).toEqual(new Date(2026, 6, 15, 9, 0));
    expect(nudge!.subjectKey).toBe("event_day");
  });
});
