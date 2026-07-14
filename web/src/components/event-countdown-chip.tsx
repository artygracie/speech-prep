// EventCountdownChip — a quiet "{occasion} — {n} days" pill for the
// speech detail header and dashboard cards. Renders only when the
// speech has an event date that hasn't passed; on the day itself it
// says "Speech day!". No urgency theatrics — same soft pill as the
// occasion badge.
//
// Server component. Day math runs in the server's timezone, which is
// good enough for a calendar-date countdown.

import { daysUntil } from "@/lib/lifecycle";

export function EventCountdownChip({
  occasion,
  eventDate,
}: {
  occasion: string | null;
  eventDate: string | null;
}) {
  const days = daysUntil(eventDate);
  if (days === null || days < 0) return null;

  const label =
    days === 0
      ? "Speech day!"
      : `${occasion ?? "Speech"} — ${days} ${days === 1 ? "day" : "days"}`;

  return (
    <span className="badge pill-soft">
      <span className="dot" />
      {label}
    </span>
  );
}
