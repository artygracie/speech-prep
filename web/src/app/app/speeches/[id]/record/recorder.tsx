"use client";

// Recorder. Two-column layout: the script is the headline of the screen,
// the recording sidebar is supporting chrome.
//
// Left  — the script the user is reading. Big serif type, generous line
//         height. Section headings inline; the active section is softly
//         highlighted while recording.
// Right — sticky sidebar. Mode toggle (top), timer, current-section
//         pacing bar, sections rail, big record/stop button (bottom),
//         live tag chips beneath.
//
// Same MediaRecorder + Storage upload + finalizeSession flow as before.
// The data flow didn't change — only the layout.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { createSession, finalizeSession } from "@/app/app/sessions-actions";

type Section = { id: string; position: number; name: string; targetSec: number; body: string };
type Tag = { kind: "landed" | "flat" | "lost" | "callback"; atMs: number; label: string };
type State = "idle" | "starting" | "recording" | "paused" | "stopping" | "uploading" | "error";

const TAG_DEFS: { code: string; key: string; kind: Tag["kind"]; label: string }[] = [
  { code: "KeyL", key: "L", kind: "landed", label: "Landed" },
  { code: "KeyF", key: "F", kind: "flat", label: "Flat" },
  { code: "KeyX", key: "X", kind: "lost", label: "Lost place" },
  { code: "KeyC", key: "C", kind: "callback", label: "Callback" },
];

function pickMimeType(): { mime: string; ext: string } {
  if (typeof MediaRecorder === "undefined") return { mime: "audio/webm", ext: "webm" };
  const candidates: { mime: string; ext: string }[] = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/ogg", ext: "ogg" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: "", ext: "webm" };
}

function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function Recorder({
  speechId,
  sections,
}: {
  speechId: string;
  sections: Section[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"with-script" | "freestyle">("with-script");
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [tags, setTags] = useState<Tag[]>([]);
  const [, startTransition] = useTransition();

  const sessionIdRef = useRef<string | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickHandleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeRef = useRef<{ mime: string; ext: string }>({ mime: "audio/webm", ext: "webm" });

  // ---------- Lifecycle ----------
  useEffect(() => {
    return () => {
      stopTicker();
      cleanupStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard tags
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (state !== "recording") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const def = TAG_DEFS.find((t) => t.code === e.code);
      if (!def) return;
      e.preventDefault();
      setTags((prev) => [...prev, { kind: def.kind, label: def.label, atMs: nowElapsed() }]);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function nowElapsed(): number {
    return startedAtRef.current ? Date.now() - startedAtRef.current : 0;
  }

  function startTicker() {
    stopTicker();
    tickHandleRef.current = setInterval(() => {
      setElapsedMs(nowElapsed());
    }, 200);
  }
  function stopTicker() {
    if (tickHandleRef.current) {
      clearInterval(tickHandleRef.current);
      tickHandleRef.current = null;
    }
  }
  function cleanupStream() {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    recorderRef.current = null;
  }

  // ---------- Recording ----------
  async function start() {
    setErrorMsg(null);
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;

      const m = pickMimeType();
      mimeRef.current = m;
      const rec = m.mime ? new MediaRecorder(stream, { mimeType: m.mime }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      const { sessionId } = await createSession(speechId, mode);
      sessionIdRef.current = sessionId;

      rec.start(1000);
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setTags([]);
      startTicker();
      setState("recording");
    } catch (err) {
      console.error(err);
      setErrorMsg(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone permission denied. Allow it in your browser, then try again."
          : err instanceof Error
          ? err.message
          : "Couldn't start recording.",
      );
      setState("error");
      cleanupStream();
    }
  }

  async function pause() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.pause();
      stopTicker();
      setState("paused");
    }
  }
  async function resume() {
    if (recorderRef.current?.state === "paused") {
      recorderRef.current.resume();
      startTicker();
      setState("recording");
    }
  }

  async function stop() {
    if (!recorderRef.current || !sessionIdRef.current) return;
    setState("stopping");
    stopTicker();
    const sessionId = sessionIdRef.current;
    const captured = elapsedMs || nowElapsed();

    const onStop = new Promise<Blob>((resolve, reject) => {
      const rec = recorderRef.current!;
      rec.onstop = () => {
        try {
          const blob = new Blob(chunksRef.current, {
            type: rec.mimeType || mimeRef.current.mime || "audio/webm",
          });
          resolve(blob);
        } catch (err) {
          reject(err);
        }
      };
    });
    recorderRef.current.stop();
    let blob: Blob;
    try {
      blob = await onStop;
    } catch (err) {
      console.error(err);
      setErrorMsg("Recorder didn't stop cleanly.");
      setState("error");
      cleanupStream();
      return;
    }
    cleanupStream();

    setState("uploading");
    const ext = mimeRef.current.ext || "webm";
    const file = new File([blob], `${sessionId}.${ext}`, {
      type: blob.type || "audio/webm",
    });

    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const path = `${user.id}/${sessionId}.${ext}`;
      const { error: upErr } = await supabase.storage.from("recordings").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
      if (upErr) throw upErr;

      await finalizeSession({
        sessionId,
        audioPath: path,
        audioMime: file.type,
        audioBytes: file.size,
        durationMs: captured,
        tags,
      });

      startTransition(() => {
        router.push(`/app/speeches/${speechId}/sessions/${sessionId}`);
      });
    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : "Upload failed.");
      setState("error");
    }
  }

  // ---------- Derived values ----------

  // Heuristic: which section are we "in" right now? Walk the elapsed time
  // through each section's target. Used purely for visual hinting, not
  // for the alignment that runs server-side post-stop.
  const currentSectionIdx = useMemo(() => {
    if (sections.length === 0) return 0;
    let runningMs = 0;
    for (let i = 0; i < sections.length; i++) {
      runningMs += sections[i].targetSec * 1000;
      if (elapsedMs <= runningMs) return i;
    }
    return sections.length - 1;
  }, [elapsedMs, sections]);

  const currentSection = sections[currentSectionIdx];
  const sectionElapsedMs = useMemo(() => {
    let running = 0;
    for (let i = 0; i < currentSectionIdx; i++) running += sections[i].targetSec * 1000;
    return Math.max(0, elapsedMs - running);
  }, [elapsedMs, sections, currentSectionIdx]);

  const isLive = state === "recording" || state === "paused";
  const isWorking = state === "stopping" || state === "uploading";

  return (
    <>
      <style>{`
        /* ===== Layout shell ===== */
        .rec-grid {
          display: grid;
          grid-template-columns: 1fr 340px;
          gap: 32px;
          align-items: start;
        }
        @media (max-width: 1100px) { .rec-grid { grid-template-columns: 1fr; gap: 20px; } }

        /* ===== Left column — script ===== */
        .rec-script {
          background: var(--color-canvas-white);
          border: 1px solid rgba(17,17,17,0.06);
          border-radius: 14px;
          padding: 40px 48px 56px;
          min-height: 520px;
        }
        @media (max-width: 1100px) { .rec-script { padding: 28px 24px 36px; min-height: 0; } }

        .rec-script-section { padding: 18px 0; }
        .rec-script-section:first-child { padding-top: 0; }
        .rec-script-section:not(:first-child) {
          border-top: 1px solid rgba(17,17,17,0.06);
        }
        .rec-script-head {
          display: flex; align-items: baseline; gap: 12px;
          margin-bottom: 14px;
        }
        .rec-script-head h3 {
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--color-muted-ash);
          transition: color 240ms ease;
        }
        .rec-script-section.is-active .rec-script-head h3 { color: var(--color-midnight-ink); }
        .rec-script-section.is-active .rec-script-head .rec-current-marker {
          opacity: 1; transform: scale(1);
        }
        .rec-current-marker {
          width: 6px; height: 6px; border-radius: 999px;
          background: var(--color-leadgen-red);
          opacity: 0; transform: scale(0.3);
          transition: opacity 240ms ease, transform 240ms ease;
          display: inline-block;
        }
        .rec-script-body {
          font-family: var(--font-script);
          font-size: 19px;
          line-height: 1.75;
          color: var(--color-midnight-ink);
          white-space: pre-wrap;
          transition: color 320ms ease, opacity 320ms ease;
        }
        /* When recording, fade non-active sections down so the eye lands
           on the current one. Subtle — we don't want to lock anything. */
        .rec-grid.is-live .rec-script-section:not(.is-active) .rec-script-body {
          color: rgba(17,17,17,0.45);
        }
        .rec-grid.is-live .rec-script-section:not(.is-active) .rec-script-head h3 {
          color: rgba(17,17,17,0.32);
        }

        /* Freestyle pane */
        .rec-freestyle {
          background: var(--color-whisper-gray);
          border: 1px dashed rgba(17,17,17,0.14);
          border-radius: 14px;
          padding: 64px 48px;
          text-align: center;
        }

        /* ===== Right column — sidebar ===== */
        .rec-side {
          position: sticky;
          top: 80px;            /* below the topbar */
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        @media (max-width: 1100px) { .rec-side { position: static; } }

        .rec-side-card {
          background: var(--color-canvas-white);
          border: 1px solid rgba(17,17,17,0.08);
          border-radius: 14px;
          padding: 18px;
        }

        /* Mode toggle — two equal options at the very top */
        .rec-mode {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4px;
          background: var(--color-whisper-gray);
          border-radius: 10px;
          padding: 4px;
        }
        .rec-mode button {
          background: transparent;
          border: 0;
          padding: 8px 10px;
          border-radius: 7px;
          font-size: 13px;
          font-weight: 500;
          color: var(--color-muted-ash);
          cursor: pointer;
          transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease;
        }
        .rec-mode button.is-on {
          background: var(--color-canvas-white);
          color: var(--color-midnight-ink);
          box-shadow: var(--shadow-subtle), 0 1px 2px rgba(17,17,17,0.04);
        }
        .rec-mode button:disabled { cursor: not-allowed; opacity: 0.55; }

        /* Timer block */
        .rec-timer-card {
          padding: 22px 18px;
          background: var(--color-canvas-white);
          border-radius: 14px;
          border: 1px solid rgba(17,17,17,0.08);
        }
        .rec-status {
          display: flex; align-items: center; gap: 8px;
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--color-muted-ash);
        }
        .rec-status.is-live { color: var(--color-leadgen-red); }
        .rec-status.is-working { color: var(--color-intelligence-blue); }
        .rec-status .rec-dot {
          width: 8px; height: 8px; border-radius: 999px;
          background: var(--color-leadgen-red);
          box-shadow: 0 0 0 0 rgba(225, 101, 64, 0.55);
          animation: rec-pulse 1.4s ease-out infinite;
        }
        .rec-status.idle .rec-dot, .rec-status.is-working .rec-dot {
          background: rgba(17,17,17,0.18); animation: none;
        }
        .rec-status.is-paused .rec-dot {
          background: var(--color-engagement-gold); animation: none;
        }
        @keyframes rec-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(225, 101, 64, 0.5); }
          70%  { box-shadow: 0 0 0 9px rgba(225, 101, 64, 0); }
          100% { box-shadow: 0 0 0 0 rgba(225, 101, 64, 0); }
        }
        .rec-time {
          font-family: var(--font-serif);
          font-style: italic;
          font-size: 56px;
          line-height: 1;
          letter-spacing: -0.02em;
          margin-top: 14px;
          font-variant-numeric: tabular-nums;
          color: var(--color-midnight-ink);
        }

        /* Per-current-section pacing bar */
        .rec-pace {
          margin-top: 18px;
          padding-top: 18px;
          border-top: 1px solid rgba(17,17,17,0.06);
        }
        .rec-pace-label {
          display: flex; align-items: baseline; justify-content: space-between;
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--color-muted-ash);
          margin-bottom: 6px;
        }
        .rec-pace-bar {
          height: 4px; border-radius: 999px;
          background: rgba(17,17,17,0.06);
          overflow: hidden; position: relative;
        }
        .rec-pace-bar > span {
          position: absolute; inset: 0 auto 0 0;
          border-radius: 999px;
          transition: width 200ms linear, background-color 240ms ease;
        }

        /* Sections rail */
        .rec-rail {
          padding: 14px 16px;
        }
        .rec-rail-title {
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--color-muted-ash);
          margin-bottom: 10px;
        }
        .rec-rail-list { display: grid; gap: 4px; }
        .rec-rail-item {
          display: flex; align-items: center; justify-content: space-between;
          padding: 7px 10px;
          border-radius: 7px;
          font-size: 13px;
          color: var(--color-muted-ash);
          transition: background 160ms ease, color 160ms ease;
        }
        .rec-rail-item.is-current {
          background: var(--color-whisper-gray);
          color: var(--color-midnight-ink);
          font-weight: 500;
        }
        .rec-rail-item .num {
          font-size: 11px; opacity: 0.7;
          font-variant-numeric: tabular-nums;
        }

        /* Action area at the bottom of the sidebar */
        .rec-actions { padding: 14px 16px; }
        .rec-cta {
          width: 100%;
          padding: 14px 18px;
          border-radius: 10px;
          font-weight: 500;
          font-size: 15px;
          border: 0;
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          transition: opacity 120ms ease, transform 120ms ease;
        }
        .rec-cta:disabled { opacity: 0.5; cursor: not-allowed; }
        .rec-cta-start {
          background: var(--color-midnight-ink); color: var(--color-canvas-white);
        }
        .rec-cta-start:hover:not(:disabled) { opacity: 0.92; transform: translateY(-1px); }
        .rec-cta-stop {
          background: var(--color-leadgen-red); color: var(--color-canvas-white);
        }
        .rec-cta-stop:hover:not(:disabled) { opacity: 0.92; }
        .rec-secondary {
          margin-top: 8px; text-align: center;
          font-size: 13px;
          color: var(--color-muted-ash);
          background: transparent; border: 0; cursor: pointer;
          width: 100%; padding: 8px;
        }
        .rec-secondary:hover { color: var(--color-midnight-ink); }

        /* Tag legend / live tag chips */
        .rec-tags-legend {
          display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
          margin-top: 10px;
        }
        .rec-tags-legend > div {
          display: flex; align-items: center; justify-content: space-between;
          padding: 6px 10px; border-radius: 7px;
          background: var(--color-whisper-gray);
          font-size: 12px;
          color: var(--color-muted-ash);
        }
        .rec-tags-legend kbd {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 10px;
          padding: 1px 5px;
          border-radius: 3px;
          background: var(--color-canvas-white);
          border: 1px solid rgba(17,17,17,0.08);
          color: var(--color-midnight-ink);
        }
        .rec-tag-flash {
          margin-top: 10px;
          display: flex; flex-wrap: wrap; gap: 6px;
        }
        .rec-tag-flash .badge { font-size: 10px; padding: 4px 8px; }

        /* Status footer message */
        .rec-status-msg {
          font-size: 12px;
          color: var(--color-muted-ash);
          padding: 0 4px;
        }
        .rec-status-msg.is-error { color: var(--color-leadgen-red); }
      `}</style>

      <div className={`rec-grid ${isLive ? "is-live" : ""}`}>
        {/* ============ LEFT: SCRIPT (or freestyle placeholder) ============ */}
        {mode === "with-script" ? (
          <div className="rec-script">
            {sections.map((s, i) => (
              <section
                key={s.id}
                className={`rec-script-section ${
                  isLive && i === currentSectionIdx ? "is-active" : ""
                }`}
              >
                <header className="rec-script-head">
                  <span className="rec-current-marker" aria-hidden="true" />
                  <h3>{s.name}</h3>
                  <span
                    className="text-caption"
                    style={{ color: "var(--color-muted-ash)", marginLeft: "auto" }}
                  >
                    Target {fmtTime(s.targetSec * 1000)}
                  </span>
                </header>
                <p className="rec-script-body">{s.body || "—"}</p>
              </section>
            ))}
          </div>
        ) : (
          <div className="rec-freestyle">
            <p className="text-subheading" style={{ color: "var(--color-midnight-ink)" }}>
              Freestyle mode
            </p>
            <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)", maxWidth: 460, marginInline: "auto" }}>
              Script hidden. Speak the speech from memory. We&rsquo;ll diff what you said against
              what you wrote when you stop.
            </p>
            <div className="mt-6">
              <button
                onClick={() => state === "idle" && setMode("with-script")}
                disabled={state !== "idle"}
                className="text-body-sm"
                style={{
                  background: "transparent",
                  border: 0,
                  color: "var(--color-midnight-ink)",
                  textDecoration: "underline",
                  textUnderlineOffset: 4,
                  textDecorationColor: "rgba(17,17,17,0.18)",
                  cursor: state === "idle" ? "pointer" : "not-allowed",
                  opacity: state === "idle" ? 1 : 0.4,
                }}
              >
                Switch to teleprompter
              </button>
            </div>
          </div>
        )}

        {/* ============ RIGHT: STICKY SIDEBAR ============ */}
        <aside className="rec-side">
          {/* Mode toggle — top of sidebar, always visible, always equal weight */}
          <div className="rec-mode" role="tablist" aria-label="Practice mode">
            {(["with-script", "freestyle"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => state === "idle" && setMode(m)}
                disabled={state !== "idle"}
                className={mode === m ? "is-on" : ""}
              >
                {m === "with-script" ? "Teleprompter" : "Freestyle"}
              </button>
            ))}
          </div>

          {/* Timer + status */}
          <div className="rec-timer-card">
            <div
              className={`rec-status ${
                state === "recording"
                  ? "is-live"
                  : state === "paused"
                  ? "is-paused"
                  : isWorking
                  ? "is-working"
                  : "idle"
              }`}
            >
              <span className="rec-dot" aria-hidden="true" />
              {state === "recording"
                ? "Recording"
                : state === "paused"
                ? "Paused"
                : state === "stopping"
                ? "Stopping"
                : state === "uploading"
                ? "Uploading"
                : state === "starting"
                ? "Starting"
                : state === "error"
                ? "Error"
                : "Ready"}
            </div>
            <div className="rec-time">{fmtTime(elapsedMs)}</div>

            {/* Per-current-section pacing bar — only when recording or paused */}
            {isLive && currentSection && (
              <div className="rec-pace">
                <div className="rec-pace-label">
                  <span>{currentSection.name}</span>
                  <span
                    className="num"
                    style={{
                      color:
                        sectionElapsedMs > currentSection.targetSec * 1000
                          ? "var(--color-leadgen-red)"
                          : "var(--color-muted-ash)",
                    }}
                  >
                    {fmtTime(sectionElapsedMs)} / {fmtTime(currentSection.targetSec * 1000)}
                  </span>
                </div>
                <div className="rec-pace-bar">
                  <span
                    style={{
                      width: `${Math.min(100, (sectionElapsedMs / (currentSection.targetSec * 1000)) * 100)}%`,
                      background:
                        sectionElapsedMs > currentSection.targetSec * 1000
                          ? "var(--color-leadgen-red)"
                          : "var(--color-midnight-ink)",
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Sections rail */}
          {sections.length > 0 && (
            <div className="rec-side-card rec-rail">
              <div className="rec-rail-title">Sections</div>
              <div className="rec-rail-list">
                {sections.map((s, i) => (
                  <div
                    key={s.id}
                    className={`rec-rail-item ${
                      isLive && i === currentSectionIdx ? "is-current" : ""
                    }`}
                  >
                    <span>{s.name}</span>
                    <span className="num">{fmtTime(s.targetSec * 1000)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live notes — legend when idle, tag chips while recording */}
          <div className="rec-side-card">
            <div className="rec-rail-title">Live notes</div>
            {isLive ? (
              <>
                <div className="rec-tags-legend">
                  {TAG_DEFS.map((t) => (
                    <div key={t.code}>
                      <span>{t.label}</span>
                      <kbd>{t.key}</kbd>
                    </div>
                  ))}
                </div>
                {tags.length > 0 && (
                  <div className="rec-tag-flash">
                    {tags.map((t, i) => (
                      <span
                        key={i}
                        className={`badge ${
                          t.kind === "landed"
                            ? "pill-mint"
                            : t.kind === "flat"
                            ? "pill-gold"
                            : t.kind === "lost"
                            ? "pill-red"
                            : "pill-blue"
                        }`}
                      >
                        <span className="dot" />
                        {t.label} · {fmtTime(t.atMs)}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p
                className="text-body-sm"
                style={{ color: "var(--color-muted-ash)", lineHeight: 1.5 }}
              >
                Tap a key while you&rsquo;re recording to flag a moment. We&rsquo;ll pull them up in the report.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="rec-side-card rec-actions">
            {state === "idle" && (
              <button onClick={start} className="rec-cta rec-cta-start">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="6" />
                </svg>
                Start recording
              </button>
            )}
            {state === "starting" && (
              <button className="rec-cta rec-cta-start" disabled>
                Starting…
              </button>
            )}
            {state === "recording" && (
              <>
                <button onClick={stop} className="rec-cta rec-cta-stop">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="1" />
                  </svg>
                  Stop recording
                </button>
                <button onClick={pause} className="rec-secondary">
                  Pause
                </button>
              </>
            )}
            {state === "paused" && (
              <>
                <button onClick={resume} className="rec-cta rec-cta-start">
                  Resume
                </button>
                <button onClick={stop} className="rec-secondary" style={{ color: "var(--color-leadgen-red)" }}>
                  Stop
                </button>
              </>
            )}
            {state === "stopping" && (
              <button className="rec-cta rec-cta-start" disabled>
                Stopping…
              </button>
            )}
            {state === "uploading" && (
              <button className="rec-cta rec-cta-start" disabled>
                Uploading…
              </button>
            )}
            {state === "error" && (
              <button
                onClick={() => {
                  setState("idle");
                  setErrorMsg(null);
                }}
                className="rec-cta rec-cta-start"
              >
                Try again
              </button>
            )}
            {errorMsg && (
              <p className="rec-status-msg is-error" style={{ marginTop: 10 }}>
                {errorMsg}
              </p>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
