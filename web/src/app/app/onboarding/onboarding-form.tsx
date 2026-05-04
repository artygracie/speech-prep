"use client";

// First-run intake form. Client-side only so we can:
//  - read a .txt the user drops in and stuff it into the textarea, and
//  - soft-confirm if they submit with an empty body (the server action
//    accepts an empty body and creates a single "Open" section, but most
//    users who leave it blank do so by accident).
//
// Submission goes through the server action passed in via `action`.

import { useRef, useState, useTransition } from "react";

export function OnboardingForm({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function handleFile(file: File) {
    // .txt only for v1. Larger formats (.docx, .pdf) need server-side
    // parsing — Phase 2.
    if (!file.name.toLowerCase().endsWith(".txt")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setBody((prev) => (prev ? prev + "\n\n" + text : text));
    };
    reader.readAsText(file);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!body.trim()) {
      const ok = window.confirm(
        "Start with an empty script? You can paste it later in the editor.",
      );
      if (!ok) {
        e.preventDefault();
        return;
      }
    }
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
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
          onChange={(e) => setTitle(e.target.value)}
          className="input input-lg mt-2"
        />
      </div>

      <div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <label
            htmlFor="ob-body"
            className="text-caption"
            style={{ color: "var(--color-muted-ash)" }}
          >
            The speech
          </label>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-caption"
            style={{
              color: "var(--color-muted-ash)",
              textDecoration: "underline",
              textUnderlineOffset: 4,
              textDecorationColor: "rgba(17,17,17,0.18)",
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: "pointer",
            }}
          >
            Or upload a .txt
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />
        </div>
        <textarea
          id="ob-body"
          name="body"
          rows={14}
          placeholder="Paste it here. A rough draft is fine — even bullet points work."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="input input-lg mt-2"
          style={{
            fontFamily: "var(--font-script)",
            fontSize: 16,
            lineHeight: 1.65,
          }}
        />
        <p
          className="text-caption mt-2"
          style={{ color: "var(--color-muted-ash)" }}
        >
          We&rsquo;ll suggest section breaks for you. You can change them anytime.
        </p>
      </div>

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
