"use client";

// Speech writer. Two phases:
//
//   input    — form: title, occasion, duration, notes/bullet points
//   editing  — two-column: editable doc (left) + AI chat panel (right)
//
// AI features:
//   - Initial generation streams token-by-token into the doc textarea.
//   - Chat panel: plain-language instructions rewrite the whole speech.
//   - Selection refine: highlight a passage → type a note → only that
//     passage is rewritten and spliced back in.
//
// "Start practicing" calls createSpeechFromWriter, auto-sections the
// text, and redirects to the recorder.

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { createSpeechFromWriter } from "@/app/app/actions";

type Phase = "input" | "generating" | "editing";
type ChatMessage = { role: "user" | "assistant"; text: string };

const OCCASIONS = [
  "Best man speech",
  "Maid of honor speech",
  "Wedding toast",
  "Father of the bride",
  "Mother of the bride",
  "Graduation speech",
  "Keynote talk",
  "Conference presentation",
  "Retirement party toast",
  "Eulogy / memorial speech",
  "Birthday toast",
  "Award acceptance speech",
  "Work presentation",
];

const DURATIONS = [
  { label: "1 minute", value: 1 },
  { label: "2 minutes", value: 2 },
  { label: "3 minutes", value: 3 },
  { label: "5 minutes", value: 5 },
  { label: "7 minutes", value: 7 },
  { label: "10 minutes", value: 10 },
  { label: "15 minutes", value: 15 },
  { label: "20 minutes", value: 20 },
];

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function fmtDuration(words: number) {
  const minutes = words / 140;
  if (minutes < 1) return `~${Math.round(minutes * 60)}s`;
  return `~${minutes.toFixed(1).replace(".0", "")} min`;
}

// Returns the range [start, end) in newText that differs from oldText.
// Used to highlight what the AI changed after a chat refinement.
function findChangedRange(
  oldText: string,
  newText: string,
): { start: number; end: number } | null {
  if (oldText === newText) return null;
  let start = 0;
  while (
    start < oldText.length &&
    start < newText.length &&
    oldText[start] === newText[start]
  ) start++;
  let endOld = oldText.length;
  let endNew = newText.length;
  while (
    endOld > start &&
    endNew > start &&
    oldText[endOld - 1] === newText[endNew - 1]
  ) { endOld--; endNew--; }
  return { start, end: endNew };
}

async function readStream(
  response: Response,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    onChunk(chunk);
  }
  return full;
}

export function SpeechWriter() {
  const [phase, setPhase] = useState<Phase>("input");

  // Input form state
  const [title, setTitle] = useState("");
  const [occasion, setOccasion] = useState("");
  const [occasionCustom, setOccasionCustom] = useState("");
  const [duration, setDuration] = useState(5);
  const [notes, setNotes] = useState("");
  const [genError, setGenError] = useState<string | null>(null);

  // Editing state
  const [speechText, setSpeechText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Selection state
  const [selection, setSelection] = useState<{
    text: string;
    start: number;
    end: number;
  } | null>(null);
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null);
  const [selectionNote, setSelectionNote] = useState("");
  const [refiningSelection, setRefiningSelection] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverInputRef = useRef<HTMLInputElement>(null);

  // Chat panel state
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  // Practice submission
  const [savePending, startSaveTransition] = useTransition();

  const effectiveOccasion = occasion === "__custom__" ? occasionCustom : occasion;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // ── Generation ──────────────────────────────────────────────────────────────

  async function handleGenerate() {
    if (!title.trim()) return;
    setGenError(null);
    setPhase("generating");
    setStreaming(true);
    setSpeechText("");
    setChatHistory([]);

    try {
      const res = await fetch("/api/write-speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          occasion: effectiveOccasion || "speech",
          durationMinutes: duration,
          notes: notes.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Generation failed (${res.status})`);
      }

      let accumulated = "";
      await readStream(res, (chunk) => {
        accumulated += chunk;
        setSpeechText(accumulated);
      });

      setPhase("editing");
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setPhase("input");
    } finally {
      setStreaming(false);
    }
  }

  // ── Selection detection ───────────────────────────────────────────────────

  function clearSelection() {
    setSelection(null);
    setSelectionPos(null);
    setSelectionNote("");
  }

  function handleTextareaMouseUp(e: React.MouseEvent<HTMLTextAreaElement>) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== end && end - start > 3) {
      setSelection({ text: el.value.slice(start, end), start, end });
      setSelectionPos({ x: e.clientX, y: e.clientY });
      // Focus the popover input on next frame so user can type immediately
      requestAnimationFrame(() => popoverInputRef.current?.focus());
    } else {
      clearSelection();
    }
  }

  // Close popover on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!selection) return;
      const target = e.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        textareaRef.current?.contains(target)
      ) return;
      clearSelection();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // Close on Escape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selection) clearSelection();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // ── Selection refinement ──────────────────────────────────────────────────

  async function handleSelectionRefine() {
    if (!selection || !selectionNote.trim() || refiningSelection) return;
    setRefiningSelection(true);

    try {
      const res = await fetch("/api/refine-speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "selection",
          currentText: speechText,
          instruction: selectionNote.trim(),
          selection: selection.text,
        }),
      });

      if (!res.ok) throw new Error("Refinement failed");

      let replacement = "";
      await readStream(res, (chunk) => {
        replacement += chunk;
      });

      replacement = replacement.trim();
      if (replacement) {
        const before = speechText.slice(0, selection.start);
        const after = speechText.slice(selection.end);
        setSpeechText(before + replacement + after);
      }

      clearSelection();
    } catch (err) {
      console.error("[writer] selection refine failed", err);
    } finally {
      setRefiningSelection(false);
    }
  }

  // ── Chat refinement ───────────────────────────────────────────────────────

  async function handleChatSubmit(e: React.FormEvent) {
    e.preventDefault();
    const msg = chatInput.trim();
    if (!msg || chatPending) return;
    setChatInput("");
    setChatPending(true);

    const userMsg: ChatMessage = { role: "user", text: msg };
    setChatHistory((prev) => [...prev, userMsg]);

    const prevText = speechText;

    try {
      const res = await fetch(“/api/refine-speech”, {
        method: “POST”,
        headers: { “Content-Type”: “application/json” },
        body: JSON.stringify({
          mode: “chat”,
          currentText: speechText,
          instruction: msg,
        }),
      });

      if (!res.ok) throw new Error(“Chat refinement failed”);

      // Buffer the full response — don’t trickle it into the textarea
      // so the user doesn’t see a confusing full-doc rewrite when only
      // one paragraph changed.
      let updated = “”;
      await readStream(res, (chunk) => { updated += chunk; });
      updated = updated.trim();

      if (updated && updated !== prevText) {
        setSpeechText(updated);

        // Find what changed and select it so the user can see exactly
        // which part was touched.
        const range = findChangedRange(prevText, updated);
        if (range && range.end > range.start) {
          requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(range.start, range.end);
            // Scroll to put the changed region near the top of the viewport
            const linesBefore = updated.slice(0, range.start).split(“\n”).length;
            el.scrollTop = Math.max(0, (linesBefore - 3) * 33);
          });
        }
      }

      const rangeSize = updated && prevText ? findChangedRange(prevText, updated) : null;
      const changedWords = rangeSize
        ? updated.slice(rangeSize.start, rangeSize.end).trim().split(/\s+/).filter(Boolean).length
        : 0;
      const feedback =
        changedWords === 0
          ? “Nothing changed — try being more specific.”
          : changedWords < 60
          ? “Updated — the changed part is highlighted above.”
          : “Updated the speech — changes are highlighted above.”;

      setChatHistory((prev) => [...prev, { role: “assistant”, text: feedback }]);
    } catch (err) {
      console.error(“[writer] chat refine failed”, err);
      setChatHistory((prev) => [
        ...prev,
        { role: “assistant”, text: “Something went wrong. Try again.” },
      ]);
    } finally {
      setChatPending(false);
    }
  }

  // ── Practice ──────────────────────────────────────────────────────────────

  function handlePractice() {
    startSaveTransition(async () => {
      await createSpeechFromWriter(title.trim() || "Untitled speech", speechText);
    });
  }

  const wc = wordCount(speechText);

  // ── Render: input phase ───────────────────────────────────────────────────

  if (phase === "input") {
    return (
      <main style={{ minHeight: "100vh", background: "var(--color-canvas-white)", display: "flex", flexDirection: "column" }}>
        <style>{inputStyles}</style>
        <header style={{ padding: "20px 40px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/" aria-label="SpeechPrep — home" style={{ display: "inline-flex" }}>
            <Image src="/assets/logo-wordmark-dark.png" alt="SpeechPrep" width={150} height={22} style={{ height: 22, width: "auto" }} priority />
          </Link>
          <Link href="/app/onboarding" className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
            I have a speech already
          </Link>
        </header>

        <div style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "32px 24px 80px" }}>
          <div style={{ width: "100%", maxWidth: 680 }}>
            <h1 className="text-display mt-2">
              Let&rsquo;s write your{" "}
              <span className="serif" style={{ fontStyle: "italic", fontWeight: 400 }}>
                speech.
              </span>
            </h1>
            <p className="text-body mt-4" style={{ color: "var(--color-muted-ash)", maxWidth: 520 }}>
              Drop in your bullet points, key stories, and anything you want to say. We&rsquo;ll turn it into a full draft you can edit and then practice.
            </p>

            <div style={{ display: "grid", gap: 20, marginTop: 36 }}>
              {/* Title */}
              <div>
                <label htmlFor="w-title" className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
                  What&rsquo;s it for?
                </label>
                <input
                  id="w-title"
                  autoFocus
                  autoComplete="off"
                  placeholder={`e.g. "Best man speech for Tom's wedding"`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="input input-lg mt-2"
                />
              </div>

              {/* Occasion + Duration row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12 }}>
                <div>
                  <label htmlFor="w-occasion" className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
                    Type of speech
                  </label>
                  <select
                    id="w-occasion"
                    value={occasion}
                    onChange={(e) => setOccasion(e.target.value)}
                    className="input input-lg mt-2"
                    style={{ appearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center", paddingRight: 36 }}
                  >
                    <option value="">Select or type…</option>
                    {OCCASIONS.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                    <option value="__custom__">Something else…</option>
                  </select>
                  {occasion === "__custom__" && (
                    <input
                      autoFocus
                      placeholder="Describe the occasion"
                      value={occasionCustom}
                      onChange={(e) => setOccasionCustom(e.target.value)}
                      className="input input-lg mt-2"
                    />
                  )}
                </div>
                <div>
                  <label htmlFor="w-duration" className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
                    Length
                  </label>
                  <select
                    id="w-duration"
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="input input-lg mt-2"
                    style={{ appearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center", paddingRight: 36 }}
                  >
                    {DURATIONS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label htmlFor="w-notes" className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
                  Your thoughts, stories, key moments
                </label>
                <textarea
                  id="w-notes"
                  rows={10}
                  placeholder={"Bullet points are fine. Whatever you want to say.\n\n• Tom and I met freshman year when he accidentally joined my study group\n• He's the most reliable person I know — showed up at 2am when my car broke down\n• The way he looks at Sarah tells you everything\n• End with something about what marriage means to both of them"}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="input input-lg mt-2"
                  style={{ fontFamily: "var(--font-script)", fontSize: 16, lineHeight: 1.65 }}
                />
                <p className="text-caption mt-2" style={{ color: "var(--color-muted-ash)" }}>
                  More detail = better speech. Names, stories, and specific moments make all the difference.
                </p>
              </div>

              {genError && (
                <p className="text-body-sm" style={{ color: "var(--color-leadgen-red)" }}>
                  {genError}
                </p>
              )}

              <div>
                <button
                  onClick={handleGenerate}
                  disabled={!title.trim()}
                  className="btn-primary"
                  style={{ minWidth: 200, justifyContent: "center" }}
                >
                  Write my speech →
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ── Render: generating / editing ──────────────────────────────────────────

  return (
    <main style={{ minHeight: "100vh", background: "var(--color-canvas-white)", display: "flex", flexDirection: "column" }}>
      <style>{editorStyles}</style>

      {/* Top bar */}
      <header className="writer-topbar">
        <Link href="/" aria-label="SpeechPrep — home" style={{ display: "inline-flex", flexShrink: 0 }}>
          <Image src="/assets/logo-wordmark-dark.png" alt="SpeechPrep" width={130} height={20} style={{ height: 20, width: "auto" }} priority />
        </Link>
        <div style={{ flex: 1, minWidth: 0, padding: "0 20px" }}>
          <p className="text-caption" style={{ color: "var(--color-muted-ash)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title || "Untitled speech"}
            {effectiveOccasion ? ` · ${effectiveOccasion}` : ""}
            {" · "}
            {streaming ? (
              <span style={{ color: "var(--color-phoenix-orange)" }}>Writing…</span>
            ) : (
              `${wc} words · ${fmtDuration(wc)}`
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => { setPhase("input"); setSpeechText(""); setChatHistory([]); }}
            className="btn-ghost"
            style={{ fontSize: 13 }}
          >
            Start over
          </button>
          <button
            onClick={handlePractice}
            disabled={streaming || savePending || !speechText.trim()}
            className="btn-primary"
            style={{ fontSize: 13 }}
          >
            {savePending ? "Setting up…" : "Start practicing →"}
          </button>
        </div>
      </header>

      {/* Two-column body */}
      <div className="writer-body">
        {/* Speech doc */}
        <div className="writer-doc-col">
          <h1 className="writer-doc-title">{title || "Untitled speech"}</h1>
          <div className="writer-doc-wrap">
            <textarea
              ref={textareaRef}
              className="writer-doc"
              value={speechText}
              onChange={(e) => { setSpeechText(e.target.value); clearSelection(); }}
              onMouseUp={handleTextareaMouseUp}
              placeholder={streaming ? "" : "Your speech will appear here…"}
              spellCheck
              readOnly={streaming}
            />
            {streaming && (
              <div className="writer-streaming-cursor" aria-hidden />
            )}
          </div>
          <div className="writer-statusbar">
            <span className="text-caption">{wc} words</span>
            <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>·</span>
            <span className="text-caption">{fmtDuration(wc)} at 140 wpm</span>
          </div>
        </div>

        {/* AI panel */}
        <aside className="writer-panel">
          <div className="writer-panel-inner">
            {/* Chat history */}
            <div className="writer-chat-history">
              {chatHistory.length === 0 && !streaming && (
                <div style={{ padding: "24px 0", textAlign: "center" }}>
                  <p className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
                    Ask me to change anything — tone, length, a specific section, or the whole thing.
                  </p>
                  <div style={{ display: "grid", gap: 6, marginTop: 16 }}>
                    {[
                      "Make the opening punchier",
                      "Add more personal details",
                      "Make it funnier",
                      "Shorten it by 30 seconds",
                    ].map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => { setChatInput(prompt); chatInputRef.current?.focus(); }}
                        className="writer-suggestion-chip"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chatHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`writer-chat-msg writer-chat-${msg.role}`}
                >
                  {msg.text}
                </div>
              ))}
              {chatPending && (
                <div className="writer-chat-msg writer-chat-assistant writer-chat-pending">
                  <span className="writer-thinking-dot" /><span className="writer-thinking-dot" /><span className="writer-thinking-dot" />
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <form onSubmit={handleChatSubmit} className="writer-chat-form">
              <input
                ref={chatInputRef}
                placeholder={streaming ? "Generating…" : "Ask me to change anything…"}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={streaming || chatPending}
                className="input"
                style={{ flex: 1, fontSize: 13 }}
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || streaming || chatPending}
                className="btn-primary"
                style={{ fontSize: 13, flexShrink: 0 }}
              >
                Send
              </button>
            </form>
          </div>
        </aside>
      </div>

      {/* Floating selection refine popover */}
      {selection && selectionPos && (
        <div
          ref={popoverRef}
          className="writer-refine-popover"
          style={{
            left: Math.max(8, Math.min(
              selectionPos.x - 220,
              (typeof window !== "undefined" ? window.innerWidth : 800) - 456,
            )),
            top: Math.max(8, selectionPos.y - 76),
          }}
          // Prevent the textarea's onMouseDown-outside handler from firing
          // when the user clicks inside this popover.
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="writer-refine-spark" aria-hidden>✦</span>
          {refiningSelection ? (
            <span className="writer-refine-pending">
              <span className="writer-thinking-dot" />
              <span className="writer-thinking-dot" />
              <span className="writer-thinking-dot" />
            </span>
          ) : (
            <>
              <input
                ref={popoverInputRef}
                className="writer-refine-input"
                placeholder="What should change here?"
                value={selectionNote}
                onChange={(e) => setSelectionNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSelectionRefine();
                  }
                }}
              />
              <button
                className="writer-refine-btn"
                onClick={handleSelectionRefine}
                disabled={!selectionNote.trim()}
              >
                Rewrite
              </button>
              <button
                className="writer-refine-dismiss"
                onClick={clearSelection}
                aria-label="Dismiss"
              >
                ×
              </button>
            </>
          )}
        </div>
      )}
    </main>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const inputStyles = ``;

const editorStyles = `
  .writer-topbar {
    display: flex;
    align-items: center;
    padding: 14px 28px;
    border-bottom: 1px solid rgba(17,17,17,0.07);
    background: var(--color-canvas-white);
    position: sticky;
    top: 0;
    z-index: 10;
    gap: 0;
  }

  .writer-body {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 380px;
    min-height: 0;
  }
  @media (max-width: 900px) {
    .writer-body { grid-template-columns: 1fr; }
    .writer-panel { border-left: none; border-top: 1px solid rgba(17,17,17,0.07); }
  }

  .writer-doc-col {
    display: flex;
    flex-direction: column;
    padding: 40px 48px 48px;
    overflow-y: auto;
    min-height: calc(100vh - 52px);
  }
  @media (max-width: 640px) {
    .writer-doc-col { padding: 24px 20px 32px; }
  }

  .writer-doc-title {
    font-family: var(--font-script);
    font-size: clamp(26px, 3.2vw, 36px);
    font-weight: 500;
    letter-spacing: -0.025em;
    line-height: 1.1;
    color: var(--color-midnight-ink);
    margin: 0 0 28px;
    padding-bottom: 22px;
    border-bottom: 1px solid rgba(17,17,17,0.07);
  }

  .writer-doc-wrap {
    flex: 1;
    position: relative;
  }

  .writer-doc {
    width: 100%;
    min-height: 500px;
    height: 100%;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    font-family: var(--font-script);
    font-size: 19px;
    line-height: 1.75;
    color: var(--color-midnight-ink);
    padding: 0;
  }

  .writer-streaming-cursor::after {
    content: "";
    display: inline-block;
    width: 2px;
    height: 1.2em;
    background: var(--color-phoenix-orange);
    vertical-align: text-bottom;
    margin-left: 2px;
    animation: blink 0.9s step-end infinite;
  }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

  .writer-statusbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 16px;
    margin-top: 16px;
    border-top: 1px solid rgba(17,17,17,0.06);
    color: var(--color-muted-ash);
  }

  .writer-panel {
    border-left: 1px solid rgba(17,17,17,0.07);
    display: flex;
    flex-direction: column;
    height: calc(100vh - 52px);
    position: sticky;
    top: 52px;
  }

  .writer-panel-inner {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    padding: 20px 20px 0;
  }

  /* ── Floating selection refine popover ── */
  .writer-refine-popover {
    position: fixed;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--color-midnight-ink);
    border-radius: 10px;
    padding: 10px 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.14);
    width: 448px;
    animation: popover-in 120ms cubic-bezier(0.2, 0, 0, 1.2);
  }
  @keyframes popover-in {
    from { opacity: 0; transform: translateY(6px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  .writer-refine-spark {
    color: var(--color-phoenix-orange);
    font-size: 13px;
    flex-shrink: 0;
    line-height: 1;
  }

  .writer-refine-input {
    flex: 1;
    min-width: 0;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 6px;
    color: #fff;
    font-size: 13px;
    padding: 6px 10px;
    outline: none;
    transition: border-color 120ms ease;
  }
  .writer-refine-input::placeholder { color: rgba(255,255,255,0.4); }
  .writer-refine-input:focus { border-color: rgba(255,255,255,0.35); }

  .writer-refine-btn {
    background: var(--color-phoenix-orange);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 6px 13px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity 120ms ease;
    white-space: nowrap;
  }
  .writer-refine-btn:disabled { opacity: 0.4; cursor: default; }
  .writer-refine-btn:not(:disabled):hover { opacity: 0.88; }

  .writer-refine-dismiss {
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.45);
    font-size: 18px;
    line-height: 1;
    padding: 2px 4px;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 120ms ease;
  }
  .writer-refine-dismiss:hover { color: rgba(255,255,255,0.8); }

  .writer-refine-pending {
    display: flex;
    gap: 5px;
    align-items: center;
    flex: 1;
    padding: 4px 0;
  }

  .writer-chat-history {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .writer-chat-msg {
    font-size: 13.5px;
    line-height: 1.55;
    padding: 10px 13px;
    border-radius: 10px;
    max-width: 90%;
  }
  .writer-chat-user {
    background: var(--color-midnight-ink);
    color: #fff;
    align-self: flex-end;
    border-bottom-right-radius: 3px;
  }
  .writer-chat-assistant {
    background: var(--color-whisper-gray);
    color: var(--color-midnight-ink);
    align-self: flex-start;
    border-bottom-left-radius: 3px;
  }
  .writer-chat-pending {
    display: flex;
    gap: 5px;
    align-items: center;
    padding: 14px 16px;
  }

  .writer-thinking-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-muted-ash);
    display: inline-block;
    animation: thinking-bounce 1.2s ease-in-out infinite;
  }
  .writer-thinking-dot:nth-child(2) { animation-delay: 0.2s; }
  .writer-thinking-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes thinking-bounce {
    0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
    40% { transform: translateY(-6px); opacity: 1; }
  }

  .writer-suggestion-chip {
    background: var(--color-whisper-gray);
    border: 1px solid rgba(17,17,17,0.08);
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 12.5px;
    color: var(--color-midnight-ink);
    cursor: pointer;
    text-align: left;
    transition: background 120ms ease, border-color 120ms ease;
    white-space: nowrap;
  }
  .writer-suggestion-chip:hover {
    background: rgba(17,17,17,0.06);
    border-color: rgba(17,17,17,0.14);
  }

  .writer-chat-form {
    display: flex;
    gap: 8px;
    padding: 14px 0 20px;
    flex-shrink: 0;
    border-top: 1px solid rgba(17,17,17,0.07);
    margin-top: 4px;
  }
`;
