"use client";

// MemoryCheckPanel — From-memory mode hero panel.
//
// Renders per-section recall scoring as a stack of horizontal bars:
//
//   Opener      ████████░  Word-perfect (97%)
//   Story       ██████░░░  Mostly there — 3 paraphrases
//   Crisis      ███░░░░░░  Rough — you blanked at "Margaret"
//   Close       █████████  Word-perfect (100%)
//
//                                   [ Drill weak sections → ]
//
// The score per section is derived from the same DiffRow[] data that
// powers the diff view; nothing new is computed server-side. This is
// the hero element of the From-memory mode session report — it answers
// "did I have this memorized?" at a glance.
//
// Bands:
//   word-perfect   → ≥95% recall   → green
//   mostly there   → 80–95%        → indigo
//   rough          → 50–80%        → gold
//   blank          → <50%          → red
//
// "Drill weak sections" navigates to the recorder targeting the first
// rough/blank section. Future: pass multiple section ids so the
// recorder cycles through them.

import Link from "next/link";

export type MemoryCheckSection = {
  id: string;
  name: string;
  recall: number;          // 0..1
  band: "word-perfect" | "mostly-there" | "rough" | "blank" | "not-reached";
  paraphraseCount: number;
  skippedCount: number;
  // optional: a representative word the speaker blanked on, for prose
  blankedAt?: string;
};

export function MemoryCheckPanel({
  speechId,
  sections,
}: {
  speechId: string;
  sections: MemoryCheckSection[];
}) {
  const weak = sections.filter(
    (s) => s.band === "rough" || s.band === "blank",
  );
  // The "drill weak sections" link can target one section per click.
  // Pick the worst-scoring one — the user can come back for the next
  // after that drill.
  const firstWeak = weak.sort((a, b) => a.recall - b.recall)[0];

  return (
    <section className="mt-10">
      <style>{`
        .mem-check {
          background: var(--color-canvas-white);
          border: 1px solid rgba(17,17,17,0.08);
          border-radius: 12px;
          padding: 28px 32px;
          max-width: 760px;
        }
        @media (max-width: 720px) {
          .mem-check { padding: 22px 20px; }
        }
        .mem-check-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--color-midnight-ink);
          margin-bottom: 18px;
        }
        .mem-row {
          display: grid;
          grid-template-columns: 100px 1fr auto;
          gap: 16px;
          align-items: center;
          padding: 8px 0;
        }
        @media (max-width: 720px) {
          .mem-row { grid-template-columns: 1fr; gap: 6px; padding: 10px 0; }
        }
        .mem-row + .mem-row { border-top: 1px solid rgba(17,17,17,0.04); }
        .mem-name {
          font-size: 13px;
          font-weight: 500;
          color: var(--color-midnight-ink);
        }
        .mem-bar-track {
          position: relative;
          height: 10px;
          background: rgba(17,17,17,0.05);
          border-radius: 999px;
        }
        .mem-bar-fill {
          position: absolute;
          inset: 0 auto 0 0;
          border-radius: 999px;
          transition: width 400ms ease-out;
        }
        .mem-bar-fill.word-perfect {
          background: var(--color-deliver-green, #2f9c70);
        }
        .mem-bar-fill.mostly-there {
          background: var(--color-deep-indigo, #3a5fb1);
        }
        .mem-bar-fill.rough {
          background: var(--color-engagement-gold, #c99a4a);
        }
        .mem-bar-fill.blank {
          background: var(--color-leadgen-red, #e16540);
        }
        .mem-bar-fill.not-reached {
          background: rgba(17,17,17,0.18);
        }
        .mem-status {
          font-size: 12.5px;
          color: var(--color-muted-ash);
          font-family: var(--font-sans);
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .mem-status strong {
          color: var(--color-midnight-ink);
          font-weight: 500;
        }
        .mem-cta-row {
          margin-top: 24px;
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          flex-wrap: wrap;
        }
        .mem-empty-state {
          text-align: center;
          color: var(--color-muted-ash);
          font-size: 14px;
          padding: 16px 0 4px;
        }
      `}</style>

      <div className="mem-check">
        <div className="mem-check-label">Memory check</div>

        {sections.length === 0 ? (
          <div className="mem-empty-state">
            We&rsquo;ll score your recall once the transcript lands.
          </div>
        ) : sections.every((s) => s.band === "word-perfect") ? (
          <p
            className="text-body"
            style={{
              fontFamily: "var(--font-script)",
              fontSize: 17,
              lineHeight: 1.6,
              color: "var(--color-midnight-ink)",
              margin: 0,
            }}
          >
            You&rsquo;ve got this speech locked in.
          </p>
        ) : (
          <>
            {sections.map((s) => {
              const pct = Math.round(s.recall * 100);
              const status = bandLabel(s, pct);
              return (
                <div key={s.id} className="mem-row" aria-label={`${s.name}: ${status}`}>
                  <div className="mem-name">{s.name}</div>
                  <div className="mem-bar-track">
                    <div
                      className={`mem-bar-fill ${s.band}`}
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                  <div className="mem-status">{status}</div>
                </div>
              );
            })}
            {firstWeak && (
              <div className="mem-cta-row">
                <Link
                  href={`/app/speeches/${speechId}/record?section=${firstWeak.id}&drilling=1`}
                  className="btn-primary"
                  style={{ padding: "11px 20px", fontSize: 14 }}
                >
                  Drill weak sections →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function bandLabel(s: MemoryCheckSection, pct: number): React.ReactNode {
  switch (s.band) {
    case "word-perfect":
      return (
        <>
          <strong>Word-perfect</strong> ({pct}%)
        </>
      );
    case "mostly-there": {
      const noun = s.paraphraseCount === 1 ? "paraphrase" : "paraphrases";
      return (
        <>
          <strong>Mostly there</strong> — {s.paraphraseCount} {noun}
        </>
      );
    }
    case "rough": {
      if (s.blankedAt) {
        return (
          <>
            <strong>Rough</strong> — you blanked at &ldquo;{s.blankedAt}&rdquo;
          </>
        );
      }
      const noun = s.paraphraseCount === 1 ? "paraphrase" : "paraphrases";
      return (
        <>
          <strong>Rough</strong> — {s.paraphraseCount} {noun}, {s.skippedCount} skipped
        </>
      );
    }
    case "blank":
      return (
        <>
          <strong>Blank</strong> — try again from the top
        </>
      );
    case "not-reached":
      return <>Not reached</>;
  }
}
