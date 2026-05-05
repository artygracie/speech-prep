"use client";

// CoachMarginNote — the coach's voice as a marginal annotation,
// not a panel.
//
// Sits above the manuscript. Renders the headline pull-quote with a
// small "Coach" attribution. The supporting summary prose is hidden
// behind a "Read more" disclosure for users who want it.
//
// This replaces the old CoachCard's headline + summary block — same
// data, treated as marginalia rather than a stacked card.

import { useState } from "react";

export function CoachMarginNote({
  headline,
  summary,
  date,
}: {
  headline: string;
  summary: string;
  date: string; // pre-formatted, e.g. "5/5/26"
}) {
  const [expanded, setExpanded] = useState(false);
  if (!headline && !summary) return null;

  return (
    <>
      <style>{`
        .cmn {
          max-width: 720px;
          padding: 18px 22px;
          margin: 4px 0 0;
          border-left: 3px solid var(--color-engagement-gold, #c99a4a);
          background: rgba(201,154,74,0.04);
          border-radius: 0 8px 8px 0;
        }
        .cmn-headline {
          font-family: var(--font-script);
          font-size: 24px;
          font-weight: 500;
          line-height: 1.28;
          letter-spacing: -0.012em;
          color: var(--color-midnight-ink);
          margin: 0;
        }
        .cmn-meta {
          margin-top: 10px;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--color-muted-ash);
        }
        .cmn-toggle {
          appearance: none;
          background: transparent;
          border: 0;
          padding: 0;
          margin-left: 10px;
          font-size: 11px;
          letter-spacing: 0.04em;
          color: var(--color-muted-ash);
          cursor: pointer;
          text-decoration: underline;
          text-decoration-color: rgba(17,17,17,0.18);
          text-underline-offset: 3px;
          text-transform: none;
        }
        .cmn-toggle:hover { color: var(--color-midnight-ink); }
        .cmn-summary {
          margin-top: 12px;
          font-family: var(--font-script);
          font-size: 15.5px;
          line-height: 1.6;
          color: rgba(17,17,17,0.78);
        }
      `}</style>
      <aside className="cmn" aria-label="Coach note">
        {headline && <p className="cmn-headline">{headline}</p>}
        <div className="cmn-meta">
          Coach · {date}
          {summary && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="cmn-toggle"
              aria-expanded={expanded}
            >
              {expanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>
        {expanded && summary && <p className="cmn-summary">{summary}</p>}
      </aside>
    </>
  );
}
