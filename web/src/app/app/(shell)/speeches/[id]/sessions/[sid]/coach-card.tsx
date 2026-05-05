"use client";

// Coach card on the session report.
//
// Layout, in priority order:
//   1. Headline             — large serif pull-quote (≤90 chars), the
//                            single most important takeaway
//   2. Summary              — supporting prose, two sentences
//   3. Per-section notes    — what landed / what to work on for each
//                            section, with a "Practice / Drill" link
//   4. Coach's edits        — toggleable cards the user picks. Grouped
//                            by section. Each card shows provenance
//                            (coach / detected / you flagged).
//   5. Action footer        — two CTAs:
//        primary  → Apply picks + record again (or "Drill again" in
//                   freestyle mode if all picks are drills)
//        secondary → Apply to script only (suppressed when only drills
//                    are picked, since drills don't change the script)
//
// The point of this layout is to make the convergence loop obvious.
// The product story is rehearse → see notes → apply changes → rehearse
// again. The "Apply & record again" / "Drill again" button is the
// single most important affordance on this page.

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applySuggestions,
  applySuggestionsAndRecord,
  applyDrillSuggestion,
} from "@/app/app/coach-actions";
import { MODE_PRIMARY_CTA, type SessionMode } from "@/lib/modes";

type PerSectionNote = {
  section_id: string;
  headline: string;
  what_landed: string;
  what_to_work_on: string;
};
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

// Cheap urgency heuristic. A section gets the loud "Drill this section"
// button when the coach's prose flags a real problem (the section
// wasn't delivered, was rushed, the speaker blanked, etc.) rather than
// the quiet underlined link. We check the headline and the work-on
// text; what-landed is excluded because "the speaker recovered from a
// blank" shouldn't trigger urgency.
const URGENT_KEYWORDS = [
  "skip", "skipped",
  "miss", "missed",
  "never delivered", "never reached",
  "blank", "blanked", "lost",
  "rushed", "racing",
  "ran out of time", "ran over",
  "stumbled", "froze",
  "abandoned", "cut short",
];
function isUrgent(note: { headline: string; what_to_work_on: string }): boolean {
  const haystack = `${note.headline} ${note.what_to_work_on}`.toLowerCase();
  return URGENT_KEYWORDS.some((kw) => haystack.includes(kw));
}

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
  perSection: PerSectionNote[];
  suggestedEdits: SuggestedEdit[];
  sectionNameById: Record<string, string>;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Group edits by section so the user reads each section's
  // suggestions as a coherent block instead of a flat list.
  const editsBySection = useMemo(() => {
    const groups = new Map<string, SuggestedEdit[]>();
    for (const e of suggestedEdits) {
      const arr = groups.get(e.section_id) ?? [];
      arr.push(e);
      groups.set(e.section_id, arr);
    }
    return Array.from(groups.entries());
  }, [suggestedEdits]);

  // Counts that drive the footer copy. A pure-drill batch shouldn't
  // offer "Apply to script only" because there's nothing to apply.
  const pickedEdits = useMemo(
    () => suggestedEdits.filter((e) => picked.has(e.id)),
    [suggestedEdits, picked],
  );
  const pickedDrillCount = pickedEdits.filter((e) => e.kind === "drill").length;
  const pickedScriptCount = pickedEdits.length - pickedDrillCount;
  const allPicksAreDrills = pickedEdits.length > 0 && pickedScriptCount === 0;

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
          // Action redirects on success.
          await applySuggestionsAndRecord(sessionId, Array.from(picked));
        } else {
          // No picks — just go to the recorder.
          router.push(`/app/speeches/${speechId}/record`);
        }
      } catch (err) {
        // redirect() throws NEXT_REDIRECT — that's expected, not an error.
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
  const provenanceLabel: Record<NonNullable<SuggestedEdit["provenance"]>, string> = {
    coach: "🎙️ Coach",
    "user-flag": "🎯 You flagged",
    alignment: "🔍 Detected",
  };

  // Primary CTA copy. Mode-aware. The picked count already shows in the
  // header above — no need to repeat it on the button itself.
  const primaryLabel = useMemo(() => {
    if (pending) return "Working…";
    if (picked.size === 0) {
      return mode === "freestyle" ? "Drill again →" : "Record again →";
    }
    if (allPicksAreDrills) return "Drill the picked sections →";
    // Mixed or all-script picks: use the mode default.
    return MODE_PRIMARY_CTA[mode];
  }, [picked.size, pending, mode, allPicksAreDrills]);

  return (
    <section className="mt-14">
      <div className="flex items-baseline justify-between">
        <h2 className="text-heading">Coach</h2>
        {suggestedEdits.length > 0 && (
          <span className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
            {picked.size}{" "}
            {picked.size === 1 ? "edit" : "edits"} picked
          </span>
        )}
      </div>

      {/* ===== Headline pull-quote =====
          Large serif quote, the single most important takeaway.
          Render before the supporting summary so the lede isn't buried. */}
      {headline && (
        <h3
          className="mt-5"
          style={{
            fontFamily: "var(--font-script)",
            fontSize: 30,
            fontWeight: 500,
            lineHeight: 1.2,
            letterSpacing: "-0.012em",
            color: "var(--color-midnight-ink)",
            maxWidth: 760,
            margin: 0,
            paddingBottom: 12,
            borderBottom: "2px solid rgba(201, 154, 74, 0.55)",
            display: "inline-block",
          }}
        >
          {headline}
        </h3>
      )}

      {/* ===== Summary — supporting prose under the headline ===== */}
      {summary && (
        <div className="card-bordered mt-5" style={{ padding: 28, maxWidth: 760 }}>
          <p
            className="text-body"
            style={{
              fontFamily: "var(--font-script)",
              fontSize: 17,
              lineHeight: 1.65,
              color: "var(--color-midnight-ink)",
            }}
          >
            {summary}
          </p>
        </div>
      )}

      {/* ===== Shared coach-section styles ===== */}
      <style>{`
        /* Per-section notes — inline editorial annotations.
           No card boundary, no badges. Section heading sits as small
           caps; what-landed flows as serif body; what-to-work-on gets
           a single quiet tell — a 2px gold left rule — to mark it as
           the actionable bit without making it shout. */
        .coach-notes {
          margin-top: 24px;
          max-width: 720px;
          display: grid;
          gap: 36px;
        }
        .coach-note-head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 16px;
          margin-bottom: 14px;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(17,17,17,0.06);
        }
        .coach-note-section-name {
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.12em; text-transform: uppercase;
          color: var(--color-muted-ash);
        }
        .coach-note-headline {
          font-family: var(--font-script);
          font-size: 22px; font-weight: 500;
          line-height: 1.25; letter-spacing: -0.012em;
          color: var(--color-midnight-ink);
          margin-top: 4px;
        }
        .coach-note-practice {
          font-size: 12px; font-weight: 500;
          color: var(--color-muted-ash);
          text-decoration: underline;
          text-decoration-color: rgba(17,17,17,0.18);
          text-underline-offset: 4px;
          text-decoration-thickness: 1px;
          white-space: nowrap;
          flex-shrink: 0;
          transition: color 120ms ease, text-decoration-color 120ms ease,
                      background 120ms ease, transform 120ms ease;
        }
        .coach-note-practice:hover {
          color: var(--color-midnight-ink);
          text-decoration-color: var(--color-midnight-ink);
        }
        /* Urgent variant: when a section was skipped, missed, blanked,
           or rushed, the drill link upgrades to a filled black button.
           The headline already tells the user something went wrong;
           the action should match. */
        .coach-note-practice.is-urgent {
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
          padding: 7px 12px;
          border-radius: 8px;
          text-decoration: none;
          box-shadow: 0 1px 2px rgba(17,17,17,0.12), 0 4px 10px rgba(17,17,17,0.08);
        }
        .coach-note-practice.is-urgent:hover {
          color: var(--color-canvas-white);
          text-decoration: none;
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(17,17,17,0.16), 0 8px 16px rgba(17,17,17,0.10);
        }
        .coach-note-paragraph {
          font-family: var(--font-script);
          font-size: 16.5px;
          line-height: 1.7;
          color: var(--color-midnight-ink);
        }
        .coach-note-paragraph + .coach-note-paragraph {
          margin-top: 12px;
        }
        /* The "work on" paragraph: quiet gold left rule, no background
           wash. The rule signals action; the rest of the prose flows
           with what-landed so they read as one continuous voice. */
        .coach-note-paragraph.is-workon {
          padding-left: 16px;
          border-left: 2px solid rgba(201, 154, 74, 0.45);
          color: rgba(17,17,17,0.82);
        }

        /* Coach's edits — grouped by section with redline-style cards. */
        .coach-edits {
          max-width: 720px;
          margin-top: 36px;
        }
        .coach-edit-section {
          margin-top: 28px;
        }
        .coach-edit-section:first-child { margin-top: 12px; }
        .coach-edit-section-head {
          display: flex; align-items: baseline; gap: 12px;
          padding-bottom: 8px;
          margin-bottom: 4px;
          border-bottom: 1px solid rgba(17,17,17,0.08);
        }
        .coach-edit-section-name {
          font-size: 11px; font-weight: 600;
          letter-spacing: 0.14em; text-transform: uppercase;
          color: var(--color-midnight-ink);
        }
        .coach-edit-section-count {
          font-size: 11px; font-weight: 500;
          color: var(--color-muted-ash);
          letter-spacing: 0.04em;
        }
        .coach-edit {
          padding: 18px 4px 18px 0;
          border-top: 1px solid rgba(17,17,17,0.06);
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 24px;
          align-items: flex-start;
          transition: background 160ms ease;
        }
        .coach-edit:first-of-type { border-top: 0; }
        .coach-edit.is-picked {
          background: rgba(71, 208, 150, 0.06);
          border-radius: 6px;
          padding-left: 12px;
          padding-right: 12px;
          margin-left: -12px;
          margin-right: -12px;
          border-color: rgba(71, 208, 150, 0.24);
        }
        .coach-edit-meta {
          display: flex; align-items: baseline; gap: 8px;
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.1em; text-transform: uppercase;
          color: var(--color-muted-ash);
          margin-bottom: 10px;
        }
        .coach-edit-meta strong {
          font-weight: 500;
          color: var(--color-midnight-ink);
        }
        .coach-edit-meta strong.cut { color: #88321a; }
        .coach-edit-meta strong.adopt { color: var(--color-deep-indigo); }
        .coach-edit-meta strong.rephrase { color: #5a4310; }
        .coach-edit-meta strong.drill { color: #1a4f88; }
        .coach-edit-prov {
          font-size: 10.5px;
          letter-spacing: 0.04em;
          text-transform: none;
          padding: 2px 8px;
          border-radius: 999px;
          background: rgba(17,17,17,0.05);
          color: var(--color-midnight-ink);
          margin-left: auto;
        }
        .coach-edit-redline {
          font-family: var(--font-script);
          font-size: 16.5px;
          line-height: 1.6;
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
        .coach-edit-redline.adopt::before {
          content: "+ ";
          font-style: normal;
          opacity: 0.55;
          margin-right: 2px;
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
        /* Drill cards: no redline. Show the line_target as a quoted
           reference and tactic as supporting prose. */
        .coach-edit-drill-target {
          font-family: var(--font-script);
          font-size: 16.5px;
          line-height: 1.55;
          color: var(--color-midnight-ink);
          padding-left: 14px;
          border-left: 3px solid rgba(26, 79, 136, 0.4);
          margin: 0;
        }
        .coach-edit-drill-tactic {
          font-size: 14px;
          line-height: 1.55;
          color: var(--color-midnight-ink);
          margin-top: 10px;
          font-family: var(--font-sans);
        }
        .coach-edit-reason {
          font-size: 13.5px;
          line-height: 1.55;
          color: var(--color-muted-ash);
          margin-top: 10px;
          font-family: var(--font-sans);
        }
        .coach-edit-actions {
          display: flex; flex-direction: column; gap: 6px;
          align-items: flex-end;
        }
        .coach-edit-pick-btn {
          appearance: none;
          background: transparent;
          border: 1px solid rgba(17,17,17,0.16);
          padding: 7px 14px;
          border-radius: 7px;
          font-size: 12px; font-weight: 500;
          letter-spacing: 0.04em;
          color: var(--color-midnight-ink);
          cursor: pointer;
          white-space: nowrap;
          transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        .coach-edit-pick-btn:hover {
          background: var(--color-whisper-gray);
          border-color: rgba(17,17,17,0.24);
        }
        .coach-edit-pick-btn.is-picked {
          background: var(--color-midnight-ink);
          border-color: var(--color-midnight-ink);
          color: var(--color-canvas-white);
        }
        .coach-edit-pick-btn.is-picked:hover {
          background: rgba(17,17,17,0.85);
        }
        .coach-edit-drill-btn {
          appearance: none;
          background: transparent;
          border: 1px solid rgba(26, 79, 136, 0.3);
          padding: 6px 12px;
          border-radius: 7px;
          font-size: 11.5px; font-weight: 500;
          letter-spacing: 0.04em;
          color: #1a4f88;
          cursor: pointer;
          white-space: nowrap;
          transition: background 120ms ease;
        }
        .coach-edit-drill-btn:hover {
          background: rgba(26, 79, 136, 0.06);
        }
      `}</style>

      {/* ===== Per-section notes — inline editorial annotations =====
          The "Practice this part" link escalates to a filled black
          button when the headline or work-on text mentions an urgent
          problem (skipped, missed, blanked, rushed, never delivered,
          etc). The keyword check is good enough — we'd rather have a
          minor false-positive than under-emphasise a section that
          wasn't actually delivered. */}
      {perSection.length > 0 && (
        <div className="coach-notes">
          {perSection.map((note) => {
            const urgent = isUrgent(note);
            return (
              <article key={note.section_id}>
                <header className="coach-note-head">
                  <div>
                    <div className="coach-note-section-name">
                      {sectionNameById[note.section_id] ?? "Section"}
                    </div>
                    <h4 className="coach-note-headline">{note.headline}</h4>
                  </div>
                  <Link
                    href={`/app/speeches/${speechId}/record?section=${note.section_id}`}
                    className={`coach-note-practice ${urgent ? "is-urgent" : ""}`}
                  >
                    {urgent ? "Drill this section →" : "Practice this part →"}
                  </Link>
                </header>
                <p className="coach-note-paragraph">{note.what_landed}</p>
                <p className="coach-note-paragraph is-workon">{note.what_to_work_on}</p>
              </article>
            );
          })}
        </div>
      )}

      {/* ===== Coach's edits — grouped by section ===== */}
      {suggestedEdits.length > 0 && (
        <div className="coach-edits">
          <div className="flex items-baseline justify-between" style={{ gap: 16, marginBottom: 6 }}>
            <h3 className="text-subheading">Coach&rsquo;s edits</h3>
            <p className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
              Pick the edits you want — they&rsquo;ll be added to your script.
            </p>
          </div>
          {/* Auto-draft escape hatch. The AutoDraftButton lives in the
              page header; this is the contextual entry point — read it
              as "if you don't want to pick edits one by one, here's the
              whole next draft." */}
          <p
            className="text-body-sm"
            style={{
              color: "var(--color-muted-ash)",
              margin: "0 0 18px",
              fontStyle: "italic",
            }}
          >
            Want the whole next draft instead? Use the <strong style={{ color: "var(--color-midnight-ink)", fontStyle: "normal" }}>Show me v(n+1) →</strong> button at the top of the page.
          </p>

          {editsBySection.map(([sectionId, edits]) => (
            <div key={sectionId} className="coach-edit-section">
              <div className="coach-edit-section-head">
                <span className="coach-edit-section-name">
                  {sectionNameById[sectionId] ?? "Section"}
                </span>
                <span className="coach-edit-section-count">
                  {edits.length} {edits.length === 1 ? "edit" : "edits"}
                </span>
              </div>

              {edits.map((edit) => {
                const on = picked.has(edit.id);
                const provenance = edit.provenance ?? "coach";
                return (
                  <div key={edit.id} className={`coach-edit ${on ? "is-picked" : ""}`}>
                    <div>
                      <div className="coach-edit-meta">
                        <strong className={kindClass[edit.kind]}>{kindLabel[edit.kind]}</strong>
                        <span className="coach-edit-prov">{provenanceLabel[provenance]}</span>
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

                    <div className="coach-edit-actions">
                      <button
                        type="button"
                        onClick={() => toggle(edit.id)}
                        className={`coach-edit-pick-btn ${on ? "is-picked" : ""}`}
                        aria-pressed={on}
                      >
                        {on ? "Picked ✓" : "Pick"}
                      </button>
                      {edit.kind === "drill" && (
                        <button
                          type="button"
                          onClick={() => drillOne(edit.id)}
                          disabled={pending}
                          className="coach-edit-drill-btn"
                        >
                          Drill →
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* ===== Footer CTAs =====
          Primary action — Apply + record again — is shown even if no
          suggestions exist, because re-recording is the natural next
          step regardless of whether the coach proposed edits.
          "Apply to script only" only renders when there are picked
          script-mutating edits (drills don't change the script). */}
      <div
        className="mt-8"
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          maxWidth: 760,
        }}
      >
        <button
          onClick={applyAndRecord}
          disabled={pending}
          className="btn-primary"
          style={{
            padding: "13px 22px",
            fontSize: 15,
          }}
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
