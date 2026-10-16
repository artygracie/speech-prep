// "Am I ready?" — the verdict at the top of a session report.
//
// A nervous speaker reads a report for one answer before any detail:
// could I give this speech as it went just now? This module turns one
// take into that answer from three checks a person can verify against
// the take itself: how long it ran, how fast they spoke, and how much of
// the script came out as written. It is deterministic on purpose; the
// coach's prose sits underneath it, and the two never have to agree on
// wording to agree on facts.
//
// Isomorphic and pure so it is cheap to unit-test.

import type { SessionMode } from "./modes";

export type Verdict = "ready" | "close" | "not-yet";
export type CheckStatus = "good" | "watch";

export type ReadinessCheck = {
  key: "length" | "pace" | "accuracy";
  status: CheckStatus;
  label: string;   // "Length", "Pace", "Accuracy" / "Recall"
  value: string;   // "4:12"
  detail: string;  // one plain sentence against a reference
};

export type Readiness = {
  verdict: Verdict;
  headline: string;
  checks: ReadinessCheck[];
};

export type ReadinessInput = {
  occasion: string | null;
  mode: SessionMode;
  runSeconds: number;      // the whole take, start to stop
  targetSeconds: number;   // sum of the script's section targets
  spokenWords: number;     // words in the transcript
  accuracy: number;        // 0..1 share of script words said as written
};

// Typical lengths, from the role guides on the marketing site
// (src/lib/roles.ts). Occasions without a guide are judged against the
// script's own target instead.
const TYPICAL_RANGE_SECONDS: Record<string, { min: number; max: number; noun: string }> = {
  "Best man": { min: 180, max: 300, noun: "best man speech" },
  "Maid of honor": { min: 180, max: 300, noun: "maid of honor speech" },
  "Father of the bride": { min: 240, max: 360, noun: "father of the bride speech" },
  "Mother of the groom": { min: 180, max: 300, noun: "mother of the groom speech" },
};

// Without a typical range, a take within this share of the script's
// target counts as on time.
const TARGET_TOLERANCE = 0.2;

// Conversational public speaking sits around 130–160 words a minute.
// Nerves push people well past the top of that.
const PACE_SLOW_WPM = 110;
const PACE_FAST_WPM = 170;

// Share of the script that has to come out as written.
const READY_RECALL = 0.9;      // from memory, to call it ready
const CLOSE_RECALL = 0.7;      // from memory, to call it close
const CLOSE_READ_ACCURACY = 0.85; // reading along, before moving to memory

export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtMinutes(seconds: number): string {
  return `${Math.round(seconds / 60)}`;
}

function lengthCheck(input: ReadinessInput): ReadinessCheck & { overBy: number; underBy: number } {
  const { runSeconds, targetSeconds, occasion } = input;
  const range = occasion ? TYPICAL_RANGE_SECONDS[occasion] : undefined;
  const min = range ? range.min : targetSeconds * (1 - TARGET_TOLERANCE);
  const max = range ? range.max : targetSeconds * (1 + TARGET_TOLERANCE);
  const overBy = Math.max(0, runSeconds - max);
  const underBy = Math.max(0, min - runSeconds);
  const reference = range
    ? `A typical ${range.noun} runs ${fmtMinutes(range.min)} to ${fmtMinutes(range.max)} minutes`
    : `Your script is written to run about ${fmtClock(targetSeconds)}`;
  const verdictWords =
    overBy > 0 ? `, so this ran about ${fmtClock(overBy)} long.`
    : underBy > 0 ? `, so this came in about ${fmtClock(underBy)} short.`
    : ", and this fits.";
  return {
    key: "length",
    status: overBy > 0 || underBy > 0 ? "watch" : "good",
    label: "Length",
    value: fmtClock(runSeconds),
    detail: reference + verdictWords,
    overBy,
    underBy,
  };
}

function paceCheck(input: ReadinessInput): ReadinessCheck & { wpm: number } {
  const wpm = input.runSeconds > 0 ? Math.round(input.spokenWords / (input.runSeconds / 60)) : 0;
  const detail =
    wpm > PACE_FAST_WPM ? "Faster than a room can follow. Slow down and let the laughs land."
    : wpm < PACE_SLOW_WPM ? "On the slow side. Long pauses or rereading can drag."
    : "A comfortable speaking pace.";
  return {
    key: "pace",
    status: wpm > PACE_FAST_WPM || wpm < PACE_SLOW_WPM ? "watch" : "good",
    label: "Pace",
    value: `${wpm} wpm`,
    detail,
    wpm,
  };
}

function accuracyCheck(input: ReadinessInput): ReadinessCheck {
  const pct = Math.round(input.accuracy * 100);
  if (input.mode === "freestyle") {
    return {
      key: "accuracy",
      status: input.accuracy >= READY_RECALL ? "good" : "watch",
      label: "Recall",
      value: `${pct}%`,
      detail: `You said ${pct}% of your script from memory, as written.`,
    };
  }
  return {
    key: "accuracy",
    status: input.accuracy >= CLOSE_READ_ACCURACY ? "good" : "watch",
    label: "Accuracy",
    value: `${pct}%`,
    detail: `You said ${pct}% of your script as written, reading along.`,
  };
}

export function assessReadiness(input: ReadinessInput): Readiness {
  const length = lengthCheck(input);
  const pace = paceCheck(input);
  const accuracy = accuracyCheck(input);
  const checks: ReadinessCheck[] = [
    { key: length.key, status: length.status, label: length.label, value: length.value, detail: length.detail },
    { key: pace.key, status: pace.status, label: pace.label, value: pace.value, detail: pace.detail },
    accuracy,
  ];
  const onTime = length.status === "good";
  const fromMemory = input.mode === "freestyle";

  if (fromMemory && onTime && input.accuracy >= READY_RECALL) {
    return {
      verdict: "ready",
      checks,
      headline: "You're ready. You gave it from memory, on time.",
    };
  }

  // Not yet: the most fixable problem leads, length before words.
  if (length.overBy > 0) {
    return {
      verdict: "not-yet",
      checks,
      headline: `Not yet. It runs about ${fmtClock(length.overBy)} long, so cut before you memorize.`,
    };
  }
  if (fromMemory && input.accuracy < CLOSE_RECALL) {
    return {
      verdict: "not-yet",
      checks,
      headline: "Not yet. Big parts didn't come back from memory. Drill the rough sections.",
    };
  }
  if (!fromMemory && input.accuracy < CLOSE_READ_ACCURACY) {
    return {
      verdict: "not-yet",
      checks,
      headline: "Not yet. Read it aloud a few more times until the words feel like yours.",
    };
  }

  return {
    verdict: "close",
    checks,
    headline: fromMemory
      ? "Close. A couple more runs from memory and you're there."
      : "Close. The words are there. Next, try it from memory.",
  };
}
