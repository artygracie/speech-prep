"use client";

// The bottom bar — the persistent rehearsal dashboard. Always visible
// on the recording page; appearance and contents shift with state.
//
// idle         → big black "Start recording" button on the right.
//                Pacing bar is dim placeholder. Transcript area says
//                "Press start to begin."
// recording    → red rec-dot pulsing + ticking timer; live transcript
//                window scrolls; per-section pacing bar fills; nudge
//                or tag flashes on the right; Stop button replaces
//                Start. A discrete Pause sits next to it.
// paused       → amber dot, frozen timer, Resume + Stop.
// stopping/    → disabled state with status message.
// uploading
// error        → "Try again" button.
//
// Owning the record controls here means the user starts and stops in
// the same place. The sidebar's old action card becomes redundant.

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

  // Controls
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRetry: () => void;
};

const KEY_HINTS: { key: string; label: string }[] = [
  { key: "L", label: "Landed" },
  { key: "F", label: "Flat" },
  { key: "X", label: "Lost" },
  { key: "C", label: "Callback" },
];

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
  const paused = state === "paused";

  useEffect(() => {
    const last = recentTags[recentTags.length - 1];
    if (!last) return;
    if (last.atMs === lastTagSeenRef.current) return;
    lastTagSeenRef.current = last.atMs;
    setTagFlash(last);
    const t = setTimeout(() => setTagFlash(null), 1100);
    return () => clearTimeout(t);
  }, [recentTags]);

  const sectionPct = currentSectionTargetMs > 0
    ? Math.min(100, (currentSectionElapsedMs / currentSectionTargetMs) * 100)
    : 0;
  const overTarget = currentSectionElapsedMs > currentSectionTargetMs;
  const nearTarget = sectionPct >= 85 && !overTarget;
  const barColor = overTarget
    ? "var(--color-leadgen-red)"
    : nearTarget
    ? "var(--color-engagement-gold)"
    : "var(--color-midnight-ink)";

  // ---------- Status indicator ----------
  // Color, dot animation, and status text vary by state.
  const status = (() => {
    if (state === "recording") return { dotClass: "rec", text: null };
    if (state === "paused")    return { dotClass: "paused", text: "Paused" };
    if (state === "starting")  return { dotClass: "muted", text: "Starting…" };
    if (state === "stopping")  return { dotClass: "muted", text: "Stopping…" };
    if (state === "uploading") return { dotClass: "muted", text: "Uploading…" };
    if (state === "error")     return { dotClass: "error", text: "Error" };
    return                            { dotClass: "muted", text: "Ready" };
  })();

  return (
    <>
      <style>{`
        /* The sidenav in the app shell is 240px wide on desktop and
           hidden under 880px. We anchor the bar to the right of it
           rather than centering on the viewport so the bar doesn't
           overlap the sidebar at any width. */
        .bb-shell {
          position: fixed;
          left: calc(240px + 24px);
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
          padding: 14px 16px 12px 18px;
        }
        @media (max-width: 880px) {
          /* Sidenav is hidden under 880px — bar gets the full width
             minus the page gutter. */
          .bb-shell { left: 16px; right: 16px; }
        }

        /* Two-row grid:
           Row 1: status/timer | transcript | controls
           Row 2: pacing                    | nudges/keys
           In idle, the transcript area shows a hint and the pacing
           bar collapses to a dim placeholder. */
        .bb-grid {
          display: grid;
          grid-template-columns: minmax(160px, auto) minmax(0, 1fr) auto;
          column-gap: 18px;
          row-gap: 10px;
          align-items: center;
          min-width: 0;
        }
        @media (max-width: 720px) {
          .bb-grid { grid-template-columns: minmax(0, 1fr) auto; column-gap: 10px; }
          .bb-tape, .bb-keys { display: none; }
        }

        /* ===== status + timer cluster ===== */
        .bb-timer {
          display: flex; align-items: center; gap: 10px;
          font-variant-numeric: tabular-nums;
        }
        .bb-status-dot {
          width: 9px; height: 9px; border-radius: 999px;
        }
        .bb-status-dot.rec {
          background: var(--color-leadgen-red);
          box-shadow: 0 0 0 0 rgba(225, 101, 64, 0.55);
          animation: bb-pulse 1.4s ease-out infinite;
        }
        .bb-status-dot.paused { background: var(--color-engagement-gold); }
        .bb-status-dot.muted  { background: rgba(17,17,17,0.18); }
        .bb-status-dot.error  { background: var(--color-leadgen-red); }
        @keyframes bb-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(225, 101, 64, 0.5); }
          70%  { box-shadow: 0 0 0 8px rgba(225, 101, 64, 0); }
          100% { box-shadow: 0 0 0 0 rgba(225, 101, 64, 0); }
        }
        .bb-time {
          font-family: var(--font-serif);
          font-style: italic;
          font-size: 28px;
          line-height: 1;
          letter-spacing: -0.01em;
          color: var(--color-midnight-ink);
        }
        .bb-status-text {
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-muted-ash);
          white-space: nowrap;
        }
        .bb-status-text.error { color: var(--color-leadgen-red); }

        /* ===== transcript tape ===== */
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
          padding-left: 16px;
          opacity: 0.85;
          min-width: 0;
        }
        .bb-tape em {
          font-style: italic;
          color: var(--color-deep-indigo);
        }
        .bb-tape.is-hint {
          font-style: normal;
          font-family: var(--font-sans);
          font-size: 13px;
          color: var(--color-muted-ash);
        }

        /* ===== controls cluster ===== */
        .bb-controls { display: flex; align-items: center; gap: 8px; }
        .bb-btn {
          appearance: none;
          border: 0;
          padding: 11px 18px;
          border-radius: 10px;
          font-weight: 500;
          font-size: 14px;
          line-height: 1;
          cursor: pointer;
          display: inline-flex; align-items: center; gap: 8px;
          transition: opacity 120ms ease, transform 120ms ease, background 120ms ease;
        }
        .bb-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .bb-btn-primary {
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
        }
        .bb-btn-primary:hover:not(:disabled) { opacity: 0.92; transform: translateY(-1px); }
        .bb-btn-stop {
          background: var(--color-leadgen-red);
          color: var(--color-canvas-white);
        }
        .bb-btn-stop:hover:not(:disabled) { opacity: 0.92; }
        .bb-btn-ghost {
          background: transparent;
          color: var(--color-muted-ash);
          padding: 8px 12px;
        }
        .bb-btn-ghost:hover { color: var(--color-midnight-ink); }
        .bb-btn-icon {
          width: 14px; height: 14px;
          fill: currentColor;
        }

        /* ===== pacing row ===== */
        .bb-pacing {
          grid-column: 1 / 3;
          display: flex; align-items: center; gap: 12px;
          min-width: 0;
        }
        .bb-pacing-label {
          display: inline-flex; align-items: baseline; gap: 8px;
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-muted-ash);
          flex-shrink: 0;
        }
        .bb-pacing-label strong {
          color: var(--color-midnight-ink);
          font-weight: 500;
        }
        .bb-pacing-bar {
          flex: 1;
          height: 4px;
          border-radius: 999px;
          background: rgba(17,17,17,0.06);
          overflow: hidden;
          position: relative;
          min-width: 60px;
        }
        .bb-pacing-bar > span {
          position: absolute; inset: 0 auto 0 0;
          border-radius: 999px;
          transition: width 200ms linear, background-color 240ms ease;
        }
        .bb-pacing-num {
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.06em;
          color: var(--color-muted-ash);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }
        .bb-pacing-num.is-warn { color: var(--color-engagement-gold); }
        .bb-pacing-num.is-over { color: var(--color-leadgen-red); }

        /* In idle, the pacing row is dimmer — it's just showing scope. */
        .bb-pacing.is-idle .bb-pacing-bar { opacity: 0.6; }

        /* ===== nudges + tag hints ===== */
        .bb-aside { grid-column: 3 / 4; display: flex; align-items: center; gap: 12px; }
        @media (max-width: 720px) { .bb-aside { grid-column: 2 / 3; } }
        .bb-nudge {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 12px;
          font-weight: 500;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(225, 101, 64, 0.10);
          color: #88321a;
          opacity: 0;
          animation: bb-nudge-in 280ms ease forwards;
        }
        .bb-nudge::before {
          content: "";
          width: 6px; height: 6px; border-radius: 999px;
          background: var(--color-leadgen-red);
        }
        .bb-nudge.is-soft { background: rgba(251, 199, 104, 0.18); color: #5a4310; }
        .bb-nudge.is-soft::before { background: var(--color-engagement-gold); }
        @keyframes bb-nudge-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .bb-keys { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .bb-key {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 11px;
          letter-spacing: 0.04em;
          color: var(--color-muted-ash);
        }
        .bb-key kbd {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 10px;
          padding: 1px 5px;
          border-radius: 3px;
          background: rgba(17,17,17,0.04);
          border: 1px solid rgba(17,17,17,0.08);
          color: var(--color-midnight-ink);
        }
        .bb-tag-flash {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding: 4px 10px;
          border-radius: 999px;
          animation: bb-tag-pop 1.1s ease-out forwards;
        }
        .bb-tag-flash.tag-landed { background: rgba(71,208,150,0.18); color: #0d4a30; }
        .bb-tag-flash.tag-flat { background: rgba(251,199,104,0.22); color: #4a3508; }
        .bb-tag-flash.tag-lost { background: rgba(225,101,64,0.14); color: #88321a; }
        .bb-tag-flash.tag-callback { background: rgba(50,142,250,0.14); color: var(--color-deep-indigo); }
        @keyframes bb-tag-pop {
          0%   { opacity: 0; transform: scale(0.85); }
          15%  { opacity: 1; transform: scale(1.05); }
          30%  { transform: scale(1); }
          85%  { opacity: 1; }
          100% { opacity: 0; transform: scale(0.95); }
        }

        .bb-error {
          font-size: 12px; color: var(--color-leadgen-red);
          margin-left: 8px;
          max-width: 360px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        @media (max-width: 720px) {
          /* left/right gutter already set by the 880px breakpoint —
             we only need to tweak inner spacing + the timer size. */
          .bb-shell { bottom: 12px; padding: 12px 14px 10px; }
          .bb-time { font-size: 22px; }
          .bb-pacing { grid-column: 1 / -1; }
        }

        @media (prefers-reduced-motion: reduce) {
          .bb-status-dot.rec, .bb-nudge, .bb-tag-flash {
            animation: none !important;
          }
        }
      `}</style>

      <div className="bb-shell" role="status" aria-live="polite">
        <div className="bb-grid">
          {/* ===== Cell: timer + status ===== */}
          <div className="bb-timer">
            <span className={`bb-status-dot ${status.dotClass}`} aria-hidden="true" />
            {isLive ? (
              <span className="bb-time">{fmt(elapsedMs)}</span>
            ) : (
              <span className="bb-status-text">{status.text}</span>
            )}
          </div>

          {/* ===== Cell: transcript tape (or hint when idle) ===== */}
          <div className={`bb-tape ${!isLive && state !== "starting" ? "is-hint" : ""}`}>
            {isLive ? (
              recentSpoken ? (
                <em>&ldquo;{recentSpoken}&rdquo;</em>
              ) : (
                <span style={{ color: "var(--color-muted-ash)" }}>Listening…</span>
              )
            ) : state === "starting" ? (
              <span style={{ color: "var(--color-muted-ash)" }}>Asking for the microphone…</span>
            ) : state === "uploading" ? (
              <span>Uploading your recording…</span>
            ) : state === "stopping" ? (
              <span>Wrapping up…</span>
            ) : state === "error" ? (
              <span className="bb-error">{errorMsg ?? "Something went wrong."}</span>
            ) : (
              <span>Press start when you&rsquo;re ready. We&rsquo;ll listen and time you.</span>
            )}
          </div>

          {/* ===== Cell: controls ===== */}
          <div className="bb-controls">
            {state === "idle" && (
              <button onClick={onStart} className="bb-btn bb-btn-primary">
                <svg className="bb-btn-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" /></svg>
                Start recording
              </button>
            )}
            {state === "starting" && (
              <button className="bb-btn bb-btn-primary" disabled>Starting…</button>
            )}
            {state === "recording" && (
              <>
                <button onClick={onStop} className="bb-btn bb-btn-stop">
                  <svg className="bb-btn-icon" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                  Stop
                </button>
                <button onClick={onPause} className="bb-btn bb-btn-ghost" title="Pause">Pause</button>
              </>
            )}
            {state === "paused" && (
              <>
                <button onClick={onResume} className="bb-btn bb-btn-primary">Resume</button>
                <button onClick={onStop} className="bb-btn bb-btn-ghost" style={{ color: "var(--color-leadgen-red)" }}>
                  Stop
                </button>
              </>
            )}
            {state === "stopping" && (
              <button className="bb-btn bb-btn-stop" disabled>Stopping…</button>
            )}
            {state === "uploading" && (
              <button className="bb-btn bb-btn-primary" disabled>Uploading…</button>
            )}
            {state === "error" && (
              <button onClick={onRetry} className="bb-btn bb-btn-primary">Try again</button>
            )}
          </div>

          {/* ===== Row 2: pacing ===== */}
          <div className={`bb-pacing ${!isLive ? "is-idle" : ""}`}>
            <span className="bb-pacing-label">
              <strong>{currentSectionName || "—"}</strong>
            </span>
            <div className="bb-pacing-bar">
              <span
                style={{
                  width: `${isLive ? sectionPct : 0}%`,
                  background: barColor,
                }}
              />
            </div>
            <span
              className={`bb-pacing-num ${
                isLive && overTarget ? "is-over" : isLive && nearTarget ? "is-warn" : ""
              }`}
            >
              {fmt(currentSectionElapsedMs)} / {fmt(currentSectionTargetMs)}
            </span>
          </div>

          {/* ===== Row 2: aside (nudges / tag hints) ===== */}
          <div className="bb-aside">
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
            ) : isLive ? (
              <div className="bb-keys" aria-hidden="true">
                {KEY_HINTS.map((h) => (
                  <span key={h.key} className="bb-key">
                    <kbd>{h.key}</kbd>
                    {h.label}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 11, color: "var(--color-muted-ash)", letterSpacing: "0.04em" }}>
                {/* Empty in idle — keeps the row visually balanced without extra noise. */}
                &nbsp;
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
