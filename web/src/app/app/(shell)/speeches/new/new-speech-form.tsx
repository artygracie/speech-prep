"use client";

// New-speech intake. Designed so uploading a file and pasting text are
// peers — neither is the buried option.
//
// Files (.txt / .docx / .pdf) get POSTed to /api/extract-text which
// extracts plain text server-side and returns it. We drop that into the
// `body` field, same as paste.

import Link from "next/link";
import { useRef, useState, useTransition } from "react";

const ACCEPT = ".txt,.docx,.pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf";
const SUPPORTED_EXTS = [".txt", ".docx", ".pdf"];

export function NewSpeechForm({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileExt, setFileExt] = useState<string>("TXT");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  async function loadFile(file: File) {
    setError(null);
    const lower = file.name.toLowerCase();
    const ok = SUPPORTED_EXTS.some((e) => lower.endsWith(e));
    if (!ok) {
      setError("Try a .txt, .docx, or .pdf file — or paste the text below.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File is over 10MB. Try pasting the text instead.");
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
        setError(data.error ?? "Couldn't read that file. Try pasting the text instead.");
        return;
      }
      setBody(data.text);
      setFileName(file.name);
      const ext = lower.slice(lower.lastIndexOf(".") + 1).toUpperCase();
      setFileExt(ext);
    } catch {
      setError("Upload failed. Try again, or paste the text instead.");
    } finally {
      setExtracting(false);
    }
  }

  function clearFile() {
    setFileName(null);
    setBody("");
    if (fileRef.current) fileRef.current.value = "";
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

  const hasFile = fileName !== null;
  const dropDisabled = extracting || hasFile;

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 16 }}>
      {/* Analytics: how the script text arrived (speech_created event). */}
      <input type="hidden" name="source" value={hasFile ? "upload" : "paste"} />
      {/* Title first — it's the speech's identifier, and the cheapest thing
          to fill in. Asking for it after a long paste feels like a gotcha. */}
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
          onChange={(e) => setTitle(e.target.value)}
          className="input input-lg mt-2"
        />
      </div>

      {/* Drop zone — visually equal-weight to the paste box. */}
      <div>
        <label className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
          Upload your speech
        </label>
        <div
          onDragOver={(e) => {
            if (dropDisabled) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            if (dropDisabled) return;
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void loadFile(file);
          }}
          onClick={() => !dropDisabled && fileRef.current?.click()}
          role="button"
          tabIndex={dropDisabled ? -1 : 0}
          onKeyDown={(e) => {
            if (!dropDisabled && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
          className="mt-2"
          style={{
            border: `1.5px dashed ${
              dragOver ? "var(--color-midnight-ink)" : "rgba(17,17,17,0.18)"
            }`,
            background: dragOver ? "rgba(17,17,17,0.03)" : "var(--color-canvas-white)",
            borderRadius: 12,
            padding: hasFile || extracting ? "12px 20px" : "20px 20px",
            textAlign: "center",
            cursor: dropDisabled ? "default" : "pointer",
            transition: "border-color 120ms ease, background 120ms ease, padding 120ms ease",
          }}
        >
          {extracting ? (
            <div
              className="text-body-sm"
              style={{ color: "var(--color-muted-ash)" }}
            >
              Reading your file…
            </div>
          ) : hasFile ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                textAlign: "left",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 32,
                    height: 28,
                    borderRadius: 6,
                    background: "var(--color-midnight-ink)",
                    color: "var(--color-canvas-white)",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {fileExt}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    className="text-body-sm"
                    style={{
                      color: "var(--color-midnight-ink)",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {fileName}
                  </div>
                  <div
                    className="text-caption"
                    style={{ color: "var(--color-muted-ash)" }}
                  >
                    Loaded — edit below if you need to.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearFile();
                }}
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
                  flexShrink: 0,
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <>
              <div
                className="text-body"
                style={{ color: "var(--color-midnight-ink)", fontWeight: 500 }}
              >
                Drop your speech here
              </div>
              <div
                className="text-body-sm mt-2"
                style={{ color: "var(--color-muted-ash)" }}
              >
                or{" "}
                <span
                  style={{
                    textDecoration: "underline",
                    textUnderlineOffset: 3,
                    textDecorationColor: "rgba(17,17,17,0.3)",
                  }}
                >
                  click to choose a file
                </span>{" "}
                · .txt, .docx, .pdf
              </div>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadFile(f);
            }}
            style={{ display: "none" }}
          />
        </div>
        {error && (
          <p
            className="text-caption mt-2"
            style={{ color: "var(--color-phoenix-orange)" }}
          >
            {error}
          </p>
        )}
      </div>

      {/* OR divider */}
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: "var(--color-muted-ash)",
        }}
      >
        <span style={{ flex: 1, height: 1, background: "rgba(17,17,17,0.08)" }} />
        <span className="text-caption">or paste it</span>
        <span style={{ flex: 1, height: 1, background: "rgba(17,17,17,0.08)" }} />
      </div>

      {/* Paste box — peer to the drop zone, not buried. */}
      <div>
        <label
          htmlFor="ns-body"
          className="text-caption"
          style={{ color: "var(--color-muted-ash)" }}
        >
          The speech
        </label>
        <textarea
          id="ns-body"
          name="body"
          rows={5}
          placeholder="Paste it here. A rough draft is fine — even bullet points work."
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            // Once the user edits, the textarea is the source of truth,
            // not the file. Drop the filename badge so it isn't misleading.
            if (fileName) setFileName(null);
          }}
          className="input input-lg mt-2"
          style={{
            fontFamily: "var(--font-script)",
            fontSize: 16,
            lineHeight: 1.65,
          }}
        />
      </div>

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
