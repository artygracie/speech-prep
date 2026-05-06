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

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { createSession, finalizeSession } from "@/app/app/sessions-actions";
import { useStreamingTranscription } from "@/lib/use-streaming-transcription";
import {
  emptyState as emptyAlignState,
  ingestWord,
  recentSpoken as recentSpokenWords,
  tokeniseScript,
  type LiveState,
} from "@/lib/live-align";
import { BottomBar, type BottomBarNudge } from "./bottom-bar";
import { MODE_LABEL, type SessionMode } from "@/lib/modes";

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
  initialMode = null,
  initialSectionId = null,
}: {
  speechId: string;
  sections: Section[];
  // Pre-selected mode from a lifecycle recommendation or query param.
  // The user can still toggle inside the recorder.
  initialMode?: SessionMode | null;
  // Pre-scoped section from a "drill this section" recommendation.
  // Only honoured when the section actually exists on the speech.
  initialSectionId?: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<SessionMode>(initialMode ?? "with-script");
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [tags, setTags] = useState<Tag[]>([]);
  const [, startTransition] = useTransition();

  // Section practice mode: when set, the recorder only sees this one
  // section. The script panel hides everything else, the alignment
  // tokens come from this section only, and the bottom bar's pacing
  // shows just this section's target.
  const [practicingSectionId, setPracticingSectionId] = useState<string | null>(
    initialSectionId && sections.some((s) => s.id === initialSectionId)
      ? initialSectionId
      : null,
  );

  // Live alignment state. Refs (mutable) drive the work; we mirror onto
  // state every ~150ms so React re-renders the bottom bar without us
  // setting state on every word arrival (which would thrash).
  const liveStateRef = useRef<LiveState | null>(null);
  const [liveTick, setLiveTick] = useState(0);

  const sessionIdRef = useRef<string | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickHandleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeRef = useRef<{ mime: string; ext: string }>({ mime: "audio/webm", ext: "webm" });

  // ---------- Sections in scope ----------
  // When practicing a single section, the rest of the speech is hidden
  // from every downstream calculation (script panel, alignment tokens,
  // pacing, sections rail).
  const sectionsInScope = useMemo(
    () =>
      practicingSectionId
        ? sections.filter((s) => s.id === practicingSectionId)
        : sections,
    [sections, practicingSectionId],
  );

  const scriptTokens = useMemo(
    () => tokeniseScript(sectionsInScope.map((s) => ({ id: s.id, position: s.position, body: s.body }))),
    [sectionsInScope],
  );

  // ---------- Live transcription ----------
  const onWord = useCallback(
    (w: { word: string; startMs: number; endMs: number }) => {
      if (!liveStateRef.current) return;
      liveStateRef.current = ingestWord(liveStateRef.current, scriptTokens, {
        word: w.word,
        startMs: w.startMs,
        endMs: w.endMs,
      });
    },
    [scriptTokens],
  );

  const streaming = useStreamingTranscription({
    onWord,
    onConnectionLost: () => {
      // Recording continues locally — the post-stop pipeline will produce
      // the canonical transcript even if the live feed dropped. No need
      // to interrupt the speaker.
    },
  });

  // ---------- Lifecycle ----------
  useEffect(() => {
    return () => {
      stopTicker();
      cleanupStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab-close protection. If the user closes the tab while recording,
  // we (1) ask the browser to confirm and (2) fire a beacon to mark
  // the session as failed so it doesn't sit forever in 'recording'.
  // The reaper would catch it eventually, but the beacon makes it
  // immediate so the dashboard never shows phantom in-progress rows.
  useEffect(() => {
    function onBeforeUnload(ev: BeforeUnloadEvent) {
      if (state !== "recording" && state !== "paused") return;
      const sid = sessionIdRef.current;
      if (sid) {
        // Best-effort beacon. We can't await; we can't log; we hope.
        try {
          const payload = JSON.stringify({ session_id: sid });
          const blob = new Blob([payload], { type: "application/json" });
          navigator.sendBeacon("/api/sessions/abandon", blob);
        } catch {
          // beacons swallow errors; nothing to do
        }
      }
      ev.preventDefault();
      // Modern browsers ignore the returnValue string but require it
      // be set non-empty for the prompt to appear.
      ev.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state]);

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
    // Tick at 5Hz: cheap enough, smooth enough for a live timer.
    // We also bump liveTick here so the bottom bar re-reads the
    // alignment ref. Coalescing both updates avoids two renders per tick.
    tickHandleRef.current = setInterval(() => {
      setElapsedMs(nowElapsed());
      setLiveTick((t) => t + 1);
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

      const result = await createSession(speechId, mode);
      if (!result.ok) {
        // Paywall reasons bounce to /app/billing with a hint;
        // anything else surfaces as a normal error in the bottom bar.
        if (result.reason === "paywall_no_sessions" || result.reason === "paywall_wrong_speech") {
          setErrorMsg(result.message);
          setState("error");
          cleanupStream();
          setTimeout(() => {
            window.location.href = `/app/billing?from=record&speech_id=${speechId}`;
          }, 1200);
          return;
        }
        setErrorMsg(result.message);
        setState("error");
        cleanupStream();
        return;
      }
      sessionIdRef.current = result.sessionId;

      rec.start(1000);
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setTags([]);
      // Reset alignment state. We ignore failures of the streaming
      // pipe — if Deepgram isn't reachable, the recording still
      // captures locally and the canonical transcript runs server-side
      // post-stop.
      liveStateRef.current = emptyAlignState(scriptTokens);
      setLiveTick(0);
      startTicker();
      setState("recording");
      // Start streaming AFTER we set state so the bottom bar mounts
      // before words arrive. If this throws we just don't get live
      // alignment — the recording continues.
      void streaming.start(stream).catch((err) => {
        console.warn("[recorder] streaming pipe failed:", err);
      });
    } catch (err) {
      console.error(err);
      // Paywall is handled inline in the result branch above. Anything
      // landing here is a real failure — typically mic permission or
      // some browser API quirk.
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
    streaming.stop();
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
  //
  // Priority for "which section are we in right now?":
  //   1. The live alignment cursor (when streaming is producing words)
  //   2. The clock heuristic (when not — e.g. user paused, mic glitched)
  //
  // The alignment cursor is honest because it reads from what the
  // speaker is actually saying. The clock heuristic is a fallback.
  const currentSectionIdx = useMemo(() => {
    void liveTick; // re-evaluate when liveTick changes
    if (sectionsInScope.length === 0) return 0;

    // 1. Alignment-based.
    const live = liveStateRef.current;
    if (live && live.currentSectionId) {
      const idx = sectionsInScope.findIndex((s) => s.id === live.currentSectionId);
      if (idx >= 0) return idx;
    }

    // 2. Clock-based fallback.
    let runningMs = 0;
    for (let i = 0; i < sectionsInScope.length; i++) {
      runningMs += sectionsInScope[i].targetSec * 1000;
      if (elapsedMs <= runningMs) return i;
    }
    return sectionsInScope.length - 1;
  }, [elapsedMs, sectionsInScope, liveTick]);

  const currentSection = sectionsInScope[currentSectionIdx];

  // Section elapsed time. We want the time spent *in this section*, not
  // the wall-clock difference. We compute it as elapsedMs minus the
  // running-target offset of all previous sections, then clamp.
  const sectionElapsedMs = useMemo(() => {
    let running = 0;
    for (let i = 0; i < currentSectionIdx; i++) running += sectionsInScope[i].targetSec * 1000;
    return Math.max(0, elapsedMs - running);
  }, [elapsedMs, sectionsInScope, currentSectionIdx]);

  // Live nudge for the bottom bar. Computed from alignment + clock state,
  // recomputed on every liveTick. We only show one at a time, with this
  // priority: skipped > over-target > too-fast > too-slow.
  const nudge = useMemo<BottomBarNudge>(() => {
    void liveTick; // re-evaluate
    if (state !== "recording") return null;
    if (!currentSection) return null;

    const live = liveStateRef.current;

    // 1. Did we just blow past 4+ script tokens? (Alignment proxy for
    //    "you skipped a line.")
    if (live) {
      const lastEvents = live.events.slice(-1);
      const last = lastEvents[0];
      if (last && last.kind === "skipped") {
        const wordsSkipped = last.written.split(/\s+/).filter(Boolean).length;
        if (wordsSkipped >= 4) {
          return {
            kind: "skipped",
            message: `Skipped a line in ${currentSection.name}`,
          };
        }
      }
    }

    // 2. Are we over the section target?
    if (sectionElapsedMs > currentSection.targetSec * 1000) {
      const overSec = Math.round((sectionElapsedMs - currentSection.targetSec * 1000) / 1000);
      return {
        kind: "over-target",
        message: `${overSec}s over on ${currentSection.name}`,
      };
    }

    // 3. WPM out of band. We need at least ~4s of speech and at least 8
    //    matched words for the WPM read to be meaningful.
    if (live && (live.matched + live.paraphrased) >= 8 && elapsedMs > 4000) {
      const totalSpoken = live.matched + live.paraphrased + live.improv;
      const wpm = (totalSpoken / (elapsedMs / 1000)) * 60;
      if (wpm > 175) {
        return { kind: "fast", message: "Slow down" };
      }
      if (wpm < 100) {
        return { kind: "slow", message: "Pick up the pace" };
      }
    }

    return null;
  }, [state, currentSection, sectionElapsedMs, elapsedMs, liveTick]);

  // The transcript window the bottom bar shows.
  const recentSpoken = useMemo(() => {
    void liveTick;
    return liveStateRef.current ? recentSpokenWords(liveStateRef.current, 8) : "";
  }, [liveTick]);

  const isLive = state === "recording" || state === "paused";
  const isWorking = state === "stopping" || state === "uploading";

  const practicingSection = practicingSectionId
    ? sections.find((s) => s.id === practicingSectionId) ?? null
    : null;

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

        /* ===== Left column — toggle + script pane ===== */
        .rec-script-col {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

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

        /* ===== Freestyle pane =====
           Same shape as the teleprompter script panel so the mode toggle
           feels like a real switch rather than two unrelated screens. We
           keep the section headings and target times; the bodies become
           a single faint dash line that reads as "speak from memory."
           A soft hero-style gradient sits behind everything to give the
           freestyle screen its own atmosphere. */
        .rec-freestyle {
          position: relative;
          background: var(--color-canvas-white);
          border: 1px solid rgba(17,17,17,0.06);
          border-radius: 14px;
          padding: 40px 48px 56px;
          min-height: 520px;
          overflow: hidden;
        }
        @media (max-width: 1100px) { .rec-freestyle { padding: 28px 24px 36px; min-height: 0; } }

        .rec-freestyle::before,
        .rec-freestyle::after {
          content: "";
          position: absolute;
          pointer-events: none;
          z-index: 0;
          border-radius: 50%;
          filter: blur(80px);
        }
        .rec-freestyle::before {
          top: -20%; left: -10%; width: 70%; height: 80%;
          background: radial-gradient(closest-side,
            rgba(232, 64, 13, 0.18) 0%,
            rgba(255, 238, 216, 0.18) 35%,
            rgba(208, 178, 255, 0.10) 80%);
          opacity: 0.85;
        }
        .rec-freestyle::after {
          bottom: -30%; right: -15%; width: 70%; height: 80%;
          background: radial-gradient(closest-side,
            rgba(208, 178, 255, 0.15) 0%,
            rgba(198, 236, 233, 0.15) 40%,
            rgba(153, 255, 249, 0.10) 85%);
          opacity: 0.75;
        }

        .rec-freestyle > * { position: relative; z-index: 1; }

        .rec-freestyle-badge {
          display: inline-flex; align-items: center; gap: 6px;
          background: rgba(255,255,255,0.7);
          backdrop-filter: saturate(160%) blur(8px);
          -webkit-backdrop-filter: saturate(160%) blur(8px);
          border: 1px solid rgba(17,17,17,0.06);
          border-radius: 999px;
          padding: 5px 10px 5px 8px;
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--color-midnight-ink);
          margin-bottom: 28px;
        }
        .rec-freestyle-badge::before {
          content: "";
          width: 5px; height: 5px; border-radius: 999px;
          background: var(--color-phoenix-orange);
          display: inline-block;
        }

        /* Sections inside freestyle — same layout AND content as teleprompter,
           but the body text is blurred + greyed. The page keeps its full
           visual weight (no collapse, no placeholder), and the user can
           tell where each section sits without being able to read the
           words. */
        .rec-freestyle-section {
          padding: 18px 0;
        }
        .rec-freestyle-section:first-of-type { padding-top: 0; }
        .rec-freestyle-section:not(:first-of-type) {
          border-top: 1px solid rgba(17,17,17,0.06);
        }
        .rec-freestyle-section.is-active .rec-freestyle-head h3 {
          color: var(--color-midnight-ink);
        }
        .rec-freestyle-section.is-active .rec-current-marker {
          opacity: 1; transform: scale(1);
        }
        .rec-freestyle-head {
          display: flex; align-items: baseline; gap: 12px;
          margin-bottom: 14px;
        }
        .rec-freestyle-head h3 {
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--color-muted-ash);
          transition: color 240ms ease;
        }
        /* Real script body, blurred. user-select disabled so a curious
           user can't copy + paste it out (defeats the rehearsal purpose).
           pointer-events: none too, for the same reason. */
        .rec-freestyle-body {
          font-family: var(--font-script);
          font-size: 19px;
          line-height: 1.75;
          color: rgba(17,17,17,0.55);
          white-space: pre-wrap;
          filter: blur(5px);
          -webkit-filter: blur(5px);
          user-select: none;
          pointer-events: none;
          transition: filter 360ms ease, color 360ms ease, opacity 360ms ease;
        }
        /* While recording, push non-active sections further away — fainter
           text + heavier blur — so the eye lands on the current section
           without tempting the speaker to peek. */
        .rec-grid.is-live .rec-freestyle-section:not(.is-active) .rec-freestyle-body {
          filter: blur(7px);
          -webkit-filter: blur(7px);
          color: rgba(17,17,17,0.32);
        }
        .rec-grid.is-live .rec-freestyle-section.is-active .rec-freestyle-body {
          color: rgba(17,17,17,0.6);
        }

        /* Switch-to-teleprompter footer */
        .rec-freestyle-footer {
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid rgba(17,17,17,0.06);
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

        /* Mode toggle — two equal options, sits above the script pane.
           Capped width so it reads as a control over the pane below
           rather than a full-width banner. */
        .rec-mode {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4px;
          background: var(--color-whisper-gray);
          border-radius: 10px;
          padding: 4px;
          width: 320px;
          max-width: 100%;
        }
        @media (max-width: 1100px) { .rec-mode { width: 100%; } }
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
        /* Hover-revealed Practice button per rail row. */
        .rec-rail-item-row { position: relative; }
        .rec-rail-item-row:hover { background: var(--color-whisper-gray); }
        .rec-rail-name { flex: 1; min-width: 0; }
        .rec-rail-time { margin-right: 6px; }
        .rec-rail-practice {
          opacity: 0;
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
          border: 0; border-radius: 6px;
          padding: 3px 8px;
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.04em;
          cursor: pointer;
          transition: opacity 120ms ease, background 120ms ease;
        }
        .rec-rail-item-row:hover .rec-rail-practice,
        .rec-rail-item-row .rec-rail-practice:focus {
          opacity: 1;
        }
        /* When this row is the one already being practiced, the badge
           stays visible and shows the active state. */
        .rec-rail-item-row.is-current .rec-rail-practice {
          opacity: 1;
          background: rgba(50,142,250,0.14);
          color: var(--color-deep-indigo);
        }
        .rec-rail-item-row.is-locked .rec-rail-practice { display: none; }

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

      {/* Practice mode banner — only when scoped to a single section. */}
      {practicingSection && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            marginBottom: 16,
            background: "rgba(50,142,250,0.08)",
            border: "1px solid rgba(50,142,250,0.18)",
            borderRadius: 10,
            color: "var(--color-deep-indigo)",
            fontSize: 13,
          }}
        >
          <span>
            Practicing just <strong>{practicingSection.name}</strong> · target{" "}
            {fmtTime(practicingSection.targetSec * 1000)}
          </span>
          <button
            onClick={() => state === "idle" && setPracticingSectionId(null)}
            disabled={state !== "idle"}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--color-deep-indigo)",
              textDecoration: "underline",
              textUnderlineOffset: 4,
              cursor: state === "idle" ? "pointer" : "not-allowed",
              opacity: state === "idle" ? 1 : 0.5,
              fontSize: 13,
            }}
          >
            Practice the whole speech instead
          </button>
        </div>
      )}

      <div className={`rec-grid ${isLive ? "is-live" : ""}`}>
        {/* ============ LEFT: SCRIPT (or freestyle placeholder) ============ */}
        <div className="rec-script-col">
          {/* Mode toggle — sits above the script so it reads as a control
              over what's in the pane below, not a sidebar setting. */}
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
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>

        {mode === "with-script" ? (
          <div className="rec-script">
            {sectionsInScope.map((s, i) => (
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
            {/* Mode marker so it's unmistakable what you're looking at,
                even when scrolled or screenshotted. */}
            <span className="rec-freestyle-badge">{MODE_LABEL.freestyle}</span>

            {/* Same section structure as teleprompter — only the bodies
                are missing. The user keeps their navigational map: which
                section comes next, how long it should take. */}
            {sectionsInScope.map((s, i) => (
              <section
                key={s.id}
                className={`rec-freestyle-section ${
                  isLive && i === currentSectionIdx ? "is-active" : ""
                }`}
              >
                <header className="rec-freestyle-head">
                  <span className="rec-current-marker" aria-hidden="true" />
                  <h3>{s.name}</h3>
                  <span
                    className="text-caption"
                    style={{ color: "var(--color-muted-ash)", marginLeft: "auto" }}
                  >
                    Target {fmtTime(s.targetSec * 1000)}
                  </span>
                </header>
                {/* Real script body, blurred. We render the actual words
                    (with aria-hidden so screen readers don't read them
                    out — they're not meant to be consumed in this mode)
                    so the section keeps its true visual height. */}
                <p className="rec-freestyle-body" aria-hidden="true">
                  {s.body || "—"}
                </p>
              </section>
            ))}

            <div className="rec-freestyle-footer">
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
                  textDecorationColor: "rgba(17,17,17,0.2)",
                  cursor: state === "idle" ? "pointer" : "not-allowed",
                  opacity: state === "idle" ? 1 : 0.4,
                }}
              >
                Bring back the script
              </button>
            </div>
          </div>
        )}
        </div>

        {/* ============ RIGHT: STICKY SIDEBAR ============ */}
        <aside className="rec-side">
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
            {/* Per-section pacing lives in the floating bottom bar
                while recording — no need to duplicate it here. */}
          </div>

          {/* Sections rail.
              When idle, every row reveals a "Practice" button on hover
              that scopes the recorder to just that section. When live,
              the rail shows the active section.
              When practicing, only the practice section is in
              sectionsInScope, but the rail still surfaces ALL sections
              so the user can switch what they're practicing. */}
          {sections.length > 0 && (
            <div className="rec-side-card rec-rail">
              <div className="rec-rail-title">
                {practicingSectionId ? "Switch practice" : "Sections"}
              </div>
              <div className="rec-rail-list">
                {sections.map((s) => {
                  // "Current" indicator: in normal mode, follows the
                  // alignment cursor; in practice mode, the practiced
                  // section is always current.
                  const isThisSection = practicingSectionId
                    ? s.id === practicingSectionId
                    : isLive && currentSection?.id === s.id;
                  return (
                    <div
                      key={s.id}
                      className={`rec-rail-item rec-rail-item-row ${
                        isThisSection ? "is-current" : ""
                      } ${state !== "idle" ? "is-locked" : ""}`}
                    >
                      <span className="rec-rail-name">{s.name}</span>
                      <span className="num rec-rail-time">{fmtTime(s.targetSec * 1000)}</span>
                      {state === "idle" && (
                        <button
                          className="rec-rail-practice"
                          onClick={() =>
                            setPracticingSectionId((cur) => (cur === s.id ? null : s.id))
                          }
                          title={
                            practicingSectionId === s.id
                              ? "Stop practicing this section"
                              : `Practice just "${s.name}"`
                          }
                        >
                          {practicingSectionId === s.id ? "Practicing" : "Practice"}
                        </button>
                      )}
                    </div>
                  );
                })}
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

          {/* The record controls live in the floating bottom bar so
              start and stop happen in the same place. The sidebar
              keeps the contextual chrome (mode, timer, sections,
              live notes) and stays out of the action layer. */}
        </aside>
      </div>

      {/* Spacer so the script + sidebar can scroll past the bottom of
          the viewport without the floating bar covering content. The
          bar is ~130–150px tall after the controls were upsized; we
          reserve 180px to be generous. */}
      <div style={{ height: 180 }} aria-hidden="true" />

      {/* Floating bottom bar — always visible. Owns the record control
          (Start / Stop / Pause / Resume) and shows the live timer,
          transcript window, per-section pacing, and any active nudge. */}
      <BottomBar
        state={state}
        errorMsg={errorMsg}
        elapsedMs={elapsedMs}
        recentSpoken={recentSpoken}
        currentSectionName={currentSection?.name ?? ""}
        currentSectionElapsedMs={sectionElapsedMs}
        currentSectionTargetMs={(currentSection?.targetSec ?? 0) * 1000}
        nudge={nudge}
        recentTags={tags}
        onStart={start}
        onPause={pause}
        onResume={resume}
        onStop={stop}
        onRetry={() => {
          setState("idle");
          setErrorMsg(null);
        }}
      />
    </>
  );
}
