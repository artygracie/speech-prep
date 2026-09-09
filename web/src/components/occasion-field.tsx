"use client";

// OccasionField — "What's the speech for?" as eight chips, one required
// pick. Sits next to EventDateField in every creation flow.
//
// Renders a hidden input under `name` so plain <form> + server-action
// flows pick it up with zero wiring; programmatic flows pass `onChange`.
// `required` is enforced by the hidden input so native form validation
// blocks submit until a chip is chosen.

import { useState } from "react";
import { OCCASIONS, type Occasion } from "@/lib/occasions";

const chipBase: React.CSSProperties = {
  border: "1px solid rgba(17,17,17,0.08)",
  borderRadius: 999,
  padding: "7px 14px",
  fontSize: 13,
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "background 120ms ease, border-color 120ms ease, color 120ms ease",
};

const chipIdle: React.CSSProperties = {
  ...chipBase,
  background: "var(--color-whisper-gray)",
  color: "var(--color-midnight-ink)",
};

const chipActive: React.CSSProperties = {
  ...chipBase,
  background: "var(--color-midnight-ink)",
  borderColor: "var(--color-midnight-ink)",
  color: "var(--color-canvas-white)",
};

export function OccasionField({
  name = "occasion",
  defaultValue = "",
  required = true,
  onChange,
}: {
  name?: string;
  defaultValue?: Occasion | "";
  required?: boolean;
  onChange?: (value: Occasion | "") => void;
}) {
  const [value, setValue] = useState<Occasion | "">(defaultValue);

  function pick(next: Occasion) {
    const resolved = next === value && !required ? "" : next;
    setValue(resolved);
    onChange?.(resolved);
  }

  return (
    <div>
      <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
        What&rsquo;s the speech for?
      </span>
      <div
        role="radiogroup"
        aria-label="Occasion"
        className="mt-2"
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        {OCCASIONS.map((o) => {
          const active = o === value;
          return (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(o)}
              style={active ? chipActive : chipIdle}
            >
              {o}
            </button>
          );
        })}
      </div>
      {/* Hidden but validated: an empty required input blocks native submit
          and the browser focuses it, so the group above needs to be right
          next to it for the message to make sense. */}
      <input
        type="text"
        name={name}
        value={value}
        required={required}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
        onChange={() => {}}
      />
    </div>
  );
}
