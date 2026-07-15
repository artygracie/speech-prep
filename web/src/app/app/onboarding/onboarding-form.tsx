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
  const [extracting, setExtracting] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  // Analytics: remembers whether any of the body came from a dropped file,
  // so speech_created can report source paste vs upload.
  const [usedFile, setUsedFile] = useState(false);

  async function handleFile(file: File) {
    setFileError(null);
    const lower = file.name.toLowerCase();
    const ok = [".txt", ".docx", ".pdf"].some((e) => lower.endsWith(e));
    if (!ok) {
      setFileError("Try a .txt, .docx, or .pdf file — or paste the text below.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFileError("File is over 10MB. Try pasting the text instead.");
      return;
    }
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract-text", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };
      if (!res.ok || !data.text) {
        setFileError(data.error ?? "Couldn't read that file. Try pasting the text instead.");
        return;
      }
      setBody((prev) => (prev ? prev + "\n\n" + data.text : data.text!));
      setUsedFile(true);
    } catch {
      setFileError("Upload failed. Try again, or paste the text instead.");
    } finally {
      setExtracting(false);
    }
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
      {/* Analytics: how the script text arrived (speech_created event). */}
      <input type="hidden" name="source" value={usedFile ? "upload" : "paste"} />
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
            disabled={extracting}
            className="text-caption"
            style={{
              color: "var(--color-muted-ash)",
              textDecoration: "underline",
              textUnderlineOffset: 4,
              textDecorationColor: "rgba(17,17,17,0.18)",
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: extracting ? "default" : "pointer",
              opacity: extracting ? 0.6 : 1,
            }}
          >
            {extracting ? "Reading…" : "Or upload a file"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.docx,.pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
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
        {fileError ? (
          <p
            className="text-caption mt-2"
            style={{ color: "var(--color-phoenix-orange)" }}
          >
            {fileError}
          </p>
        ) : (
          <p
            className="text-caption mt-2"
            style={{ color: "var(--color-muted-ash)" }}
          >
            We&rsquo;ll suggest section breaks for you. You can change them anytime.
          </p>
        )}
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
