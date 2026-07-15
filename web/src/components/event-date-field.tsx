"use client";

// EventDateField — the one optional question every creation flow asks:
// "When's the speech?" A date input plus two quick chips ("This
// weekend", "Next month") and a "No date yet" escape. Skipping is
// free: the field starts empty, nothing validates it, and clearing is
// one click.
//
// The component owns its value and renders a real <input type="date">
// under `name`, so plain <form> + server-action flows pick it up with
// zero wiring. Flows that submit programmatically (the AI writer) pass
// `onChange` and read the value from their own state.
//
// Chip targets are computed on click, never at render, so server and
// client markup always match.

import { useState } from "react";

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// The coming Saturday; today if it already is Saturday.
function thisWeekend(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return isoDate(d);
}

function nextMonth(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return isoDate(d);
}

const chipStyle: React.CSSProperties = {
  background: "var(--color-whisper-gray)",
  color: "var(--color-midnight-ink)",
  border: "1px solid rgba(17,17,17,0.08)",
  borderRadius: 999,
  padding: "6px 14px",
  fontSize: 12.5,
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "background 120ms ease, border-color 120ms ease",
};

export function EventDateField({
  name = "event_date",
  onChange,
}: {
  name?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState("");

  function set(next: string) {
    setValue(next);
    onChange?.(next);
  }

  return (
    <div>
      <label
        htmlFor={`${name}-input`}
        className="text-caption"
        style={{ color: "var(--color-muted-ash)" }}
      >
        When&rsquo;s the speech?{" "}
        <span style={{ opacity: 0.7 }}>(optional)</span>
      </label>
      <div
        className="mt-2"
        style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
      >
        <input
          id={`${name}-input`}
          name={name}
          type="date"
          value={value}
          onChange={(e) => set(e.target.value)}
          className="input"
          style={{ width: 170, flexShrink: 0 }}
        />
        <button type="button" onClick={() => set(thisWeekend())} style={chipStyle}>
          This weekend
        </button>
        <button type="button" onClick={() => set(nextMonth())} style={chipStyle}>
          Next month
        </button>
        {value !== "" && (
          <button type="button" onClick={() => set("")} style={chipStyle}>
            No date yet
          </button>
        )}
      </div>
    </div>
  );
}
