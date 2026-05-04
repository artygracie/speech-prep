"use client";

// Bottom bar — the persistent rehearsal dashboard.
//
// Two distinct layouts (not one layout that gets emptier in idle).
// Showing/hiding rows based on state would leave the bar feeling
// unbalanced; instead we render the layout the state actually needs.
//
// IDLE / STARTING / ERROR / STOPPING / UPLOADING — single horizontal
// row. Status dot + label on the left, hint sentence in the middle,
// big primary action on the right. No pacing row (nothing to pace).
//
// RECORDING / PAUSED — two rows.
//   Row 1: rec dot + ticking timer (left), live transcript (middle),
//          Stop + Pause (right).
//   Row 2: per-section pacing bar full width, with section name on
//          the left and time-vs-target on the right. Nudges and tag
//          flashes overlay the right side of this row.

import { useEffect, useRef, useState } from "react";

type Tag = { kind: "landed" | "flat" | "lost" | "callback"; atMs: number };

export type BottomBarNudge = {
  kind: "over-target" | "fast" | "slow" | "skipped";
  message: string;
} | null;

export type BottomBarState =
  | "idle"
  | "starting"
  | "recording"
  | "paused"
  | "stopping"
  | "uploading"
  | "error";

type Props = {
  state: BottomBarState;
  errorMsg?: string | null;

  elapsedMs: number;
  recentSpoken: string;

  currentSectionName: string;
  currentSectionElapsedMs: number;
  currentSectionTargetMs: number;

  nudge: BottomBarNudge;
  recentTags: Tag[];

  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRetry: () => void;
};

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function BottomBar({
  state,
  errorMsg,
  elapsedMs,
  recentSpoken,
  currentSectionName,
  currentSectionElapsedMs,
  currentSectionTargetMs,
  nudge,
  recentTags,
  onStart,
  onPause,
  onResume,
  onStop,
  onRetry,
}: Props) {
  const [tagFlash, setTagFlash] = useState<Tag | null>(null);
  const lastTagSeenRef = useRef<number>(0);

  const isLive = state === "recording" || state === "paused";

  useEffect(() => {
    const last = recentTags[recentTags.length - 1];
    if (!last) return;
    if (last.atMs === lastTagSeenRef.current) return;
    lastTagSeenRef.current = last.atMs;
    setTagFlash(last);
    const t = setTimeout(() => setTagFlash(null), 1100);
    return () => clearTimeout(t);
  }, [recentTags]);

  const sectionPct =
    currentSectionTargetMs > 0
      ? Math.min(100, (currentSectionElapsedMs / currentSectionTargetMs) * 100)
      : 0;
  const overTarget = currentSectionElapsedMs > currentSectionTargetMs;
  const nearTarget = sectionPct >= 85 && !overTarget;
  const barColor = overTarget
    ? "var(--color-leadgen-red)"
    : nearTarget
    ? "var(--color-engagement-gold)"
    : "var(--color-midnight-ink)";

  const styles = (
    <style>{`
      .bb-shell {
        position: fixed;
        left: 24px;
        right: 24px;
        bottom: 24px;
        margin: 0 auto;
        max-width: 1080px;
        z-index: 60;
        background: rgba(255, 255, 255, 0.92);
        backdrop-filter: saturate(180%) blur(20px);
        -webkit-backdrop-filter: saturate(180%) blur(20px);
        border: 1px solid rgba(17,17,17,0.06);
        border-radius: 16px;
        box-shadow: 0 12px 36px rgba(17,17,17,0.10), 0 1px 0 rgba(255,255,255,0.6) inset;
        padding: 16px 18px 16px 22px;
      }
      @media (max-width: 880px) {
        .bb-shell { left: 16px; right: 16px; bottom: 12px; padding: 14px; }
      }

      /* ===== Status dot ===== */
      .bb-dot { width: 9px; height: 9px; border-radius: 999px; flex: 0 0 auto; }
      .bb-dot.rec {
        background: var(--color-leadgen-red);
        box-shadow: 0 0 0 0 rgba(225, 101, 64, 0.55);
        animation: bb-pulse 1.4s ease-out infinite;
      }
      .bb-dot.paused { background: var(--color-engagement-gold); }
      .bb-dot.muted  { background: rgba(17,17,17,0.22); }
      .bb-dot.error  { background: var(--color-leadgen-red); }
      @keyframes bb-pulse {
        0%   { box-shadow: 0 0 0 0 rgba(225, 101, 64, 0.5); }
        70%  { box-shadow: 0 0 0 8px rgba(225, 101, 64, 0); }
        100% { box-shadow: 0 0 0 0 rgba(225, 101, 64, 0); }
      }
      .bb-status-label {
        font-size: 11px; font-weight: 500;
        letter-spacing: 0.1em; text-transform: uppercase;
        color: var(--color-muted-ash);
        white-space: nowrap;
      }
      .bb-status-label.rec { color: var(--color-leadgen-red); }
      .bb-status-label.paused { color: var(--color-engagement-gold); }
      .bb-status-label.error { color: var(--color-leadgen-red); }

      /* ===== Buttons ===== */
      .bb-btn {
        appearance: none; border: 0;
        padding: 14px 22px;
        border-radius: 12px;
        font-weight: 500; font-size: 15px; line-height: 1;
        cursor: pointer;
        display: inline-flex; align-items: center; gap: 10px;
        white-space: nowrap;
        transition: opacity 120ms ease, transform 120ms ease, box-shadow 120ms ease;
      }
      .bb-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .bb-btn-primary {
        background: var(--color-midnight-ink);
        color: var(--color-canvas-white);
        box-shadow: 0 1px 2px rgba(17,17,17,0.16), 0 6px 14px rgba(17,17,17,0.12);
      }
      .bb-btn-primary:hover:not(:disabled) {
        opacity: 0.94; transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(17,17,17,0.18), 0 10px 20px rgba(17,17,17,0.14);
      }
      .bb-btn-stop {
        background: var(--color-leadgen-red);
        color: var(--color-canvas-white);
        box-shadow: 0 1px 2px rgba(225,101,64,0.24), 0 6px 14px rgba(225,101,64,0.20);
      }
      .bb-btn-stop:hover:not(:disabled) {
        opacity: 0.94; transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(225,101,64,0.28), 0 10px 20px rgba(225,101,64,0.22);
      }
      .bb-btn-ghost {
        background: transparent;
        color: var(--color-muted-ash);
        padding: 10px 14px;
        font-size: 14px;
      }
      .bb-btn-ghost:hover { color: var(--color-midnight-ink); }
      .bb-btn-icon { width: 14px; height: 14px; fill: currentColor; }

      /* ===== IDLE LAYOUT — one row ===== */
      .bb-idle {
        display: flex; align-items: center; gap: 18px;
      }
      .bb-idle-status {
        display: inline-flex; align-items: center; gap: 10px;
        flex: 0 0 auto;
      }
      .bb-idle-hint {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 14px;
        color: var(--color-muted-ash);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bb-idle-hint.error { color: var(--color-leadgen-red); }
      .bb-idle-controls { flex: 0 0 auto; }

      /* ===== LIVE LAYOUT — two rows ===== */
      .bb-live { display: flex; flex-direction: column; gap: 14px; }
      .bb-live-row1 {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        column-gap: 18px;
        align-items: center;
      }
      .bb-timer-cluster {
        display: inline-flex; align-items: center; gap: 12px;
      }
      .bb-time {
        font-family: var(--font-serif);
        font-style: italic;
        font-size: 36px;
        line-height: 1;
        letter-spacing: -0.015em;
        color: var(--color-midnight-ink);
        font-variant-numeric: tabular-nums;
      }
      .bb-tape {
        font-family: var(--font-script);
        font-size: 14.5px;
        line-height: 1.45;
        color: var(--color-midnight-ink);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        mask-image: linear-gradient(90deg, transparent, #000 40px, #000);
        -webkit-mask-image: linear-gradient(90deg, transparent, #000 40px, #000);
        opacity: 0.8;
        min-width: 0;
      }
      .bb-tape em { font-style: italic; color: var(--color-deep-indigo); }
      .bb-controls { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; }

      /* Row 2 — pacing bar full width with right-side overlay */
      .bb-live-row2 {
        position: relative;
        display: flex; align-items: center; gap: 14px;
      }
      .bb-pace-label {
        font-size: 11px; font-weight: 500;
        letter-spacing: 0.1em; text-transform: uppercase;
        color: var(--color-midnight-ink);
        flex: 0 0 auto;
        white-space: nowrap;
      }
      .bb-pace-bar {
        flex: 1 1 auto;
        height: 4px; border-radius: 999px;
        background: rgba(17,17,17,0.06);
        position: relative; overflow: hidden;
        min-width: 60px;
      }
      .bb-pace-bar > span {
        position: absolute; inset: 0 auto 0 0;
        border-radius: 999px;
        transition: width 200ms linear, background-color 240ms ease;
      }
      .bb-pace-num {
        font-size: 12px; font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: var(--color-muted-ash);
        flex: 0 0 auto;
        white-space: nowrap;
      }
      .bb-pace-num.is-warn { color: var(--color-engagement-gold); }
      .bb-pace-num.is-over { color: var(--color-leadgen-red); }

      .bb-overlay {
        position: absolute; right: 0; top: -34px;
        display: inline-flex; align-items: center;
      }
      .bb-nudge {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 12px; font-weight: 500;
        padding: 5px 11px; border-radius: 999px;
        background: rgba(225, 101, 64, 0.10); color: #88321a;
        opacity: 0;
        animation: bb-nudge-in 280ms ease forwards;
      }
      .bb-nudge::before {
        content: ""; width: 6px; height: 6px; border-radius: 999px;
        background: var(--color-leadgen-red);
      }
      .bb-nudge.is-soft { background: rgba(251, 199, 104, 0.18); color: #5a4310; }
      .bb-nudge.is-soft::before { background: var(--color-engagement-gold); }
      @keyframes bb-nudge-in {
        from { opacity: 0; transform: translateY(4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .bb-tag-flash {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 11px; font-weight: 500;
        letter-spacing: 0.06em; text-transform: uppercase;
        padding: 5px 11px; border-radius: 999px;
        animation: bb-tag-pop 1.1s ease-out forwards;
      }
      .bb-tag-flash.tag-landed   { background: rgba(71,208,150,0.18); color: #0d4a30; }
      .bb-tag-flash.tag-flat     { background: rgba(251,199,104,0.22); color: #4a3508; }
      .bb-tag-flash.tag-lost     { background: rgba(225,101,64,0.14); color: #88321a; }
      .bb-tag-flash.tag-callback { background: rgba(50,142,250,0.14); color: var(--color-deep-indigo); }
      @keyframes bb-tag-pop {
        0%   { opacity: 0; transform: scale(0.85); }
        15%  { opacity: 1; transform: scale(1.05); }
        30%  { transform: scale(1); }
        85%  { opacity: 1; }
        100% { opacity: 0; transform: scale(0.95); }
      }

      /* Mobile: shrink the timer; collapse controls to icon-only feel */
      @media (max-width: 720px) {
        .bb-time { font-size: 28px; }
        .bb-tape { display: none; }
        .bb-btn  { padding: 12px 16px; font-size: 14px; }
        .bb-idle-hint { font-size: 13px; }
      }

      @media (prefers-reduced-motion: reduce) {
        .bb-dot.rec, .bb-nudge, .bb-tag-flash { animation: none !important; }
      }
    `}</style>
  );

  // ============================================================
  // IDLE-class layout: idle / starting / stopping / uploading / error
  // ============================================================
  if (!isLive) {
    let dotKind: "muted" | "rec" | "paused" | "error" = "muted";
    let label = "Ready";
    let hint = "Press start when you're ready. We'll listen and time you.";
    let isErrorHint = false;

    if (state === "starting") {
      dotKind = "muted";
      label = "Starting";
      hint = "Asking for the microphone…";
    } else if (state === "stopping") {
      dotKind = "muted";
      label = "Stopping";
      hint = "Wrapping up your recording…";
    } else if (state === "uploading") {
      dotKind = "muted";
      label = "Uploading";
      hint = "Saving the audio. Almost there.";
    } else if (state === "error") {
      dotKind = "error";
      label = "Error";
      hint = errorMsg ?? "Something went wrong.";
      isErrorHint = true;
    }

    return (
      <>
        {styles}
        <div className="bb-shell" role="status" aria-live="polite">
          <div className="bb-idle">
            <div className="bb-idle-status">
              <span className={`bb-dot ${dotKind}`} aria-hidden="true" />
              <span className={`bb-status-label ${dotKind === "error" ? "error" : ""}`}>
                {label}
              </span>
            </div>
            <div className={`bb-idle-hint ${isErrorHint ? "error" : ""}`}>{hint}</div>
            <div className="bb-idle-controls">
              {state === "idle" && (
                <button onClick={onStart} className="bb-btn bb-btn-primary">
                  <svg className="bb-btn-icon" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="6" />
                  </svg>
                  Start recording
                </button>
              )}
              {state === "starting" && (
                <button className="bb-btn bb-btn-primary" disabled>
                  Starting…
                </button>
              )}
              {state === "stopping" && (
                <button className="bb-btn bb-btn-stop" disabled>
                  Stopping…
                </button>
              )}
              {state === "uploading" && (
                <button className="bb-btn bb-btn-primary" disabled>
                  Uploading…
                </button>
              )}
              {state === "error" && (
                <button onClick={onRetry} className="bb-btn bb-btn-primary">
                  Try again
                </button>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ============================================================
  // LIVE-class layout: recording / paused
  // ============================================================
  const dotKind: "rec" | "paused" = state === "paused" ? "paused" : "rec";

  return (
    <>
      {styles}
      <div className="bb-shell" role="status" aria-live="polite">
        <div className="bb-live">
          {/* Row 1: timer | transcript | controls */}
          <div className="bb-live-row1">
            <div className="bb-timer-cluster">
              <span className={`bb-dot ${dotKind}`} aria-hidden="true" />
              <span className="bb-time">{fmt(elapsedMs)}</span>
            </div>

            <div className="bb-tape">
              {recentSpoken ? (
                <em>&ldquo;{recentSpoken}&rdquo;</em>
              ) : (
                <span style={{ color: "var(--color-muted-ash)" }}>Listening…</span>
              )}
            </div>

            <div className="bb-controls">
              {state === "recording" && (
                <>
                  <button onClick={onStop} className="bb-btn bb-btn-stop">
                    <svg className="bb-btn-icon" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                    Stop
                  </button>
                  <button onClick={onPause} className="bb-btn bb-btn-ghost">
                    Pause
                  </button>
                </>
              )}
              {state === "paused" && (
                <>
                  <button onClick={onResume} className="bb-btn bb-btn-primary">
                    Resume
                  </button>
                  <button
                    onClick={onStop}
                    className="bb-btn bb-btn-ghost"
                    style={{ color: "var(--color-leadgen-red)" }}
                  >
                    Stop
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Row 2: section pacing, full width */}
          <div className="bb-live-row2">
            <span className="bb-pace-label">{currentSectionName || "—"}</span>
            <div className="bb-pace-bar">
              <span style={{ width: `${sectionPct}%`, background: barColor }} />
            </div>
            <span
              className={`bb-pace-num ${
                overTarget ? "is-over" : nearTarget ? "is-warn" : ""
              }`}
            >
              {fmt(currentSectionElapsedMs)} / {fmt(currentSectionTargetMs)}
            </span>

            {/* Floating overlay: nudge or tag flash above the right
                end of the pacing bar so it doesn't push controls
                around. */}
            {(tagFlash || nudge) && (
              <div className="bb-overlay">
                {tagFlash ? (
                  <span className={`bb-tag-flash tag-${tagFlash.kind}`}>{tagFlash.kind}</span>
                ) : nudge ? (
                  <span
                    className={`bb-nudge ${
                      nudge.kind === "over-target" || nudge.kind === "skipped" ? "" : "is-soft"
                    }`}
                  >
                    {nudge.message}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
