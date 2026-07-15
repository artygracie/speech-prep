"use client";

// New-speech intake. One input surface (ScriptIntake): paste into it,
// drop a file on it, or browse — an uploaded document becomes a document
// card with a suggested title, not a text dump. Cleanup belongs to the
// editor; this screen only confirms we read the file right.

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { EventDateField } from "@/components/event-date-field";
import { ScriptIntake } from "@/components/script-intake";

export function NewSpeechForm({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [titleSuggested, setTitleSuggested] = useState(false);
  const titleTouched = useRef(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = String(fd.get("body") ?? "");
    if (!body.trim()) {
      const ok = window.confirm(
        "Start with an empty script? You can paste it later in the editor.",
      );
      if (!ok) return;
    }
    startTransition(async () => {
      await action(fd);
    });
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 16 }}>
      {/* Title first — it's the speech's identifier, and the cheapest thing
          to fill in. An uploaded file suggests one from its filename. */}
      <div>
        <label
          htmlFor="ns-title"
          className="text-caption"
          style={{ color: "var(--color-muted-ash)" }}
        >
          Title
        </label>
        <input
          id="ns-title"
          name="title"
          required
          autoComplete="off"
          placeholder="e.g. Best-man speech for Tom"
          value={title}
          onChange={(e) => {
            titleTouched.current = true;
            setTitleSuggested(false);
            setTitle(e.target.value);
          }}
          onFocus={(e) => {
            // A suggested title selects on focus so replacing it is one
            // keystroke, keeping it is zero.
            if (titleSuggested) e.currentTarget.select();
          }}
          className="input input-lg mt-2"
        />
        {titleSuggested && (
          <p className="text-caption mt-2" style={{ color: "var(--color-muted-ash)" }}>
            Named from your file — edit it if that&rsquo;s not quite right.
          </p>
        )}
      </div>

      <ScriptIntake
        rows={7}
        helperText="We'll suggest section breaks for you. You can change them anytime."
        onSuggestTitle={(suggested) => {
          if (!titleTouched.current || !title.trim()) {
            setTitle(suggested);
            setTitleSuggested(true);
          }
        }}
      />

      {/* Optional event date. Skipping is free — the field starts empty
          and submits fine that way. */}
      <EventDateField />

      <div className="flex gap-3 items-center">
        <button
          type="submit"
          className="btn-primary"
          disabled={pending || !title.trim()}
        >
          {pending ? "Opening editor…" : "Open editor"}
        </button>
        <Link href="/app" className="btn-ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}
