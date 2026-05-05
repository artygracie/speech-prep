"use client";

// PlaybackDock — small "Listen back" pill in the report header that,
// on first play, docks a persistent mini-player to the bottom of the
// viewport. The full-width audio element used to occupy the prime
// vertical slot between the header and the diff; this trades that for
// a non-blocking footer that you can scrub while you read the
// transcript and coach notes.
//
// Why this shape:
//   - The pill alone feels too easily missed; the dock alone reads as
//     "this is the focus" and pulls attention away from the coach
//     answer. Together: pill = unobtrusive entry point, dock = the
//     player you wanted, only when you wanted it.
//   - One <audio> element, owned by the dock once the user opens it.
//     The pill is just a play/pause + duration affordance that mirrors
//     the dock's playback state.
//   - "Close" hides the dock and pauses; the pill stays in the header
//     so they can re-open it without scrolling.

import { useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  durationSeconds?: number | null;
};

function fmt(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PlaybackDock({ src, durationSeconds }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [docked, setDocked] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  // Prefer the duration the server already knew (from session.duration_ms)
  // so the pill shows a real number on first paint. Once metadata loads
  // we replace it with the audio element's value, which is authoritative.
  const [duration, setDuration] = useState<number>(durationSeconds ?? 0);
  // Playback rate. Cycles 1 → 1.25 → 1.5 → 2 → 1 on click.
  const [rate, setRate] = useState<number>(1);
  function nextRate(r: number): number {
    if (r < 1.25) return 1.25;
    if (r < 1.5) return 1.5;
    if (r < 2) return 2;
    return 1;
  }
  function cycleRate() {
    const r = nextRate(rate);
    setRate(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
  }

  // Wire up audio listeners once the element exists.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoaded = () => setDuration(audio.duration || 0);
    const onTime = () => setCurrent(audio.currentTime || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    setDocked(true);
    if (audio.paused) {
      audio.play().catch(() => {
        // Autoplay can fail in obscure cases; the dock is open, the
        // user can hit play in the dock itself.
      });
    } else {
      audio.pause();
    }
  }

  function closeDock() {
    const audio = audioRef.current;
    if (audio && !audio.paused) audio.pause();
    setDocked(false);
  }

  function onScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const t = Number(e.target.value);
    audio.currentTime = t;
    setCurrent(t);
  }

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <>
      <style>{`
        .listen-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--color-canvas-white);
          border: 1px solid rgba(17,17,17,0.12);
          border-radius: 999px;
          padding: 6px 14px 6px 8px;
          font-size: 13px;
          font-weight: 500;
          color: var(--color-midnight-ink);
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease;
        }
        .listen-pill:hover {
          background: rgba(17,17,17,0.04);
          border-color: rgba(17,17,17,0.18);
        }
        .listen-pill-icon {
          width: 22px; height: 22px;
          border-radius: 999px;
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 10px;
        }
        .listen-pill-time {
          font-variant-numeric: tabular-nums;
          color: var(--color-muted-ash);
          font-weight: 400;
        }

        .dock-spacer { height: 0; }
        .dock-wrap {
          position: fixed;
          left: 0; right: 0; bottom: 0;
          z-index: 40;
          display: flex; justify-content: center;
          padding: 12px 16px 16px;
          pointer-events: none;
        }
        .dock {
          pointer-events: auto;
          width: 100%;
          max-width: 760px;
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
          border-radius: 14px;
          padding: 12px 14px;
          display: grid;
          grid-template-columns: auto 1fr auto auto auto auto;
          align-items: center;
          gap: 12px;
          box-shadow: 0 8px 24px rgba(17,17,17,0.22), 0 2px 6px rgba(17,17,17,0.18);
          animation: dock-in 220ms cubic-bezier(0.2, 0.7, 0.2, 1);
        }
        @keyframes dock-in {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .dock-play {
          width: 36px; height: 36px;
          border-radius: 999px;
          background: var(--color-canvas-white);
          color: var(--color-midnight-ink);
          border: 0;
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 13px;
          transition: opacity 120ms ease;
        }
        .dock-play:hover { opacity: 0.9; }
        .dock-scrub {
          position: relative;
          height: 24px;
          display: flex; align-items: center;
        }
        .dock-track {
          position: absolute; left: 0; right: 0; top: 11px;
          height: 3px; border-radius: 999px;
          background: rgba(255,255,255,0.18);
        }
        .dock-fill {
          position: absolute; left: 0; top: 11px;
          height: 3px; border-radius: 999px;
          background: var(--color-canvas-white);
        }
        .dock-scrub input[type="range"] {
          position: relative;
          width: 100%;
          appearance: none;
          background: transparent;
          margin: 0;
          height: 24px;
          cursor: pointer;
          z-index: 1;
        }
        .dock-scrub input[type="range"]::-webkit-slider-runnable-track {
          height: 24px; background: transparent;
        }
        .dock-scrub input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          width: 12px; height: 12px;
          border-radius: 999px;
          background: var(--color-canvas-white);
          margin-top: 6px;
          border: 0;
          box-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }
        .dock-scrub input[type="range"]::-moz-range-thumb {
          width: 12px; height: 12px;
          border-radius: 999px;
          background: var(--color-canvas-white);
          border: 0;
        }
        .dock-time {
          font-variant-numeric: tabular-nums;
          font-size: 12px;
          color: rgba(255,255,255,0.78);
          white-space: nowrap;
        }
        .dock-close {
          background: transparent;
          color: rgba(255,255,255,0.6);
          border: 0;
          padding: 6px 8px;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          border-radius: 6px;
        }
        .dock-close:hover {
          color: var(--color-canvas-white);
          background: rgba(255,255,255,0.08);
        }

        @media (max-width: 640px) {
          .dock {
            grid-template-columns: auto 1fr auto auto auto;
            gap: 8px;
            padding: 10px 12px;
          }
          .dock-time { display: none; }
        }
      `}</style>

      <button
        type="button"
        className="listen-pill"
        onClick={togglePlay}
        aria-label={playing ? "Pause recording" : "Listen to recording"}
      >
        <span className="listen-pill-icon" aria-hidden="true">
          {playing ? "❚❚" : "▶"}
        </span>
        <span>Listen back</span>
        <span className="listen-pill-time">· {fmt(duration)}</span>
      </button>

      {/* Single audio element. Hidden — controls live in the dock or pill. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={src} preload="metadata" style={{ display: "none" }} />

      {docked && (
        <div className="dock-wrap" role="region" aria-label="Audio playback">
          <div className="dock">
            <button
              type="button"
              className="dock-play"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <div className="dock-scrub">
              <div className="dock-track" />
              <div className="dock-fill" style={{ width: `${pct}%` }} />
              <input
                type="range"
                min={0}
                max={Math.max(duration, 0.01)}
                step={0.05}
                value={Math.min(current, duration || 0)}
                onChange={onScrub}
                aria-label="Seek"
              />
            </div>
            <div className="dock-time">
              {fmt(current)} / {fmt(duration)}
            </div>
            <button
              type="button"
              className="dock-close"
              onClick={cycleRate}
              aria-label={`Playback speed ${rate}x`}
              title="Cycle playback speed"
              style={{
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
                fontWeight: 500,
                minWidth: 36,
              }}
            >
              {rate}x
            </button>
            <a
              href={src}
              download
              className="dock-close"
              aria-label="Download recording"
              title="Download"
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
            >
              ⤓
            </a>
            <button
              type="button"
              className="dock-close"
              onClick={closeDock}
              aria-label="Close player"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
