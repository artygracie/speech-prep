"use client";

// Hero preview. Shows the whole loop in one frame:
//
//   left  — the script the speaker wrote (highlights as we go: green
//           on match, gold on paraphrase, struck-through on skip)
//   right — the recording rolling: timer, transcript typing in word-
//           by-word, then a one-line coach note
//   bottom — three counter chips that tick up as the demo plays
//
// Drives off a small step machine; restarts the whole loop after each
// run so the page never sits frozen.

import { useEffect, useMemo, useRef, useState } from "react";

// ============================================================
// Demo content
// ============================================================

// One row in the script panel on the left.
type ScriptLine = {
  id: string;
  text: string;
  // Which step number flips this line into its highlighted state.
  highlightAt: number;
  // What state the line takes once highlighted.
  outcome: "match" | "paraphrase" | "skipped";
  // For paraphrases, the spoken alternative. Used in the inline note
  // beneath the line.
  paraphrasedTo?: string;
};

const SCRIPT: ScriptLine[] = [
  {
    id: "l1",
    text: "Sarah and I met on a Tuesday in October.",
    highlightAt: 1,
    outcome: "match",
  },
  {
    id: "l2",
    text: "It was pouring rain.",
    highlightAt: 2,
    outcome: "paraphrase",
    paraphrasedTo: "It was raining sideways.",
  },
  {
    id: "l3",
    text: "Neither of us had an umbrella.",
    highlightAt: 3,
    outcome: "skipped",
  },
  {
    id: "l4",
    text: "She laughed. I was a goner.",
    highlightAt: 5,
    outcome: "match",
  },
];

// Each "step" types one chunk into the right-hand transcript. Chunks are
// small so the typing reads as natural speech. After step 4 we surface an
// improv line that has no script counterpart.
type Step = {
  text: string;
  kind: "match" | "paraphrase" | "improv";
  // Pause AFTER this step finishes typing, in ms.
  trailingPause: number;
};

const STEPS: Step[] = [
  { text: "Sarah and I met on a Tuesday in October. ", kind: "match", trailingPause: 380 },
  { text: "It was raining sideways. ", kind: "paraphrase", trailingPause: 600 },
  // Step 3: a deliberate "..." pause stands in for the skipped line.
  { text: "", kind: "match", trailingPause: 700 },
  { text: "And honestly? I think that's when I knew. ", kind: "improv", trailingPause: 380 },
  { text: "She laughed. I was a goner.", kind: "match", trailingPause: 1500 },
];

// Coach note appears at the very end, in one fade-in.
const COACH_NOTE =
  "The road-trip section is running 32 seconds long. Cut the umbrella line — keep the ad-lib.";

// Restart pause after the whole loop completes.
const LOOP_REST_MS = 2400;
const WORD_MS_LETTER = 75;
const WORD_MS_SPACE = 35;

// ============================================================
// Component
// ============================================================

export function LiveTranscript() {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [step, setStep] = useState(0);            // 0 = idle, 1..N = which step started
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptKindAtIdx, setTranscriptKindAtIdx] = useState<("match" | "paraphrase" | "improv")[]>([]);
  const [coachVisible, setCoachVisible] = useState(false);
  const reduceMotion = useRef(false);

  useEffect(() => {
    reduceMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stepTimeout: ReturnType<typeof setTimeout> | null = null;

    function startTimer(reset = false) {
      if (timer) clearInterval(timer);
      if (reset) setElapsedMs(0);
      const startedAt = Date.now() - (reset ? 0 : elapsedMs);
      timer = setInterval(() => {
        if (cancelled) return;
        setElapsedMs(Date.now() - startedAt);
      }, 200);
    }

    async function typeChunk(chunk: string, kind: Step["kind"]): Promise<void> {
      // Word-by-word append. Spaces flush fast; letters take a beat.
      const words = chunk.split(/(\s+)/);
      for (const w of words) {
        if (cancelled) return;
        if (!w) continue;
        // Append in one shot; tag every char with this kind so we can
        // colour mid-line transitions correctly.
        setTranscriptText((prev) => prev + w);
        setTranscriptKindAtIdx((prev) => {
          const next = prev.slice();
          for (let i = 0; i < w.length; i++) next.push(kind);
          return next;
        });
        const isSpace = /^\s+$/.test(w);
        await wait(reduceMotion.current ? 0 : isSpace ? WORD_MS_SPACE : WORD_MS_LETTER * w.length);
      }
    }

    function wait(ms: number) {
      return new Promise<void>((resolve) => {
        stepTimeout = setTimeout(resolve, ms);
      });
    }

    async function runLoop() {
      // Reset.
      setStep(0);
      setTranscriptText("");
      setTranscriptKindAtIdx([]);
      setCoachVisible(false);
      startTimer(true);

      // Small lead-in pause.
      await wait(reduceMotion.current ? 0 : 600);

      for (let i = 0; i < STEPS.length; i++) {
        if (cancelled) return;
        setStep(i + 1);
        const s = STEPS[i];
        if (s.text) {
          await typeChunk(s.text, s.kind);
        }
        await wait(reduceMotion.current ? 0 : s.trailingPause);
      }

      // Coach note.
      if (!cancelled) setCoachVisible(true);
      await wait(reduceMotion.current ? 0 : LOOP_REST_MS);

      if (!cancelled) {
        if (timer) { clearInterval(timer); timer = null; }
        runLoop();
      }
    }

    runLoop();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (stepTimeout) clearTimeout(stepTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mm = String(Math.floor(elapsedMs / 60000)).padStart(2, "0");
  const ss = String(Math.floor((elapsedMs / 1000) % 60)).padStart(2, "0");

  // Counters tick as outcomes resolve.
  const counts = useMemo(() => {
    let matched = 0,
      paraphrased = 0,
      skipped = 0,
      improv = 0;
    for (const line of SCRIPT) {
      if (step >= line.highlightAt) {
        if (line.outcome === "match") matched++;
        else if (line.outcome === "paraphrase") paraphrased++;
        else if (line.outcome === "skipped") skipped++;
      }
    }
    if (step >= 4) improv = 1;
    return { matched, paraphrased, skipped, improv };
  }, [step]);

  return (
    <>
      <style>{`
        .preview-card {
          background: var(--color-canvas-white);
          border-radius: 18px;
          box-shadow: var(--shadow-xl);
          overflow: hidden;
        }
        .preview-grid {
          display: grid;
          grid-template-columns: 1.05fr 1fr;
          min-height: 0;
        }
        @media (max-width: 760px) { .preview-grid { grid-template-columns: 1fr; } }

        .preview-pane {
          padding: 24px 26px;
          min-width: 0;
        }
        .preview-pane + .preview-pane {
          border-left: 1px solid rgba(17,17,17,0.06);
        }
        @media (max-width: 760px) {
          .preview-pane + .preview-pane { border-left: 0; border-top: 1px solid rgba(17,17,17,0.06); }
        }

        .preview-label {
          display: flex; align-items: baseline; justify-content: space-between;
          margin-bottom: 14px;
        }

        .preview-label-text {
          font-size: 11px;
          line-height: 1.3;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          font-weight: 500;
          color: var(--color-muted-ash);
        }

        /* ===== LEFT: script ===== */
        .preview-script-section {
          font-family: 'Iowan Old Style', 'Charter', Georgia, serif;
          font-size: 15.5px;
          line-height: 1.65;
        }
        .preview-script-line {
          display: block;
          padding: 4px 8px;
          border-radius: 4px;
          margin-left: -8px;
          transition: background-color 360ms ease, color 360ms ease, opacity 360ms ease, text-decoration-color 360ms ease;
        }
        .pl-pending { color: rgba(17,17,17,0.42); }
        .pl-match {
          background: rgba(71,208,150,0.14);
          color: var(--color-midnight-ink);
        }
        .pl-paraphrase {
          background: rgba(251,199,104,0.18);
          color: #4a3508;
          text-decoration: underline;
          text-decoration-style: wavy;
          text-decoration-color: var(--color-engagement-gold);
          text-underline-offset: 4px;
          text-decoration-thickness: 1.5px;
        }
        .pl-skipped {
          color: rgba(17,17,17,0.32);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.6);
          text-decoration-thickness: 1.5px;
        }
        .pl-paraphrase-note {
          display: block;
          margin: 4px 0 0 0;
          font-size: 12px;
          font-style: italic;
          color: var(--color-muted-ash);
          opacity: 0;
          animation: pl-fadein 320ms ease forwards;
          animation-delay: 200ms;
        }
        @keyframes pl-fadein { to { opacity: 1; } }

        .preview-improv-pill {
          display: inline-block;
          margin-left: 8px;
          padding: 1px 7px;
          border-radius: 999px;
          font-size: 10px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-weight: 500;
          background: rgba(50,142,250,0.14);
          color: var(--color-deep-indigo);
          opacity: 0;
          animation: pl-fadein 320ms ease forwards;
        }

        /* ===== RIGHT: recording ===== */
        .preview-rec-dot {
          width: 7px; height: 7px; border-radius: 999px;
          background: var(--color-leadgen-red); display: inline-block;
          box-shadow: 0 0 0 0 rgba(225, 101, 64, 0.55);
          animation: preview-pulse 1.4s ease-out infinite;
        }
        @keyframes preview-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(225, 101, 64, 0.5); }
          70%  { box-shadow: 0 0 0 7px rgba(225, 101, 64, 0); }
          100% { box-shadow: 0 0 0 0 rgba(225, 101, 64, 0); }
        }

        .preview-transcript {
          font-family: 'Iowan Old Style', 'Charter', Georgia, serif;
          font-size: 16.5px;
          line-height: 1.55;
          color: var(--color-midnight-ink);
          min-height: 100px;
        }
        .preview-transcript .seg-paraphrase { color: #6b4f12; background: rgba(251,199,104,0.16); padding: 0 2px; border-radius: 2px; }
        .preview-transcript .seg-improv { color: var(--color-deep-indigo); background: rgba(50,142,250,0.10); padding: 0 2px; border-radius: 2px; font-style: italic; }

        .preview-cursor {
          display: inline-block; width: 2px; height: 1.0em;
          background: var(--color-midnight-ink); vertical-align: -0.12em;
          margin-left: 2px; animation: preview-caret 1s steps(1) infinite;
        }
        @keyframes preview-caret { 50% { opacity: 0; } }

        .preview-coach {
          display: flex; gap: 10px;
          padding: 12px 14px;
          background: var(--color-whisper-gray);
          border-radius: 10px;
          font-size: 13px;
          line-height: 1.5;
          color: var(--color-midnight-ink);
          opacity: 0;
          transform: translateY(4px);
          transition: opacity 360ms ease, transform 360ms ease;
        }
        .preview-coach.is-on { opacity: 1; transform: translateY(0); }
        .preview-coach-tag {
          flex-shrink: 0;
          font-size: 10px; font-weight: 500;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--color-muted-ash);
          padding-top: 1px;
        }

        /* ===== Footer counters ===== */
        .preview-footer {
          display: flex; align-items: center; gap: 8px;
          padding: 14px 26px;
          border-top: 1px solid rgba(17,17,17,0.06);
          background: rgba(17,17,17,0.015);
          flex-wrap: wrap;
        }
        .preview-chip {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.06em; text-transform: uppercase;
          padding: 4px 10px; border-radius: 999px;
          background: rgba(17,17,17,0.04);
          color: var(--color-midnight-ink);
          font-variant-numeric: tabular-nums;
          transition: background-color 240ms ease;
        }
        .preview-chip > .chip-dot {
          width: 6px; height: 6px; border-radius: 999px;
        }
        .chip-on-mint { background: rgba(71,208,150,0.16); }
        .chip-on-mint .chip-dot { background: var(--color-deliver-green); }
        .chip-on-gold { background: rgba(251,199,104,0.22); }
        .chip-on-gold .chip-dot { background: var(--color-engagement-gold); }
        .chip-on-red { background: rgba(225,101,64,0.14); color: #88321a; }
        .chip-on-red .chip-dot { background: var(--color-leadgen-red); }
        .chip-on-blue { background: rgba(50,142,250,0.14); color: var(--color-deep-indigo); }
        .chip-on-blue .chip-dot { background: var(--color-intelligence-blue); }
        .chip-off .chip-dot { background: rgba(17,17,17,0.18); }

        @media (prefers-reduced-motion: reduce) {
          .preview-rec-dot, .preview-cursor { animation: none !important; }
          .preview-script-line, .preview-paraphrase-note, .preview-coach { transition: none !important; }
        }
      `}</style>

      <div className="mt-16 md:mt-20 max-w-3xl preview-card">
        <div className="preview-grid">
          {/* ===== LEFT: script panel ===== */}
          <div className="preview-pane">
            <div className="preview-label">
              <span className="preview-label-text">Script · The road trip</span>
              <span className="preview-label-text">Target 01:00</span>
            </div>
            <div className="preview-script-section">
              {SCRIPT.map((line) => {
                const reached = step >= line.highlightAt;
                const cls = !reached
                  ? "preview-script-line pl-pending"
                  : line.outcome === "match"
                  ? "preview-script-line pl-match"
                  : line.outcome === "paraphrase"
                  ? "preview-script-line pl-paraphrase"
                  : "preview-script-line pl-skipped";
                return (
                  <span key={line.id}>
                    <span className={cls}>
                      {line.text}
                      {/* The improv pill is anchored after the paraphrased
                          line's note so it visually follows the moment the
                          ad-lib was captured. */}
                      {line.id === "l3" && step >= 4 && (
                        <span className="preview-improv-pill">+ ad-lib</span>
                      )}
                    </span>
                    {/* Inline paraphrase note slips in once the line is
                        highlighted as a paraphrase. */}
                    {reached && line.outcome === "paraphrase" && line.paraphrasedTo && (
                      <span className="pl-paraphrase-note">
                        spoken: &ldquo;{line.paraphrasedTo}&rdquo;
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>

          {/* ===== RIGHT: live recording ===== */}
          <div className="preview-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="preview-label" style={{ marginBottom: 0 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="preview-rec-dot" aria-hidden="true" />
                <span className="preview-label-text" style={{ color: "var(--color-leadgen-red)" }}>
                  Recording
                </span>
              </span>
              <span className="preview-label-text num" style={{ letterSpacing: "0.04em" }}>
                {mm}:{ss}
              </span>
            </div>

            <div>
              <div className="preview-label" style={{ marginBottom: 8 }}>
                <span className="preview-label-text">Live transcript</span>
                <span className="preview-label-text num">142 wpm</span>
              </div>
              <p className="preview-transcript">
                {/* Render each char tagged with its kind so cross-line
                    highlighting reads correctly. */}
                {renderColoredText(transcriptText, transcriptKindAtIdx)}
                <span className="preview-cursor" />
              </p>
            </div>

            <div>
              <div className="preview-label" style={{ marginBottom: 8 }}>
                <span className="preview-label-text">Coach</span>
              </div>
              <div className={`preview-coach ${coachVisible ? "is-on" : ""}`}>
                <span>{COACH_NOTE}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ===== Footer counters ===== */}
        <div className="preview-footer">
          <span className={`preview-chip ${counts.matched > 0 ? "chip-on-mint" : "chip-off"}`}>
            <span className="chip-dot" />
            {counts.matched} matched
          </span>
          <span className={`preview-chip ${counts.paraphrased > 0 ? "chip-on-gold" : "chip-off"}`}>
            <span className="chip-dot" />
            {counts.paraphrased} paraphrased
          </span>
          <span className={`preview-chip ${counts.skipped > 0 ? "chip-on-red" : "chip-off"}`}>
            <span className="chip-dot" />
            {counts.skipped} skipped
          </span>
          <span className={`preview-chip ${counts.improv > 0 ? "chip-on-blue" : "chip-off"}`}>
            <span className="chip-dot" />
            {counts.improv} ad-lib
          </span>
        </div>
      </div>
    </>
  );
}

// Render the transcript with per-character colour. Walks both arrays in
// lockstep, batching contiguous runs with the same `kind` into a single
// span so we don't blow the DOM up.
function renderColoredText(text: string, kinds: ("match" | "paraphrase" | "improv")[]) {
  if (!text) return null;
  const out: React.ReactNode[] = [];
  let runStart = 0;
  let runKind = kinds[0] ?? "match";
  for (let i = 1; i <= text.length; i++) {
    const k = kinds[i] ?? runKind;
    if (k !== runKind || i === text.length) {
      const slice = text.slice(runStart, i);
      const cls =
        runKind === "paraphrase"
          ? "seg-paraphrase"
          : runKind === "improv"
          ? "seg-improv"
          : "";
      out.push(
        cls ? (
          <span key={`${runStart}`} className={cls}>
            {slice}
          </span>
        ) : (
          <span key={`${runStart}`}>{slice}</span>
        ),
      );
      runStart = i;
      runKind = k;
    }
  }
  return out;
}
