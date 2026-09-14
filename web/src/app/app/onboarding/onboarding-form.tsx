"use client";

// First-run intake form. One input surface (ScriptIntake): paste, drop a
// file, or browse. An uploaded document becomes a document card and
// suggests the title from its filename — the form should act like it
// understood what it was given.
//
// Submission goes through the server action passed in via `action`.

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { EventDateField } from "@/components/event-date-field";
import { OccasionField } from "@/components/occasion-field";
import {
  clearDemoDraft,
  getDemoDraftServerSnapshot,
  getDemoDraftSnapshot,
  subscribeDemoDraft,
} from "@/lib/demo-draft";
import { isOccasion } from "@/lib/occasions";
import { ScriptIntake } from "@/components/script-intake";

export function OnboardingForm({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  // A speech arriving from the public demo is already written and already
  // read out loud once, so it seeds this form rather than being asked for
  // again. Null state means "untouched", which lets the draft supply the
  // value without an effect writing it into state on mount.
  const draft = useSyncExternalStore(
    subscribeDemoDraft,
    getDemoDraftSnapshot,
    getDemoDraftServerSnapshot,
  );

  const [titleInput, setTitle] = useState<string | null>(null);
  const [titleSuggested, setTitleSuggested] = useState(false);
  const [occasionInput, setOccasion] = useState<string | null>(null);
  const titleTouched = useRef(false);
  const [pending, startTransition] = useTransition();

  const title = titleInput ?? draft?.title ?? "";
  const occasion =
    occasionInput ?? (draft && isOccasion(draft.occasion) ? draft.occasion : "");


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
      // The speech now lives in the account; a second one starts clean.
      clearDemoDraft();
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
        // Remount once the draft resolves on the client — ScriptIntake
        // seeds its own state from initialBody on mount only.
        key={draft ? "from-demo" : "blank"}
        rows={12}
        initialBody={draft?.script}
        helperText="We'll suggest section breaks for you. You can change them anytime."
        onInferOccasion={(o) => {
          if (isOccasion(o)) setOccasion(o);
        }}
        onSuggestTitle={(suggested) => {
          if (!titleTouched.current || !title.trim()) {
            setTitle(suggested);
            setTitleSuggested(true);
          }
        }}
      />

      {/* Occasion is the one required question (it keys emails, copy, and
          analytics); the date is optional and skipping it is free. */}
      <OccasionField value={occasion} onChange={setOccasion} />
      <EventDateField />

      <div>
        <button
          type="submit"
          className="btn-primary"
          disabled={pending || !title.trim() || !occasion}
          style={{ minWidth: 180, justifyContent: "center" }}
        >
          {pending ? "Setting up…" : "I'm ready →"}
        </button>
      </div>
    </form>
  );
}
