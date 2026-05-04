"use client";

// Document-style script editor.
//
// Mental model: the user is editing a single document. Section breaks live
// inline; the outline rail on the left auto-derives from the headings and
// is read-only. Save bumps the version on the server.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveScript } from "@/app/app/actions";

type SectionInput = { id: string; name: string; targetSec: number; body: string };
type Block =
  | { kind: "heading"; id: string; name: string; targetSec: number }
  | { kind: "paragraph"; id: string; text: string };

function fmtTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function sectionsToBlocks(sections: SectionInput[]): Block[] {
  const out: Block[] = [];
  for (const s of sections) {
    out.push({ kind: "heading", id: s.id || "h-" + uid(), name: s.name, targetSec: s.targetSec });
    const paras = (s.body || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paras.length === 0) {
      out.push({ kind: "paragraph", id: "p-" + uid(), text: "" });
    } else {
      for (const p of paras) out.push({ kind: "paragraph", id: "p-" + uid(), text: p });
    }
  }
  return out;
}

export function ScriptEditor({
  speechId,
  title,
  currentVersion,
  sections,
}: {
  speechId: string;
  title: string;
  currentVersion: number;
  sections: SectionInput[];
}) {
  const router = useRouter();
  const [blocks, setBlocks] = useState<Block[]>(() => sectionsToBlocks(sections));
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const docRef = useRef<HTMLDivElement>(null);

  const totalTarget = useMemo(
    () =>
      blocks
        .filter((b): b is Extract<Block, { kind: "heading" }> => b.kind === "heading")
        .reduce((a, h) => a + Number(h.targetSec || 0), 0),
    [blocks],
  );
  const totalWords = useMemo(
    () =>
      blocks
        .filter((b): b is Extract<Block, { kind: "paragraph" }> => b.kind === "paragraph")
        .reduce((a, p) => a + p.text.split(/\s+/).filter(Boolean).length, 0),
    [blocks],
  );

  const headings = useMemo(
    () => blocks.filter((b): b is Extract<Block, { kind: "heading" }> => b.kind === "heading"),
    [blocks],
  );

  const markDirty = useCallback(() => setDirty(true), []);

  // ---------- Block operations ----------
  function updateBlock(id: string, patch: Partial<Block>) {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)),
    );
    markDirty();
  }
  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    markDirty();
  }
  function insertAfter(id: string, ...inserts: Block[]) {
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.id === id);
      if (i < 0) return [...prev, ...inserts];
      return [...prev.slice(0, i + 1), ...inserts, ...prev.slice(i + 1)];
    });
    markDirty();
  }

  function appendNewSectionAtEnd() {
    const headingId = "h-" + uid();
    setBlocks((prev) => [
      ...prev,
      { kind: "heading", id: headingId, name: "New section", targetSec: 30 },
      { kind: "paragraph", id: "p-" + uid(), text: "" },
    ]);
    markDirty();
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-block-id="${headingId}"] .doc-heading-name`);
      if (el) {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    });
  }

  function insertBreakAtCursor() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      appendNewSectionAtEnd();
      return;
    }
    const node = sel.anchorNode;
    const para = (node && (node.nodeType === 3 ? node.parentElement : (node as HTMLElement)))?.closest?.(
      ".doc-paragraph",
    ) as HTMLElement | null;
    if (!para) {
      appendNewSectionAtEnd();
      return;
    }
    const id = para.dataset.blockId!;
    const fullText = para.textContent ?? "";
    const offset = sel.anchorOffset;
    const before = fullText.slice(0, offset);
    const after = fullText.slice(offset);

    const headingId = "h-" + uid();
    const newParaId = "p-" + uid();
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.id === id);
      if (i < 0) return prev;
      const replaced: Block = { kind: "paragraph", id, text: before };
      const inserts: Block[] = [
        { kind: "heading", id: headingId, name: "New section", targetSec: 30 },
        { kind: "paragraph", id: newParaId, text: after },
      ];
      return [...prev.slice(0, i), replaced, ...inserts, ...prev.slice(i + 1)];
    });
    markDirty();

    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-block-id="${headingId}"] .doc-heading-name`);
      if (el) {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel2 = window.getSelection();
        sel2?.removeAllRanges();
        sel2?.addRange(range);
      }
    });
  }

  function removeHeading(id: string) {
    if (headings.length <= 1) {
      // Need at least one heading.
      return;
    }
    removeBlock(id);
  }

  function editTime(id: string) {
    const block = blocks.find((b) => b.id === id);
    if (!block || block.kind !== "heading") return;
    const input = window.prompt(`Target time for "${block.name}" — in seconds:`, String(block.targetSec));
    if (input === null) return;
    const v = Math.max(5, Math.round(Number(input) || 0));
    updateBlock(id, { targetSec: v });
  }

  // Cmd/Ctrl-S to save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  function save() {
    setErrorMsg(null);
    const payload = blocks.map((b) =>
      b.kind === "heading"
        ? { kind: "heading" as const, name: b.name, target_seconds: b.targetSec }
        : { kind: "paragraph" as const, text: b.text },
    );
    startTransition(async () => {
      try {
        await saveScript(speechId, payload);
        setDirty(false);
        router.push(`/app/speeches/${speechId}`);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  function scrollToHeading(id: string) {
    const target = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.add("is-flash");
    setTimeout(() => target.classList.remove("is-flash"), 800);
  }

  return (
    <>
      <style>{`
        .editor-grid {
          display: grid; grid-template-columns: 220px 1fr; gap: 56px;
          margin-top: 28px; align-items: start;
        }
        @media (max-width: 1100px) { .editor-grid { grid-template-columns: 1fr; gap: 32px; } .editor-outline { order: 2; } }
        .editor-outline { position: sticky; top: 90px; padding: 4px 0; }
        .outline-link {
          display: grid; grid-template-columns: auto 1fr auto; gap: 10px;
          align-items: baseline;
          padding: 7px 8px; border-radius: 6px;
          color: var(--color-muted-ash);
          font-size: 13.5px; line-height: 1.4;
          text-decoration: none; cursor: pointer; background: transparent; border: 0; width: 100%;
          transition: background 120ms ease, color 120ms ease; text-align: left;
        }
        .outline-link:hover { background: var(--color-whisper-gray); color: var(--color-midnight-ink); }
        .outline-num {
          font-family: var(--font-serif); font-style: italic; font-size: 12px;
          color: var(--color-muted-ash); font-variant-numeric: tabular-nums;
        }
        .outline-name { color: var(--color-midnight-ink); font-weight: 500; }
        .outline-time { font-size: 11px; letter-spacing: 0.04em; color: var(--color-muted-ash); font-variant-numeric: tabular-nums; }

        .editor-toolbar { display: flex; align-items: center; gap: 6px; padding: 0 0 14px; margin-bottom: 10px; }
        .editor-toolbar .btn-ghost { padding: 6px 10px; font-size: 13px; }

        .editor-doc {
          background: var(--color-canvas-white);
          border: 1px solid rgba(17,17,17,0.08);
          border-radius: 12px;
          padding: 56px 64px 64px;
          min-height: 60vh;
        }
        @media (max-width: 880px) { .editor-doc { padding: 32px 28px 40px; } }

        .doc-heading { margin: 36px 0 8px; position: relative; }
        .doc-heading:first-child { margin-top: 0; }
        .doc-heading.is-flash::before {
          content: ""; position: absolute; inset: -8px -12px; border-radius: 8px;
          background: rgba(251,199,104,0.25);
          animation: heading-flash 800ms ease-out forwards;
        }
        @keyframes heading-flash { to { background: transparent; } }
        .doc-heading-row {
          display: flex; align-items: baseline; gap: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid rgba(17,17,17,0.06);
        }
        .doc-heading-marker {
          font-family: var(--font-serif); font-style: italic;
          color: var(--color-muted-ash); opacity: 0.5;
          font-size: 18px; line-height: 1;
        }
        .doc-heading-name {
          font-size: 13px; font-weight: 500; letter-spacing: 0.12em;
          text-transform: uppercase; color: var(--color-midnight-ink);
          outline: none; flex: 1; min-width: 0;
        }
        .doc-heading-name:empty::before {
          content: attr(data-placeholder);
          color: var(--color-muted-ash); opacity: 0.6;
        }
        .doc-heading-time {
          font-size: 11px; font-weight: 500; letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--color-muted-ash); font-variant-numeric: tabular-nums;
          padding: 4px 8px; border-radius: 6px;
          background: transparent; cursor: pointer;
          border: 0;
          transition: background 120ms ease, color 120ms ease;
        }
        .doc-heading-time:hover { background: var(--color-whisper-gray); color: var(--color-midnight-ink); }
        .doc-heading-remove {
          opacity: 0; transition: opacity 120ms ease;
          background: transparent; padding: 4px;
          color: var(--color-muted-ash);
          border-radius: 4px; cursor: pointer; border: 0;
        }
        .doc-heading:hover .doc-heading-remove { opacity: 1; }
        .doc-heading-remove:hover { color: var(--color-leadgen-red); background: var(--color-whisper-gray); }

        .doc-paragraph {
          font-family: var(--font-script);
          font-size: 19px; line-height: 1.7;
          color: var(--color-midnight-ink);
          margin: 16px 0; outline: none;
          white-space: pre-wrap; word-wrap: break-word;
        }
        .doc-paragraph:empty::before {
          content: attr(data-placeholder);
          color: var(--color-muted-ash); opacity: 0.6;
          pointer-events: none;
        }
        .doc-paragraph:focus { background: rgba(251,199,104,0.06); border-radius: 4px; }

        .editor-statusbar {
          display: flex; align-items: center; gap: 8px;
          padding: 16px 4px 0;
          border-top: 1px solid rgba(17,17,17,0.06);
          margin-top: 28px; color: var(--color-muted-ash);
        }
        .editor-topbar {
          display: flex; align-items: flex-end; justify-content: space-between; gap: 16px;
          padding-bottom: 24px;
          border-bottom: 1px solid rgba(17,17,17,0.06);
        }
        .editor-title-display {
          font-family: var(--font-script);
          font-size: clamp(28px, 4vw, 40px);
          line-height: 1.05;
          letter-spacing: -0.02em;
          font-weight: 500;
        }
      `}</style>

      <div className="editor-shell">
        <header className="editor-topbar">
          <div>
            <Link href={`/app/speeches/${speechId}`} className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
              ← Back to speech
            </Link>
            <h1 className="editor-title-display mt-2">{title}</h1>
            <p className="text-caption mt-2" style={{ color: "var(--color-muted-ash)" }}>
              Editing v{currentVersion} · headings split your speech into timed sections
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
              {dirty ? "Unsaved changes" : pending ? "Saving…" : ""}
            </span>
            <Link href={`/app/speeches/${speechId}`} className="btn-ghost">
              Cancel
            </Link>
            <button onClick={save} className="btn-primary" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </header>

        {errorMsg && (
          <p className="text-body-sm mt-4" style={{ color: "var(--color-leadgen-red)" }}>
            {errorMsg}
          </p>
        )}

        <div className="editor-grid">
          {/* Outline */}
          <aside className="editor-outline">
            <div className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
              Outline
            </div>
            <nav className="mt-4" style={{ display: "grid", gap: 2 }}>
              {headings.length === 0 ? (
                <p className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
                  No section breaks yet.
                </p>
              ) : (
                headings.map((h, i) => (
                  <button key={h.id} className="outline-link" onClick={() => scrollToHeading(h.id)}>
                    <span className="outline-num">{String(i + 1).padStart(2, "0")}</span>
                    <span className="outline-name">{h.name}</span>
                    <span className="outline-time">{fmtTime(h.targetSec)}</span>
                  </button>
                ))
              )}
            </nav>
            <button
              onClick={appendNewSectionAtEnd}
              className="text-body-sm mt-6"
              style={{
                color: "var(--color-muted-ash)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: 0,
                padding: 0,
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 14 }}>+</span> Add section break at end
            </button>
          </aside>

          {/* Document canvas */}
          <div className="editor-canvas">
            <div className="editor-toolbar">
              <button onClick={insertBreakAtCursor} className="btn-ghost" title="Insert section break at cursor">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="12" x2="9" y2="9" />
                  <line x1="4" y1="12" x2="9" y2="15" />
                </svg>
                Section break
              </button>
            </div>

            <div ref={docRef} className="editor-doc">
              {blocks.map((b) =>
                b.kind === "heading" ? (
                  <div key={b.id} className="doc-heading" data-block-id={b.id}>
                    <div className="doc-heading-row">
                      <span className="doc-heading-marker">§</span>
                      <span
                        className="doc-heading-name"
                        contentEditable
                        suppressContentEditableWarning
                        spellCheck={false}
                        data-placeholder="Section name"
                        onInput={(e) => {
                          const text = (e.currentTarget.textContent ?? "").trim() || "Untitled";
                          updateBlock(b.id, { name: text });
                        }}
                        onBlur={(e) => {
                          if (!e.currentTarget.textContent?.trim()) {
                            e.currentTarget.textContent = "Untitled";
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            (e.target as HTMLElement).blur();
                          }
                        }}
                      >
                        {b.name}
                      </span>
                      <button className="doc-heading-time" onClick={() => editTime(b.id)} title="Edit target time">
                        {fmtTime(b.targetSec)}
                      </button>
                      <button
                        className="doc-heading-remove"
                        onClick={() => removeHeading(b.id)}
                        aria-label="Remove section break"
                        title="Remove section break"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ) : (
                  <p
                    key={b.id}
                    className="doc-paragraph"
                    data-block-id={b.id}
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck
                    data-placeholder="Write here, or paste your speech."
                    onInput={(e) => {
                      const text = e.currentTarget.textContent ?? "";
                      updateBlock(b.id, { text });
                    }}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        insertBreakAtCursor();
                      }
                    }}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData("text/plain");
                      if (!text) return;
                      e.preventDefault();
                      document.execCommand("insertText", false, text);
                    }}
                  >
                    {b.text}
                  </p>
                ),
              )}
            </div>

            <div className="editor-statusbar">
              <span className="text-caption num">
                {totalWords} {totalWords === 1 ? "word" : "words"}
              </span>
              <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
                ·
              </span>
              <span className="text-caption num">
                ~{fmtTime(Math.round((totalWords / 145) * 60))} at 145 wpm
              </span>
              <span style={{ marginLeft: "auto" }} />
              <span className="text-caption num" style={{ color: "var(--color-muted-ash)" }}>
                Target
              </span>
              <span className="text-caption num" style={{ fontWeight: 500 }}>
                {fmtTime(totalTarget)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
