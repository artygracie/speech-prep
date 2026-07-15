"use client";

// ScriptIntake — the one input surface for getting a speech into the
// product. Three ways in, one mental model:
//
//   empty state : a paste-ready textarea that also accepts drag-drop and
//                 click-to-browse (.txt / .docx / .pdf).
//   file state  : the surface becomes a document card — filename, word
//                 count, estimated spoken time, a doc-styled preview of
//                 the opening lines — with View full text / Edit as
//                 text / Remove. No editable dump: trimming belongs to
//                 the editor, this screen only confirms we read it right.
//
// The component owns extraction and carries `body`, `source`, and
// `occasion` into the parent <form> via form fields. Parents keep title,
// date, and submit; `onSuggestTitle` hands them a cleaned filename title
// to apply if the user hasn't typed one.

import { useRef, useState } from "react";
import {
  inferOccasion,
  spokenTimeLabel,
  countWords,
  titleFromFilename,
} from "@/lib/intake";

const ACCEPT =
  ".txt,.docx,.pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf";
const SUPPORTED_EXTS = [".txt", ".docx", ".pdf"];
const PREVIEW_WORDS = 46;

// "upload" is the hero-dropzone empty state (the default — the fork page
// routed writing-intent away, so this surface expects a document).
// "paste" is the textarea fallback. "file" is the document card.
type Mode = "upload" | "paste" | "file";

export function ScriptIntake({
  rows = 8,
  helperText,
  onSuggestTitle,
  initialFile,
}: {
  rows?: number;
  helperText?: string;
  onSuggestTitle?: (title: string) => void;
  /** Pre-load the file-card state without a network round-trip. Exists
   *  for the /dev/intake visual harness — real flows always go through
   *  loadFile(). */
  initialFile?: { name: string; body: string; pages?: number };
}) {
  const [mode, setMode] = useState<Mode>(initialFile ? "file" : "upload");
  const [body, setBody] = useState(initialFile?.body ?? "");
  // True once any of the body arrived via a file, even after "Edit as
  // text" — analytics wants how the words got here, not the current UI.
  const [usedFile, setUsedFile] = useState(Boolean(initialFile));
  const [fileName, setFileName] = useState(initialFile?.name ?? "");
  const [fileExt, setFileExt] = useState(
    initialFile ? initialFile.name.slice(initialFile.name.lastIndexOf(".") + 1).toUpperCase() : "TXT",
  );
  const [pages, setPages] = useState<number | null>(initialFile?.pages ?? null);
  const [occasion, setOccasion] = useState<string | null>(
    initialFile ? inferOccasion(initialFile.name, initialFile.body) : null,
  );
  const [occasionDismissed, setOccasionDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadFile(file: File) {
    setError(null);
    const lower = file.name.toLowerCase();
    if (!SUPPORTED_EXTS.some((e) => lower.endsWith(e))) {
      setError("Try a .txt, .docx, or .pdf file — or paste the text.");
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
        pages?: number;
        error?: string;
      };
      if (!res.ok || !data.text) {
        setError(data.error ?? "Couldn't read that file. Try pasting the text instead.");
        return;
      }
      setBody(data.text);
      setUsedFile(true);
      setFileName(file.name);
      setFileExt(lower.slice(lower.lastIndexOf(".") + 1).toUpperCase());
      setPages(typeof data.pages === "number" ? data.pages : null);
      setOccasion(inferOccasion(file.name, data.text));
      setOccasionDismissed(false);
      setExpanded(false);
      setMode("file");
      const suggested = titleFromFilename(file.name);
      if (suggested && onSuggestTitle) onSuggestTitle(suggested);
    } catch {
      setError("Upload failed. Try again, or paste the text instead.");
    } finally {
      setExtracting(false);
    }
  }

  function removeFile() {
    setMode("upload");
    setBody("");
    setUsedFile(false);
    setFileName("");
    setPages(null);
    setOccasion(null);
    setExpanded(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function editAsText() {
    // Keep the words, drop the card. Source stays "upload" — that's how
    // the text arrived.
    setMode("paste");
    setExpanded(false);
  }

  const words = countWords(body);
  const timeLabel = spokenTimeLabel(body);
  const previewText = (() => {
    const ws = body.trim().split(/\s+/);
    if (ws.length <= PREVIEW_WORDS) return body.trim();
    return ws.slice(0, PREVIEW_WORDS).join(" ") + " …";
  })();
  const metaParts = [
    pages ? `${pages} page${pages === 1 ? "" : "s"}` : null,
    `${words.toLocaleString()} word${words === 1 ? "" : "s"}`,
    timeLabel ? `reads at ${timeLabel}` : null,
  ].filter(Boolean);

  return (
    <div>
      {/* Fields that ride along with the parent form. body must always be
          present; outside paste mode it lives in a hidden textarea. */}
      <input type="hidden" name="source" value={usedFile ? "upload" : "paste"} />
      {mode !== "paste" && <textarea name="body" value={body} readOnly hidden />}
      {mode === "file" && occasion && !occasionDismissed && (
        <input type="hidden" name="occasion" value={occasion} />
      )}

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <label
          htmlFor="si-body"
          className="text-caption"
          style={{ color: "var(--color-muted-ash)" }}
        >
          The speech
        </label>
        {mode === "paste" && (
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
        )}
      </div>

      {mode === "upload" ? (
        <>
          <div
            onDragOver={(e) => {
              if (extracting) return;
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              if (extracting) return;
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void loadFile(f);
            }}
            onClick={() => !extracting && fileRef.current?.click()}
            role="button"
            tabIndex={extracting ? -1 : 0}
            onKeyDown={(e) => {
              if (!extracting && (e.key === "Enter" || e.key === " ")) {
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
              borderRadius: 14,
              padding: "56px 24px",
              textAlign: "center",
              cursor: extracting ? "default" : "pointer",
              transition: "border-color 120ms ease, background 120ms ease",
            }}
          >
            {extracting ? (
              <div className="text-body" style={{ color: "var(--color-muted-ash)" }}>
                Reading your file…
              </div>
            ) : (
              <>
                <div
                  className="text-body"
                  style={{ color: "var(--color-midnight-ink)", fontWeight: 500, fontSize: 18 }}
                >
                  Drag your speech here
                </div>
                <div className="text-body-sm mt-2" style={{ color: "var(--color-muted-ash)" }}>
                  or{" "}
                  <span
                    style={{
                      textDecoration: "underline",
                      textUnderlineOffset: 3,
                      textDecorationColor: "rgba(17,17,17,0.3)",
                    }}
                  >
                    click to browse
                  </span>{" "}
                  · PDF, Word, .txt
                </div>
              </>
            )}
          </div>
          <p className="text-caption mt-3" style={{ color: "var(--color-muted-ash)" }}>
            No file?{" "}
            <button
              type="button"
              onClick={() => setMode("paste")}
              style={{
                background: "transparent",
                border: 0,
                padding: 0,
                cursor: "pointer",
                font: "inherit",
                color: "inherit",
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              Paste the text instead
            </button>
          </p>
        </>
      ) : mode === "paste" ? (
        <div
          onDragOver={(e) => {
            if (extracting) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            if (extracting) return;
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void loadFile(f);
          }}
          style={{
            position: "relative",
            borderRadius: 12,
            outline: dragOver ? "2px dashed var(--color-midnight-ink)" : "none",
            outlineOffset: 2,
          }}
        >
          <textarea
            id="si-body"
            name="body"
            rows={rows}
            placeholder={
              "Paste it here — or drop a .txt, .docx, or .pdf on this box. A rough draft is fine, even bullet points work."
            }
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="input input-lg mt-2"
            style={{
              fontFamily: "var(--font-script)",
              fontSize: 16,
              lineHeight: 1.65,
            }}
          />
          {dragOver && (
            <div
              aria-hidden="true"
              className="text-body"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(255,255,255,0.85)",
                borderRadius: 12,
                fontWeight: 500,
                pointerEvents: "none",
              }}
            >
              Drop it — we&rsquo;ll read it for you.
            </div>
          )}
        </div>
      ) : (
        <div
          className="mt-2"
          style={{
            border: "1px solid rgba(17,17,17,0.1)",
            borderRadius: 12,
            background: "var(--color-canvas-white)",
            overflow: "hidden",
          }}
        >
          {/* Card header: file identity + actions */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px 16px",
              borderBottom: "1px solid rgba(17,17,17,0.06)",
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
                <div className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
                  {metaParts.join(" · ")}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 14, flexShrink: 0 }}>
              <CardAction onClick={editAsText}>Edit as text</CardAction>
              <CardAction onClick={removeFile}>Remove</CardAction>
            </div>
          </div>

          {/* Occasion chip — inferred, dismissible, rides along on submit. */}
          {occasion && !occasionDismissed && (
            <div style={{ padding: "10px 16px 0" }}>
              <span
                className="text-caption"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  border: "1px solid rgba(17,17,17,0.12)",
                  borderRadius: 999,
                  padding: "4px 10px",
                  color: "var(--color-midnight-ink)",
                }}
              >
                Sounds like: {occasion}
                <button
                  type="button"
                  aria-label={`Not a ${occasion.toLowerCase()}`}
                  onClick={() => setOccasionDismissed(true)}
                  style={{
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    cursor: "pointer",
                    color: "var(--color-muted-ash)",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </span>
            </div>
          )}

          {/* Doc-styled preview of the opening lines. Read-only on
              purpose — cleanup happens in the editor. */}
          <div style={{ padding: "12px 16px 4px" }}>
            <p
              style={{
                fontFamily: "var(--font-script)",
                fontSize: 15,
                lineHeight: 1.7,
                color: "var(--color-midnight-ink)",
                whiteSpace: "pre-wrap",
                margin: 0,
                ...(expanded
                  ? { maxHeight: 320, overflowY: "auto" }
                  : {}),
              }}
            >
              {expanded ? body : previewText}
            </p>
          </div>
          <div style={{ padding: "4px 16px 12px" }}>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
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
              {expanded ? "Show less" : "View full text"}
            </button>
          </div>
        </div>
      )}

      {error ? (
        <p className="text-caption mt-2" style={{ color: "var(--color-phoenix-orange)" }}>
          {error}
        </p>
      ) : mode === "file" ? (
        <p className="text-caption mt-2" style={{ color: "var(--color-muted-ash)" }}>
          Looks wrong?{" "}
          <button
            type="button"
            onClick={editAsText}
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: "pointer",
              font: "inherit",
              color: "inherit",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            Edit the text
          </button>{" "}
          — otherwise you&rsquo;ll fine-tune it in the editor.
        </p>
      ) : mode === "paste" && helperText ? (
        <p className="text-caption mt-2" style={{ color: "var(--color-muted-ash)" }}>
          {helperText}
        </p>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadFile(f);
          e.target.value = "";
        }}
        style={{ display: "none" }}
      />
    </div>
  );
}

function CardAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
      {children}
    </button>
  );
}
