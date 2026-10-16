// How long a recording's audio is kept.
//
// A wedding speech is rehearsed for a few weeks and then it's done; the
// audio of someone practising it has no use after that and is the most
// personal thing we hold. So audio expires a set time after the event,
// or after the take itself when the speech has no event date. Scripts,
// transcripts and reports are kept: they are the user's progress, and
// they are text the user wrote or said on purpose.
//
// One home for the rule: the privacy page prints `summary`, the billing
// page links to it, and /api/cron/purge-recordings deletes by
// `recordingExpiresAt`. Change the numbers here and nowhere else.

const DAY_MS = 24 * 60 * 60 * 1000;

export const RECORDING_RETENTION = {
  daysAfterEvent: 30,
  daysAfterTakeWithoutEvent: 90,
  summary:
    "We delete the audio of your recordings 30 days after your event date. If your speech has no event date, each recording is deleted 90 days after you made it.",
} as const;

// Parse a Postgres `date` (YYYY-MM-DD) as the end of that day in UTC, so
// the countdown never starts before the event is over anywhere.
function endOfEventDay(eventDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
}

export function recordingExpiresAt(eventDate: string | null, recordedAt: string): Date {
  const event = eventDate ? endOfEventDay(eventDate) : null;
  if (event !== null) {
    return new Date(event + RECORDING_RETENTION.daysAfterEvent * DAY_MS);
  }
  return new Date(
    new Date(recordedAt).getTime() + RECORDING_RETENTION.daysAfterTakeWithoutEvent * DAY_MS,
  );
}
