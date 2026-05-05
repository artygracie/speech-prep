"use client";

// CoachRail — sticky right-column summary on the session report.
//
// The full coach section lives at the bottom of the page (rich notes,
// staged edits, two-CTA footer). But the user's job-to-be-done is
// "tell me what to fix" — and our long-form report makes them scroll
// past audio + diff + transcript before they hit it.
//
// This rail surfaces the headline coach signal at the top, pinned as
// the user scrolls, so the answer is always one glance away. It is
// intentionally minimal:
//
//   - Coach summary, two lines tops
//   - Up to one suggested edit (the first the coach returned), shown
//     in the same redline language as the diff so it doesn't introduce
//     new visual vocabulary
//   - Primary CTA: "Apply & record →" if there's an edit, "Record again →"
//     otherwise
//   - "Read the full notes ↓" anchor link to the deep coach section
//
// Hidden on mobile (<1100px) — the page is already a single scroll
// column there, so the rail would just push the coach further away.

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { applySuggestionsAndRecord } from "@/app/app/coach-actions";
import { MODE_PRIMARY_CTA, type SessionMode } from "@/lib/modes";

type SuggestedEdit = {
  id: string;
  kind: "cut" | "adopt" | "rephrase" | "drill";
  section_id: string;
  before?: string;
  after?: string;
  reason: string;
  line_target?: string;
  tactic?: string;
};

type Props = {
  speechId: string;
  sessionId: string;
  mode: SessionMode;
  headline: string;
  summary: string;
  topEdit: SuggestedEdit | null;
  sectionNameById: Record<string, string>;
};

export function CoachRail({
  speechId,
  sessionId,
  mode,
  headline,
  summary,
  topEdit,
  sectionNameById,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function applyAndRecord() {
    startTransition(async () => {
      try {
        if (topEdit) {
          await applySuggestionsAndRecord(sessionId, [topEdit.id]);
        } else {
          router.push(`/app/speeches/${speechId}/record`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("NEXT_REDIRECT")) return;
        // Quietly swallow; the full coach section below has the loud
        // error path. The rail is meant to be a tight summary.
      }
    });
  }

  // Mode-aware CTA copy. If a drill is the top edit, the mode default
  // already captures the right verb (Drill again →) for freestyle. For
  // script mode with a drill top edit, "Apply & record" is misleading —
  // we'd be drilling, not applying — so we read the kind directly.
  const ctaLabel = pending
    ? "Working…"
    : topEdit
    ? topEdit.kind === "drill"
      ? "Drill this section →"
      : "Apply & record →"
    : MODE_PRIMARY_CTA[mode];

  return (
    <>
      <style>{`
        .coach-rail {
          position: sticky;
          /* 52px top bar + 16px breathing room */
          top: 68px;
          padding: 22px 22px 20px;
          background: var(--color-canvas-white);
          border: 1px solid rgba(17,17,17,0.08);
          border-radius: 12px;
        }
        .coach-rail-label {
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.12em; text-transform: uppercase;
          color: var(--color-muted-ash);
          margin-bottom: 10px;
        }
        .coach-rail-headline {
          font-family: var(--font-script);
          font-size: 18px;
          font-weight: 500;
          line-height: 1.3;
          letter-spacing: -0.005em;
          color: var(--color-midnight-ink);
          margin: 0 0 10px 0;
          padding-bottom: 8px;
          border-bottom: 1.5px solid rgba(201, 154, 74, 0.45);
        }
        .coach-rail-summary {
          font-family: var(--font-script);
          font-size: 15.5px;
          line-height: 1.55;
          color: var(--color-midnight-ink);
        }
        .coach-rail-edit-meta strong.drill { color: #1a4f88; }
        .coach-rail-redline.drill {
          color: var(--color-midnight-ink);
          padding-left: 10px;
          border-left: 3px solid rgba(26, 79, 136, 0.4);
        }
        .coach-rail-divider {
          margin: 18px 0 16px;
          height: 1px;
          background: rgba(17,17,17,0.06);
        }
        .coach-rail-edit-meta {
          display: flex; align-items: baseline; gap: 8px;
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.1em; text-transform: uppercase;
          color: var(--color-muted-ash);
          margin-bottom: 8px;
        }
        .coach-rail-edit-meta strong { font-weight: 500; }
        .coach-rail-edit-meta strong.cut { color: #88321a; }
        .coach-rail-edit-meta strong.adopt { color: var(--color-deep-indigo); }
        .coach-rail-edit-meta strong.rephrase { color: #5a4310; }

        /* Same redline language as the diff view above — a "cut" looks
           identical to a skipped line in the diff; an "adopt" matches
           an ad-lib; a "rephrase" matches a paraphrase. */
        .coach-rail-redline {
          font-family: var(--font-script);
          font-size: 14.5px;
          line-height: 1.55;
          margin: 0;
        }
        .coach-rail-redline.cut {
          color: rgba(17,17,17,0.45);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
        }
        .coach-rail-redline.adopt {
          color: var(--color-deep-indigo);
          font-style: italic;
          background: rgba(50,142,250,0.08);
          border-radius: 4px;
          padding: 1px 6px;
          display: inline-block;
        }
        .coach-rail-redline.adopt::before {
          content: "+ ";
          font-style: normal;
          opacity: 0.55;
          margin-right: 2px;
        }
        .coach-rail-redline.rephrase-old {
          color: rgba(17,17,17,0.45);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
        }
        .coach-rail-redline.rephrase-new {
          background: rgba(251,199,104,0.34);
          color: #4a3508;
          border-radius: 4px;
          padding: 1px 6px;
          display: inline-block;
          margin-top: 4px;
        }

        .coach-rail-cta {
          margin-top: 18px;
          width: 100%;
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
          border: 0;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          box-shadow: 0 1px 2px rgba(17,17,17,0.12), 0 4px 10px rgba(17,17,17,0.08);
          transition: opacity 120ms ease, transform 120ms ease;
        }
        .coach-rail-cta:hover:not(:disabled) {
          opacity: 0.94;
          transform: translateY(-1px);
        }
        .coach-rail-cta:disabled { opacity: 0.6; cursor: not-allowed; }
        .coach-rail-anchor {
          display: block;
          margin-top: 12px;
          text-align: center;
          font-size: 12px;
          color: var(--color-muted-ash);
          text-decoration: underline;
          text-decoration-color: rgba(17,17,17,0.16);
          text-underline-offset: 4px;
        }
        .coach-rail-anchor:hover {
          color: var(--color-midnight-ink);
          text-decoration-color: var(--color-midnight-ink);
        }
      `}</style>

      <aside className="coach-rail">
        <div className="coach-rail-label">Coach</div>
        {headline && <p className="coach-rail-headline">{headline}</p>}
        {summary && <p className="coach-rail-summary">{summary}</p>}

        {topEdit && (
          <>
            <div className="coach-rail-divider" />
            <div className="coach-rail-edit-meta">
              <strong className={topEdit.kind}>
                {topEdit.kind === "cut"
                  ? "Cut"
                  : topEdit.kind === "adopt"
                  ? "Adopt"
                  : topEdit.kind === "drill"
                  ? "Drill"
                  : "Rephrase"}
              </strong>
              <span aria-hidden="true">·</span>
              <span>{sectionNameById[topEdit.section_id] ?? "Section"}</span>
            </div>
            {topEdit.kind === "cut" && topEdit.before && (
              <p className="coach-rail-redline cut">&ldquo;{topEdit.before}&rdquo;</p>
            )}
            {topEdit.kind === "adopt" && topEdit.after && (
              <p className="coach-rail-redline adopt">&ldquo;{topEdit.after}&rdquo;</p>
            )}
            {topEdit.kind === "rephrase" && (
              <>
                {topEdit.before && (
                  <p className="coach-rail-redline rephrase-old">
                    &ldquo;{topEdit.before}&rdquo;
                  </p>
                )}
                {topEdit.after && (
                  <p className="coach-rail-redline rephrase-new">
                    &ldquo;{topEdit.after}&rdquo;
                  </p>
                )}
              </>
            )}
            {topEdit.kind === "drill" && topEdit.line_target && (
              <p className="coach-rail-redline drill">&ldquo;{topEdit.line_target}&rdquo;</p>
            )}
          </>
        )}

        <button
          type="button"
          onClick={applyAndRecord}
          disabled={pending}
          className="coach-rail-cta"
        >
          {ctaLabel}
        </button>

        <Link href="#coach" className="coach-rail-anchor">
          Read the full notes ↓
        </Link>
      </aside>
    </>
  );
}
