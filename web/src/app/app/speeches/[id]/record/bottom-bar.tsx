"use client";

// The bottom bar — a sticky two-line dashboard that sits over the
// page while recording. It shows the things the speaker should know
// while talking:
//
//   Top line:   timer (large) · live transcript window (last 8 words)
//   Bottom row: per-section pacing bar · pacing nudge · tag-key reminders
//                                          (controls live in sidebar)
//
// The bar appears only when state is recording or paused. It animates
// up from the bottom when recording starts.

import { useEffect, useRef, useState } from "react";

type Tag = { kind: "landed" | "flat" | "lost" | "callback"; atMs: number };
export type BottomBarNudge = {
  kind: "over-target" | "fast" | "slow" | "skipped";
  message: string;
  // Auto-dismiss after this long. null = persists until the underlying
  // condition no longer holds (caller controls).
  ttlMs?: number;
} | null;

type Props = {
  visible: boolean;
  paused: boolean;
  elapsedMs: number;
  recentSpoken: string;
  currentSectionName: string;
  currentSectionElapsedMs: number;
  currentSectionTargetMs: number;
  nudge: BottomBarNudge;
  recentTags: Tag[];
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
  visible,
  paused,
  elapsedMs,
  recentSpoken,
  currentSectionName,
  currentSectionElapsedMs,
  currentSectionTargetMs,
  nudge,
  recentTags,
}: Props) {
  const [tagFlash, setTagFlash] = useState<Tag | null>(null);
  const lastTagSeenRef = useRef<number>(0);

  // When a new tag arrives, flash it briefly.
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

  return (
    <>
      <style>{`
        .bb-shell {
          position: fixed;
          left: 50%;
          bottom: 24px;
          transform: translate(-50%, ${visible ? "0" : "calc(100% + 32px)"});
          width: min(calc(100vw - 32px), 980px);
          z-index: 60;
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: saturate(180%) blur(20px);
          -webkit-backdrop-filter: saturate(180%) blur(20px);
          border: 1px solid rgba(17,17,17,0.06);
          border-radius: 16px;
          box-shadow: 0 12px 36px rgba(17,17,17,0.10), 0 1px 0 rgba(255,255,255,0.6) inset;
          transition: transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 240ms ease;
          opacity: ${visible ? 1 : 0};
          padding: 14px 18px 12px;
        }
        .bb-row1 {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 18px;
          align-items: center;
          min-width: 0;
        }
        .bb-timer {
          display: flex; align-items: center; gap: 10px;
          font-variant-numeric: tabular-nums;
        }
        .bb-rec-dot {
          width: 8px; height: 8px; border-radius: 999px;
          background: ${paused ? "var(--color-engagement-gold)" : "var(--color-leadgen-red)"};
          box-shadow: 0 0 0 0 ${paused ? "transparent" : "rgba(225, 101, 64, 0.55)"};
          animation: ${paused ? "none" : "bb-pulse 1.4s ease-out infinite"};
        }
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
        }
        .bb-tape {
          /* Live transcript window: fades on the left so old words
             slide out without a hard cut. */
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
          opacity: 0.8;
          min-width: 0;
        }
        .bb-tape em {
          font-style: italic;
          color: var(--color-deep-indigo);
        }

        .bb-row2 {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 18px;
          align-items: center;
          margin-top: 10px;
          min-height: 28px;
        }
        .bb-pacing { display: flex; align-items: center; gap: 12px; min-width: 0; }
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

        /* Nudge sits on the right side of row 2; replaces tag hints
           when active. */
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

        .bb-keys {
          display: flex; align-items: center; gap: 8px;
          flex-shrink: 0;
        }
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

        /* Tag flash — large pill that briefly takes over the right side */
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

        @media (max-width: 720px) {
          .bb-shell { width: calc(100vw - 16px); bottom: 12px; padding: 10px 12px; }
          .bb-time { font-size: 22px; }
          .bb-tape { display: none; }
          .bb-keys { display: none; }
        }

        @media (prefers-reduced-motion: reduce) {
          .bb-rec-dot, .bb-nudge, .bb-tag-flash {
            animation: none !important;
          }
        }
      `}</style>

      <div className="bb-shell" role="status" aria-live="polite">
        <div className="bb-row1">
          <div className="bb-timer">
            <span className="bb-rec-dot" aria-hidden="true" />
            <span className="bb-time">{fmt(elapsedMs)}</span>
          </div>
          <div className="bb-tape">
            {recentSpoken ? (
              <em>"{recentSpoken}"</em>
            ) : (
              <span style={{ color: "var(--color-muted-ash)" }}>Listening…</span>
            )}
          </div>
        </div>

        <div className="bb-row2">
          <div className="bb-pacing">
            <span className="bb-pacing-label">
              <strong>{currentSectionName || "—"}</strong>
            </span>
            <div className="bb-pacing-bar">
              <span
                style={{
                  width: `${sectionPct}%`,
                  background: barColor,
                }}
              />
            </div>
            <span
              className={`bb-pacing-num ${
                overTarget ? "is-over" : nearTarget ? "is-warn" : ""
              }`}
            >
              {fmt(currentSectionElapsedMs)} / {fmt(currentSectionTargetMs)}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {tagFlash ? (
              <span className={`bb-tag-flash tag-${tagFlash.kind}`}>
                {tagFlash.kind}
              </span>
            ) : nudge ? (
              <span
                className={`bb-nudge ${
                  nudge.kind === "over-target" || nudge.kind === "skipped" ? "" : "is-soft"
                }`}
              >
                {nudge.message}
              </span>
            ) : (
              <div className="bb-keys" aria-hidden="true">
                {KEY_HINTS.map((h) => (
                  <span key={h.key} className="bb-key">
                    <kbd>{h.key}</kbd>
                    {h.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
