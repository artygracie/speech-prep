"use client";

// First-run intake form. One input surface (ScriptIntake): paste, drop a
// file, or browse. An uploaded document becomes a document card and
// suggests the title from its filename — the form should act like it
// understood what it was given.
//
// Submission goes through the server action passed in via `action`.

import { useRef, useState, useTransition } from "react";
import { EventDateField } from "@/components/event-date-field";
import { ScriptIntake } from "@/components/script-intake";

export function OnboardingForm({
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
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 24 }}>
      <div>
        <label
          htmlFor="ob-title"
          className="text-caption"
          style={{ color: "var(--color-muted-ash)" }}
        >
          What&rsquo;s it for?
        </label>
        <input
          id="ob-title"
          name="title"
          required
          autoFocus
          autoComplete="off"
          placeholder='e.g. "Best-man speech for Tom"'
          value={title}
          onChange={(e) => {
            titleTouched.current = true;
            setTitleSuggested(false);
            setTitle(e.target.value);
          }}
          onFocus={(e) => {
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
        rows={12}
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

      <div>
        <button
          type="submit"
          className="btn-primary"
          disabled={pending || !title.trim()}
          style={{ minWidth: 180, justifyContent: "center" }}
        >
          {pending ? "Setting up…" : "I'm ready →"}
        </button>
      </div>
    </form>
  );
}
