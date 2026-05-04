"use client";

// Coach card on the session report.
//
// Layout, in priority order:
//   1. Summary             — the headline takeaway, in serif body
//   2. Per-section notes   — what landed / what to work on for each section,
//                            with a "Practice just this section" link
//   3. Suggested edits     — toggleable cards the user stages
//   4. Action footer       — two CTAs:
//        primary  → Apply staged edits AND start recording the next take
//        secondary → Apply to script (no recording)
//
// The point of this redesign is to make the convergence loop obvious.
// The whole product story is: rehearse → see notes → apply changes →
// rehearse again. Right now the user sees notes but nothing pulls them
// to the next iteration. The "Apply & record again" button is the
// single most important affordance on this page.

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applySuggestions,
  applySuggestionsAndRecord,
} from "@/app/app/coach-actions";

type PerSectionNote = {
  section_id: string;
  headline: string;
  what_landed: string;
  what_to_work_on: string;
};
type SuggestedEdit = {
  id: string;
  kind: "cut" | "adopt" | "rephrase";
  section_id: string;
  before?: string;
  after?: string;
  reason: string;
};

// Cheap urgency heuristic. A section gets the loud "Drill this
// section →" button when the coach's prose flags a real problem
// (the section wasn't delivered, was rushed, the speaker blanked,
// etc) rather than the quiet underlined link. We check the
// headline and the work-on text; what-landed is excluded because
// "the speaker recovered from a blank" shouldn't trigger urgency.
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
  summary,
  perSection,
  suggestedEdits,
  sectionNameById,
}: {
  speechId: string;
  sessionId: string;
  summary: string;
  perSection: PerSectionNote[];
  suggestedEdits: SuggestedEdit[];
  sectionNameById: Record<string, string>;
}) {
  const router = useRouter();
  const [staged, setStaged] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setStaged((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyOnly() {
    if (staged.size === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const { newVersion } = await applySuggestions(sessionId, Array.from(staged));
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
        if (staged.size > 0) {
          // Action redirects on success.
          await applySuggestionsAndRecord(sessionId, Array.from(staged));
        } else {
          // No edits — just go to the recorder.
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

  const kindLabel = (k: SuggestedEdit["kind"]) =>
    ({ cut: "Cut", adopt: "Adopt", rephrase: "Rephrase" }[k]);
  const kindPill = (k: SuggestedEdit["kind"]) =>
    ({ cut: "pill-red", adopt: "pill-blue", rephrase: "pill-gold" }[k]);

  // Primary CTA copy. The staged count already shows in the header
  // above — no need to repeat it on the button itself.
  const primaryLabel = useMemo(() => {
    if (pending) return "Working…";
    if (staged.size === 0) return "Record again →";
    return "Apply & record →";
  }, [staged.size, pending]);

  return (
    <section className="mt-14">
      <div className="flex items-baseline justify-between">
        <h2 className="text-heading">Coach</h2>
        {suggestedEdits.length > 0 && (
          <span className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
            {staged.size}{" "}
            {staged.size === 1 ? "suggestion" : "suggestions"} staged
          </span>
        )}
      </div>

      {/* ===== Summary ===== */}
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

        /* Suggested edits — redline-style track-changes.
           Visual continuity with the diff view above: a "cut" is the
           same struck-through-red as a skipped line in the diff; an
           "adopt" is the same blue italic as an ad-lib; a "rephrase"
           shows old struck-through then new in soft gold, mirroring
           the diff's paraphrase treatment. */
        .coach-edits {
          max-width: 720px;
          margin-top: 36px;
        }
        .coach-edit {
          padding: 18px 4px 18px 0;
          border-top: 1px solid rgba(17,17,17,0.08);
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 24px;
          align-items: flex-start;
          transition: background 160ms ease;
        }
        .coach-edit:last-child {
          border-bottom: 1px solid rgba(17,17,17,0.08);
        }
        .coach-edit.is-staged {
          background: rgba(71, 208, 150, 0.06);
          border-radius: 6px;
          padding-left: 12px;
          padding-right: 12px;
          margin-left: -12px;
          margin-right: -12px;
          border-color: rgba(71, 208, 150, 0.24);
        }
        .coach-edit.is-staged + .coach-edit { border-top-color: rgba(71, 208, 150, 0.24); }
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
        .coach-edit-reason {
          font-size: 13.5px;
          line-height: 1.55;
          color: var(--color-muted-ash);
          margin-top: 10px;
          font-family: var(--font-sans);
        }
        .coach-edit-stage-btn {
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
        .coach-edit-stage-btn:hover {
          background: var(--color-whisper-gray);
          border-color: rgba(17,17,17,0.24);
        }
        .coach-edit-stage-btn.is-staged {
          background: var(--color-midnight-ink);
          border-color: var(--color-midnight-ink);
          color: var(--color-canvas-white);
        }
        .coach-edit-stage-btn.is-staged:hover {
          background: rgba(17,17,17,0.85);
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

      {/* ===== Suggested edits — redline track-changes ===== */}
      {suggestedEdits.length > 0 && (
        <div className="coach-edits">
          <div className="flex items-baseline justify-between" style={{ gap: 16, marginBottom: 6 }}>
            <h3 className="text-subheading">Suggested edits</h3>
            <p className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
              Stage the ones you want, then apply.
            </p>
          </div>

          <div>
            {suggestedEdits.map((edit) => {
              const on = staged.has(edit.id);
              return (
                <div
                  key={edit.id}
                  className={`coach-edit ${on ? "is-staged" : ""}`}
                >
                  <div>
                    <div className="coach-edit-meta">
                      <strong className={edit.kind}>{kindLabel(edit.kind)}</strong>
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

                    <p className="coach-edit-reason">{edit.reason}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggle(edit.id)}
                    className={`coach-edit-stage-btn ${on ? "is-staged" : ""}`}
                    aria-pressed={on}
                  >
                    {on ? "Staged ✓" : "Stage"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== Footer CTAs =====
          Primary action — Apply + record again — is shown even if no
          suggestions exist, because re-recording is the natural next
          step regardless of whether the coach proposed edits. The
          secondary "Apply to script" only renders when something is
          staged. */}
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
        {staged.size > 0 && (
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
