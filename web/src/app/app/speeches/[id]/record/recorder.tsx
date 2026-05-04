"use client";

// Recorder. Wraps MediaRecorder, drives the UI, and on stop:
//   1. uploads the resulting Blob to Supabase Storage
//   2. calls finalizeSession() to persist the metadata + kick off
//      transcription
//   3. routes the user to the session report
//
// We pick the best mimeType the browser actually supports. Safari is the
// awkward one — its MediaRecorder support has gaps; we fall back to
// audio/mp4 there.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  createSession,
  finalizeSession,
} from "@/app/app/sessions-actions";

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
function signTime(ms: number) {
  return (ms >= 0 ? "+" : "−") + fmtTime(Math.abs(ms));
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
      // Tear down on unmount.
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

      // Ask the server for a fresh session row before we start ticking.
      const { sessionId } = await createSession(speechId, mode);
      sessionIdRef.current = sessionId;

      rec.start(1000); // emit a chunk every second so memory stays bounded
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
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || mimeRef.current.mime || "audio/webm" });
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
    const file = new File([blob], `${sessionId}.${ext}`, { type: blob.type || "audio/webm" });

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

      // Persist metadata + kick off transcription.
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

  // ---------- UI ----------
  const totalTargetMs = sections.reduce((a, s) => a + s.targetSec * 1000, 0);
  const overTotal = elapsedMs - totalTargetMs;

  // Heuristic "current section" by elapsed time, only used for visual hint.
  let runningMs = 0;
  let currentSectionId = sections[0]?.id ?? null;
  for (const s of sections) {
    if (elapsedMs <= runningMs + s.targetSec * 1000) {
      currentSectionId = s.id;
      break;
    }
    runningMs += s.targetSec * 1000;
    currentSectionId = s.id;
  }

  return (
    <>
      <style>{`
        .rec-card-elevated {
          background: var(--color-canvas-white);
          border-radius: 16px;
          box-shadow: var(--shadow-xl);
        }
        .rec-dot-real {
          width: 10px; height: 10px; border-radius: 999px;
          background: var(--color-leadgen-red); display: inline-block;
          box-shadow: 0 0 0 0 rgba(225, 101, 64, 0.55);
          animation: rec-pulse 1.4s ease-out infinite;
        }
        @keyframes rec-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(225, 101, 64, 0.5); }
          70%  { box-shadow: 0 0 0 9px rgba(225, 101, 64, 0); }
          100% { box-shadow: 0 0 0 0 rgba(225, 101, 64, 0); }
        }
        .rec-wave { display: flex; align-items: center; gap: 3px; height: 64px; padding: 0 2px; }
        .rec-wave > i {
          flex: 1; display: block;
          background: var(--color-midnight-ink);
          border-radius: 3px; opacity: 0.85; height: 14%;
          animation: wave-bar 1.1s ease-in-out infinite;
          will-change: transform; transform-origin: center;
        }
        .rec-wave.is-paused > i { animation-play-state: paused; opacity: 0.25; }
        @keyframes wave-bar { 0%, 100% { transform: scaleY(0.18); } 50% { transform: scaleY(1); } }
        .section-pill {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px; border-radius: 10px;
          background: var(--color-canvas-white);
          border: 1px solid rgba(17,17,17,0.08);
          font-size: 14px;
        }
        .section-pill.is-current { box-shadow: 0 0 0 2px var(--color-midnight-ink); border-color: var(--color-midnight-ink); }
        .marker-bar { height: 6px; border-radius: 999px; background: rgba(17,17,17,0.06); overflow: hidden; position: relative; }
        .marker-bar > span { position: absolute; inset: 0 auto 0 0; border-radius: 999px; }
        .script-panel {
          background: var(--color-whisper-gray);
          border-radius: 12px;
          padding: 24px 28px;
          max-height: 320px;
          overflow-y: auto;
          font-family: var(--font-script);
          font-size: 17px; line-height: 1.7;
        }
        .script-panel mark.current-section {
          background: rgba(251,199,104,0.45);
          padding: 2px 0;
          border-radius: 2px;
        }
      `}</style>

      <div className="rec-card-elevated mt-8" style={{ padding: 28, maxWidth: 920 }}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {state === "recording" ? (
              <>
                <span className="rec-dot-real" />
                <span className="text-caption" style={{ color: "var(--color-leadgen-red)" }}>Recording</span>
              </>
            ) : state === "paused" ? (
              <span className="text-caption" style={{ color: "var(--color-engagement-gold)" }}>Paused</span>
            ) : state === "uploading" ? (
              <span className="text-caption" style={{ color: "var(--color-intelligence-blue)" }}>Uploading…</span>
            ) : state === "error" ? (
              <span className="text-caption" style={{ color: "var(--color-leadgen-red)" }}>Error</span>
            ) : (
              <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>Ready</span>
            )}
          </div>
          <span className="text-body-sm num" style={{ color: "var(--color-muted-ash)" }}>
            {fmtTime(elapsedMs)}
          </span>
        </div>

        <div className={`rec-wave ${state === "recording" ? "" : "is-paused"}`} aria-hidden="true">
          {Array.from({ length: 56 }).map((_, i) => (
            <i
              key={i}
              style={{
                animationDelay: `-${(i * 0.07) % 1.1}s`,
                animationDuration: `${0.85 + ((i * 13) % 50) / 100}s`,
              }}
            />
          ))}
        </div>

        {totalTargetMs > 0 && (
          <div className="mt-6">
            <div className="flex items-baseline justify-between">
              <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>Pacing vs. target</span>
              <span
                className="text-caption num"
                style={{
                  color: overTotal > 0 ? "var(--color-leadgen-red)" : "var(--color-muted-ash)",
                }}
              >
                {fmtTime(elapsedMs)} / {fmtTime(totalTargetMs)}
                {overTotal > 0 ? ` · ${signTime(overTotal)}` : ""}
              </span>
            </div>
            <div className="marker-bar mt-2">
              <span
                style={{
                  width: `${Math.min(100, (elapsedMs / totalTargetMs) * 100)}%`,
                  background: overTotal > 0 ? "var(--color-leadgen-red)" : "var(--color-midnight-ink)",
                }}
              />
            </div>
          </div>
        )}

        <div
          className="flex items-center justify-between mt-6 pt-6"
          style={{ borderTop: "1px solid rgba(17,17,17,0.06)" }}
        >
          <div className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
            {state === "recording" ? (
              <>
                Press <kbd style={{ fontFamily: "ui-monospace", fontSize: 11, padding: "2px 6px", border: "1px solid rgba(17,17,17,0.08)", borderRadius: 4, background: "var(--color-whisper-gray)" }}>L</kbd>{" "}
                Landed ·{" "}
                <kbd style={{ fontFamily: "ui-monospace", fontSize: 11, padding: "2px 6px", border: "1px solid rgba(17,17,17,0.08)", borderRadius: 4, background: "var(--color-whisper-gray)" }}>F</kbd>{" "}
                Flat ·{" "}
                <kbd style={{ fontFamily: "ui-monospace", fontSize: 11, padding: "2px 6px", border: "1px solid rgba(17,17,17,0.08)", borderRadius: 4, background: "var(--color-whisper-gray)" }}>X</kbd>{" "}
                Lost ·{" "}
                <kbd style={{ fontFamily: "ui-monospace", fontSize: 11, padding: "2px 6px", border: "1px solid rgba(17,17,17,0.08)", borderRadius: 4, background: "var(--color-whisper-gray)" }}>C</kbd>{" "}
                Callback
              </>
            ) : (
              " "
            )}
          </div>
          <div className="flex gap-2">
            {state === "idle" && (
              <button onClick={start} className="btn-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6" /></svg>
                Start recording
              </button>
            )}
            {state === "starting" && (
              <button className="btn-primary" disabled>
                Starting…
              </button>
            )}
            {state === "recording" && (
              <>
                <button onClick={pause} className="btn-light">Pause</button>
                <button onClick={stop} className="btn-danger">Stop</button>
              </>
            )}
            {state === "paused" && (
              <>
                <button onClick={resume} className="btn-primary">Resume</button>
                <button onClick={stop} className="btn-danger">Stop</button>
              </>
            )}
            {state === "stopping" && <button className="btn-primary" disabled>Stopping…</button>}
            {state === "uploading" && <button className="btn-primary" disabled>Uploading…</button>}
            {state === "error" && (
              <button onClick={() => { setState("idle"); setErrorMsg(null); }} className="btn-light">
                Try again
              </button>
            )}
          </div>
        </div>

        {errorMsg && (
          <p className="text-body-sm mt-4" style={{ color: "var(--color-leadgen-red)" }}>
            {errorMsg}
          </p>
        )}
      </div>

      {/* Mode toggle (locked once you press record) */}
      <div className="mt-6 flex items-center gap-2">
        <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>Mode</span>
        <div
          className="flex"
          style={{
            background: "var(--color-canvas-white)",
            border: "1px solid rgba(17,17,17,0.08)",
            borderRadius: 8,
            padding: 4,
            gap: 4,
          }}
        >
          {(["with-script", "freestyle"] as const).map((m) => (
            <button
              key={m}
              onClick={() => state === "idle" && setMode(m)}
              disabled={state !== "idle"}
              className="btn-ghost"
              style={{
                fontSize: 13,
                padding: "6px 12px",
                background: mode === m ? "var(--color-midnight-ink)" : "transparent",
                color: mode === m ? "var(--color-canvas-white)" : "var(--color-muted-ash)",
                cursor: state === "idle" ? "pointer" : "not-allowed",
              }}
            >
              {m === "with-script" ? "Teleprompter" : "Freestyle"}
            </button>
          ))}
        </div>
      </div>

      {/* Section rail */}
      {sections.length > 0 && (
        <div className="mt-10">
          <h2 className="text-heading-sm">Sections</h2>
          <div
            className="mt-4"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            {sections.map((s) => (
              <div key={s.id} className={`section-pill ${s.id === currentSectionId ? "is-current" : ""}`}>
                <div>
                  <div style={{ fontWeight: 500 }}>{s.name}</div>
                  <div className="text-caption num mt-1" style={{ color: "var(--color-muted-ash)" }}>
                    Target {fmtTime(s.targetSec * 1000)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Teleprompter / freestyle copy */}
      {mode === "with-script" ? (
        <div className="mt-10">
          <h2 className="text-heading-sm">Script</h2>
          <div className="script-panel mt-4">
            {sections.map((s) => (
              <p key={s.id} data-section-id={s.id}>
                {s.id === currentSectionId ? (
                  <mark className="current-section">{s.body}</mark>
                ) : (
                  s.body
                )}
              </p>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-10 empty-state" style={{ maxWidth: 920 }}>
          <p className="text-subheading">Freestyle mode</p>
          <p className="text-body mt-2" style={{ color: "var(--color-muted-ash)" }}>
            Script hidden. We&rsquo;ll diff what you said against what you wrote when you stop.
          </p>
        </div>
      )}

      {/* Live tags collected */}
      {tags.length > 0 && (
        <div className="mt-10">
          <h2 className="text-heading-sm">Live notes you flagged</h2>
          <div className="mt-4 flex gap-2 flex-wrap">
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
        </div>
      )}

      <div className="mt-10">
        <Link href={`/app/speeches/${speechId}`} className="btn-ghost">
          Cancel and return
        </Link>
      </div>
    </>
  );
}
