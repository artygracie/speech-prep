"use client";

// Live recording mockup. Same behaviour as the static demo's hero animation:
// pulsing rec-dot, animated waveform, transcript that types in word-by-word.
// We restart the typing once it reaches the end so the page never sits frozen.

import { useEffect, useRef, useState } from "react";

type Token = { text: string; kind?: "said" | "paraphrase" | "improv" | "skip" };

const TOKENS: Token[] = [
  { text: "Sarah and I met on a Tuesday in October. ", kind: "said" },
  { text: "It was raining sideways. ", kind: "paraphrase" },
  { text: "She laughed. I was a goner. ", kind: "said" },
];

export function LiveTranscript() {
  const [elapsed, setElapsed] = useState(0);
  const [rendered, setRendered] = useState<string>("");
  const tokenIdx = useRef(0);
  const wordIdx = useRef(0);
  const reduceMotion = useRef(false);

  useEffect(() => {
    reduceMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const timer = setInterval(() => {
      setElapsed((s) => (s >= 132 ? 0 : s + 1));
    }, 1000);

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function step() {
      if (cancelled) return;
      const tok = TOKENS[tokenIdx.current];
      if (!tok) {
        // Reached end — pause and loop.
        timeoutId = setTimeout(() => {
          tokenIdx.current = 0;
          wordIdx.current = 0;
          setRendered("");
          step();
        }, 2400);
        return;
      }
      const words = tok.text.split(/(\s+)/);
      if (wordIdx.current >= words.length) {
        tokenIdx.current += 1;
        wordIdx.current = 0;
        timeoutId = setTimeout(step, 320);
        return;
      }
      const next = words[wordIdx.current];
      wordIdx.current += 1;
      setRendered((r) => r + next);
      const isSpace = /^\s+$/.test(next);
      timeoutId = setTimeout(step, reduceMotion.current ? 0 : isSpace ? 40 : 110);
    }
    timeoutId = setTimeout(step, 600);

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <>
      <style>{`
        .lt-rec-dot {
          width: 8px; height: 8px; border-radius: 999px;
          background: var(--color-leadgen-red); display: inline-block;
          box-shadow: 0 0 0 0 rgba(225, 101, 64, 0.55);
          animation: lt-rec-pulse 1.4s ease-out infinite;
        }
        @keyframes lt-rec-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(225, 101, 64, 0.5); }
          70%  { box-shadow: 0 0 0 9px rgba(225, 101, 64, 0); }
          100% { box-shadow: 0 0 0 0 rgba(225, 101, 64, 0); }
        }
        .lt-wave { display: flex; align-items: center; gap: 3px; height: 56px; padding: 0 2px; }
        .lt-wave > i {
          flex: 1; display: block;
          background: var(--color-midnight-ink);
          border-radius: 3px; opacity: 0.85; height: 14%;
          animation: lt-wave-bar 1.1s ease-in-out infinite;
          will-change: transform; transform-origin: center;
        }
        @keyframes lt-wave-bar {
          0%, 100% { transform: scaleY(0.18); }
          50%      { transform: scaleY(1);    }
        }
        .lt-floating {
          background: var(--color-canvas-white);
          border-radius: 16px;
          box-shadow: var(--shadow-xl);
        }
        .lt-transcript {
          font-family: var(--font-script);
          font-size: 18px; line-height: 1.55;
          color: var(--color-midnight-ink);
          min-height: 56px;
        }
        .lt-cursor {
          display: inline-block; width: 2px; height: 1.05em;
          background: var(--color-midnight-ink); vertical-align: -0.15em;
          margin-left: 2px; animation: lt-caret 1s steps(1) infinite;
        }
        @keyframes lt-caret { 50% { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .lt-rec-dot, .lt-wave > i, .lt-cursor { animation: none !important; }
        }
      `}</style>
      <div className="mt-16 md:mt-20 max-w-2xl lt-floating p-7 md:p-9">
        <div className="flex items-center justify-between mb-7">
          <div className="flex items-center gap-2.5">
            <span className="lt-rec-dot" aria-hidden="true" />
            <span className="text-caption" style={{ color: "var(--color-leadgen-red)" }}>
              Recording
            </span>
            <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
              &middot; The road trip
            </span>
          </div>
          <span
            className="text-body-sm num"
            style={{
              color: "var(--color-muted-ash)",
              letterSpacing: "0.04em",
            }}
          >
            {mm}:{ss}
          </span>
        </div>

        <div className="lt-wave" aria-hidden="true">
          {Array.from({ length: 50 }).map((_, i) => (
            <i
              key={i}
              style={{
                animationDelay: `-${(i * 0.07) % 1.1}s`,
                animationDuration: `${0.85 + ((i * 13) % 50) / 100}s`,
              }}
            />
          ))}
        </div>

        <div className="mt-7">
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
              Live transcript
            </span>
            <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
              <span className="num">142</span> wpm
            </span>
          </div>
          <p className="lt-transcript">
            {rendered}
            <span className="lt-cursor" />
          </p>
        </div>
      </div>
    </>
  );
}
