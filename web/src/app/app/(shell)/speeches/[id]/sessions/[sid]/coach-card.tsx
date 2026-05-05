"use client";

// Coach card on the session report.
//
// One opinionated layout, top to bottom:
//
//   1. Headline       — large serif pull-quote (≤90 chars)
//   2. Summary        — one paragraph of supporting prose
//   3. Edits          — flat list, top picks pre-checked, bulk row
//                       at top (Pick all / Pick none) and an inline
//                       "show whole draft" link
//   4. Action footer  — primary "Apply & record →" (mode-aware copy)
//                       and a quiet "Apply to script only" secondary
//
// Per-section "what landed / what to work on" notes were intentionally
// dropped from the default render. The headline + summary + edits do
// that work without a separate block. Drill suggestions still surface
// per-section practice — they're just rendered as ordinary cards in
// the flat edit list, not their own section.
//
// On first render, the top 3 edits are pre-picked. The common case is
// "I trust the coach, just apply these and let me record again" — one
// click. Power users can deselect or use "Pick none" to start from
// zero.

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applySuggestions,
  applySuggestionsAndRecord,
  applyDrillSuggestion,
} from "@/app/app/coach-actions";
import { MODE_PRIMARY_CTA, type SessionMode } from "@/lib/modes";
import { usePickedEdits } from "./picked-edits-context";

export type SuggestedEdit = {
  id: string;
  kind: "cut" | "adopt" | "rephrase" | "drill";
  section_id: string;
  before?: string;
  after?: string;
  reason: string;
  line_target?: string;
  tactic?: string;
  provenance?: "coach" | "user-flag" | "alignment";
};

export function CoachCard({
  speechId,
  sessionId,
  mode,
  headline,
  summary,
  perSection,
  suggestedEdits,
  sectionNameById,
}: {
  speechId: string;
  sessionId: string;
  mode: SessionMode;
  headline: string;
  summary: string;
  // Per-section notes render in a collapsed disclosure at the bottom
  // of the card. The headline + summary + edits do the work on first
  // read; this is for users who want the full breakdown.
  perSection?: Array<{
    section_id: string;
    headline: string;
    what_landed: string;
    what_to_work_on: string;
  }>;
  suggestedEdits: SuggestedEdit[];
  sectionNameById: Record<string, string>;
}) {
  const router = useRouter();

  // Picked-edit state lives in PickedEditsProvider higher up the tree
  // so the right-rail Live Script Preview can read it too. The
  // provider seeds with the top N (default 3) edit ids on mount.
  const { picked, toggle, pickIds, pickNone } = usePickedEdits();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pickAll() {
    pickIds(suggestedEdits.map((e) => e.id));
  }

  const pickedEdits = useMemo(
    () => suggestedEdits.filter((e) => picked.has(e.id)),
    [suggestedEdits, picked],
  );
  const pickedDrillCount = pickedEdits.filter((e) => e.kind === "drill").length;
  const pickedScriptCount = pickedEdits.length - pickedDrillCount;
  const allPicksAreDrills = pickedEdits.length > 0 && pickedScriptCount === 0;
  const allPicked = picked.size === suggestedEdits.length && suggestedEdits.length > 0;

  function applyOnly() {
    if (pickedScriptCount === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const scriptIds = pickedEdits
          .filter((e) => e.kind !== "drill")
          .map((e) => e.id);
        const { newVersion } = await applySuggestions(sessionId, scriptIds);
        router.push(`/app/speeches/${speechId}?applied=v${newVersion}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't apply.");
      }
    });
  }

  function applyAndRecord() {
    setError(null);
    startTransition(async () => {
      try {
        if (picked.size > 0) {
          await applySuggestionsAndRecord(sessionId, Array.from(picked));
        } else {
          router.push(`/app/speeches/${speechId}/record`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("NEXT_REDIRECT")) return;
        setError(msg);
      }
    });
  }

  function drillOne(editId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await applyDrillSuggestion(sessionId, editId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("NEXT_REDIRECT")) return;
        setError(msg);
      }
    });
  }

  const kindLabel: Record<SuggestedEdit["kind"], string> = {
    cut: "Cut",
    adopt: "Adopt",
    rephrase: "Rephrase",
    drill: "Drill",
  };
  const kindClass: Record<SuggestedEdit["kind"], string> = {
    cut: "cut",
    adopt: "adopt",
    rephrase: "rephrase",
    drill: "drill",
  };

  // Mode-aware primary CTA copy.
  const primaryLabel = useMemo(() => {
    if (pending) return "Working…";
    if (picked.size === 0) {
      return mode === "freestyle" ? "Drill again →" : "Record again →";
    }
    if (allPicksAreDrills) return "Drill the picked sections →";
    return MODE_PRIMARY_CTA[mode];
  }, [picked.size, pending, mode, allPicksAreDrills]);

  return (
    <section className="mt-10">
      <h2 className="text-heading">Coach</h2>

      {/* Headline pull-quote — the lede. */}
      {headline && (
        <h3
          className="mt-4"
          style={{
            fontFamily: "var(--font-script)",
            fontSize: 28,
            fontWeight: 500,
            lineHeight: 1.22,
            letterSpacing: "-0.012em",
            color: "var(--color-midnight-ink)",
            maxWidth: 720,
            margin: 0,
          }}
        >
          {headline}
        </h3>
      )}

      {/* Summary — one paragraph of supporting prose, no card chrome. */}
      {summary && (
        <p
          className="mt-3"
          style={{
            fontFamily: "var(--font-script)",
            fontSize: 16,
            lineHeight: 1.6,
            color: "rgba(17,17,17,0.78)",
            maxWidth: 680,
            margin: "12px 0 0 0",
          }}
        >
          {summary}
        </p>
      )}

      <style>{`
        .coach-edits {
          margin-top: 28px;
          max-width: 720px;
        }
        .coach-edits-bar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(17,17,17,0.08);
          margin-bottom: 4px;
          flex-wrap: wrap;
        }
        .coach-edits-bar-left {
          display: flex; align-items: baseline; gap: 14px;
          font-size: 12px; color: var(--color-muted-ash);
          letter-spacing: 0.04em;
        }
        .coach-edits-bar-left strong {
          color: var(--color-midnight-ink);
          font-weight: 500;
        }
        .coach-edits-bar-actions {
          display: flex; align-items: center; gap: 8px;
        }
        .coach-bulk-link {
          background: transparent; border: 0;
          color: var(--color-muted-ash);
          font-size: 12px;
          padding: 4px 6px;
          cursor: pointer;
          text-decoration: underline;
          text-decoration-color: rgba(17,17,17,0.18);
          text-underline-offset: 3px;
        }
        .coach-bulk-link:hover { color: var(--color-midnight-ink); }
        .coach-bulk-link:disabled { opacity: 0.4; cursor: not-allowed; }

        .coach-edit-row {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 14px;
          align-items: flex-start;
          padding: 14px 0;
          border-top: 1px solid rgba(17,17,17,0.05);
        }
        .coach-edit-row:first-of-type { border-top: 0; }

        .coach-edit-check {
          appearance: none;
          width: 18px; height: 18px;
          border: 1.5px solid rgba(17,17,17,0.3);
          border-radius: 4px;
          margin-top: 4px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          transition: background 120ms ease, border-color 120ms ease;
          flex-shrink: 0;
        }
        .coach-edit-check[aria-checked="true"] {
          background: var(--color-midnight-ink);
          border-color: var(--color-midnight-ink);
        }
        .coach-edit-check[aria-checked="true"]::after {
          content: "";
          width: 5px; height: 9px;
          border: solid var(--color-canvas-white);
          border-width: 0 2px 2px 0;
          transform: rotate(45deg) translate(-1px, -1px);
        }

        .coach-edit-body {
          min-width: 0;
        }
        .coach-edit-meta {
          display: flex; align-items: baseline; gap: 8px;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-muted-ash);
          margin-bottom: 6px;
        }
        .coach-edit-meta strong { font-weight: 500; }
        .coach-edit-meta strong.cut { color: #88321a; }
        .coach-edit-meta strong.adopt { color: var(--color-deep-indigo); }
        .coach-edit-meta strong.rephrase { color: #5a4310; }
        .coach-edit-meta strong.drill { color: #1a4f88; }

        .coach-edit-redline {
          font-family: var(--font-script);
          font-size: 16px;
          line-height: 1.55;
          margin: 0;
        }
        .coach-edit-redline.cut {
          color: rgba(17,17,17,0.45);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
        }
        .coach-edit-redline.adopt {
          color: var(--color-deep-indigo);
          font-style: italic;
          background: rgba(50,142,250,0.08);
          border-radius: 4px;
          padding: 1px 6px;
          display: inline-block;
        }
        .coach-edit-redline.rephrase-old {
          color: rgba(17,17,17,0.45);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
        }
        .coach-edit-redline.rephrase-new {
          background: rgba(251,199,104,0.22);
          color: #4a3508;
          border-radius: 4px;
          padding: 1px 6px;
          display: inline-block;
          margin-top: 4px;
        }
        .coach-edit-drill-target {
          font-family: var(--font-script);
          font-size: 16px;
          line-height: 1.5;
          color: var(--color-midnight-ink);
          padding-left: 12px;
          border-left: 2px solid rgba(26, 79, 136, 0.4);
          margin: 0;
        }
        .coach-edit-drill-tactic {
          font-size: 13.5px;
          line-height: 1.5;
          color: rgba(17,17,17,0.78);
          margin-top: 6px;
        }
        .coach-edit-reason {
          font-size: 12.5px;
          line-height: 1.5;
          color: var(--color-muted-ash);
          margin-top: 6px;
        }

        .coach-edit-row-action {
          display: flex; flex-direction: column; gap: 6px;
          align-items: flex-end;
        }
        .coach-drill-btn {
          appearance: none;
          background: transparent;
          border: 1px solid rgba(26, 79, 136, 0.3);
          padding: 6px 12px;
          border-radius: 7px;
          font-size: 11.5px; font-weight: 500;
          color: #1a4f88;
          cursor: pointer;
          white-space: nowrap;
          transition: background 120ms ease;
        }
        .coach-drill-btn:hover { background: rgba(26, 79, 136, 0.06); }
      `}</style>

      {suggestedEdits.length > 0 && (
        <div className="coach-edits">
          {/* Bulk-action header — picked count, pick all/none, and a
              quiet inline link to the auto-draft modal up top. */}
          <div className="coach-edits-bar">
            <div className="coach-edits-bar-left">
              <span>
                <strong>{picked.size}</strong> of {suggestedEdits.length} picked
              </span>
            </div>
            <div className="coach-edits-bar-actions">
              <button
                type="button"
                onClick={pickAll}
                disabled={allPicked}
                className="coach-bulk-link"
              >
                Pick all
              </button>
              <span aria-hidden="true" style={{ color: "rgba(17,17,17,0.18)" }}>·</span>
              <button
                type="button"
                onClick={pickNone}
                disabled={picked.size === 0}
                className="coach-bulk-link"
              >
                Pick none
              </button>
            </div>
          </div>

          {suggestedEdits.map((edit) => {
            const on = picked.has(edit.id);
            return (
              <div key={edit.id} className="coach-edit-row">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={
                    on ? `Unpick ${kindLabel[edit.kind]}` : `Pick ${kindLabel[edit.kind]}`
                  }
                  onClick={() => toggle(edit.id)}
                  className="coach-edit-check"
                />
                <div className="coach-edit-body">
                  <div className="coach-edit-meta">
                    <strong className={kindClass[edit.kind]}>{kindLabel[edit.kind]}</strong>
                    <span aria-hidden="true">·</span>
                    <span>{sectionNameById[edit.section_id] ?? "Section"}</span>
                  </div>

                  {edit.kind === "cut" && edit.before && (
                    <p className="coach-edit-redline cut">
                      &ldquo;{edit.before}&rdquo;
                    </p>
                  )}
                  {edit.kind === "adopt" && edit.after && (
                    <p className="coach-edit-redline adopt">
                      &ldquo;{edit.after}&rdquo;
                    </p>
                  )}
                  {edit.kind === "rephrase" && (
                    <>
                      {edit.before && (
                        <p className="coach-edit-redline rephrase-old">
                          &ldquo;{edit.before}&rdquo;
                        </p>
                      )}
                      {edit.after && (
                        <p className="coach-edit-redline rephrase-new">
                          &ldquo;{edit.after}&rdquo;
                        </p>
                      )}
                    </>
                  )}
                  {edit.kind === "drill" && (
                    <>
                      {edit.line_target && (
                        <p className="coach-edit-drill-target">
                          &ldquo;{edit.line_target}&rdquo;
                        </p>
                      )}
                      {edit.tactic && (
                        <p className="coach-edit-drill-tactic">{edit.tactic}</p>
                      )}
                    </>
                  )}

                  <p className="coach-edit-reason">{edit.reason}</p>
                </div>

                <div className="coach-edit-row-action">
                  {edit.kind === "drill" && (
                    <button
                      type="button"
                      onClick={() => drillOne(edit.id)}
                      disabled={pending}
                      className="coach-drill-btn"
                    >
                      Drill →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Section-by-section notes — collapsed by default. The headline +
          summary + edits carry the load on first read; this disclosure
          is for users who want the full per-section breakdown. */}
      {perSection && perSection.length > 0 && (
        <details className="mt-8" style={{ maxWidth: 720 }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: 13,
              color: "var(--color-muted-ash)",
              padding: "8px 0",
              listStyle: "none",
              userSelect: "none",
            }}
          >
            Section-by-section notes ({perSection.length})
          </summary>
          <div style={{ marginTop: 12, display: "grid", gap: 24 }}>
            {perSection.map((note) => (
              <article key={note.section_id}>
                <header
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "var(--color-muted-ash)",
                      }}
                    >
                      {sectionNameById[note.section_id] ?? "Section"}
                    </div>
                    <h4
                      style={{
                        fontFamily: "var(--font-script)",
                        fontSize: 18,
                        fontWeight: 500,
                        lineHeight: 1.3,
                        color: "var(--color-midnight-ink)",
                        margin: "2px 0 0 0",
                      }}
                    >
                      {note.headline}
                    </h4>
                  </div>
                  <Link
                    href={`/app/speeches/${speechId}/record?section=${note.section_id}`}
                    style={{
                      fontSize: 12,
                      color: "var(--color-muted-ash)",
                      textDecoration: "underline",
                      textDecorationColor: "rgba(17,17,17,0.18)",
                      textUnderlineOffset: 4,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    Practice this →
                  </Link>
                </header>
                <p
                  style={{
                    fontFamily: "var(--font-script)",
                    fontSize: 15,
                    lineHeight: 1.65,
                    color: "var(--color-midnight-ink)",
                    margin: 0,
                  }}
                >
                  {note.what_landed}
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-script)",
                    fontSize: 15,
                    lineHeight: 1.65,
                    color: "rgba(17,17,17,0.78)",
                    margin: "8px 0 0 0",
                    paddingLeft: 14,
                    borderLeft: "2px solid rgba(201, 154, 74, 0.45)",
                  }}
                >
                  {note.what_to_work_on}
                </p>
              </article>
            ))}
          </div>
        </details>
      )}

      {/* Footer CTAs — convergence loop spine. */}
      <div
        className="mt-7"
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          maxWidth: 720,
        }}
      >
        <button
          onClick={applyAndRecord}
          disabled={pending}
          className="btn-primary"
          style={{ padding: "13px 22px", fontSize: 15 }}
        >
          {primaryLabel}
        </button>
        {pickedScriptCount > 0 && (
          <button
            onClick={applyOnly}
            disabled={pending}
            className="btn-light"
          >
            Apply to script only
          </button>
        )}
        {error && (
          <span className="text-body-sm" style={{ color: "var(--color-leadgen-red)" }}>
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
