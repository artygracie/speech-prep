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

  // Summary copy on the primary CTA changes with state so the user
  // always sees what's about to happen.
  const primaryLabel = useMemo(() => {
    if (pending) return "Working…";
    if (staged.size === 0) return "Record again →";
    if (staged.size === 1) return "Apply 1 change & record →";
    return `Apply ${staged.size} changes & record →`;
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

      {/* ===== Per-section notes ===== */}
      {perSection.length > 0 && (
        <div className="mt-6" style={{ display: "grid", gap: 12, maxWidth: 760 }}>
          {perSection.map((note) => (
            <div key={note.section_id} className="card-bordered" style={{ padding: 20 }}>
              <div className="flex items-baseline justify-between" style={{ gap: 12 }}>
                <div>
                  <div
                    className="text-caption"
                    style={{ color: "var(--color-muted-ash)", marginBottom: 6 }}
                  >
                    {sectionNameById[note.section_id] ?? "Section"}
                  </div>
                  <h4 className="text-subheading">{note.headline}</h4>
                </div>
                {/* Per-section drill link — pre-fills the recorder
                    with this section in scope so the user can rehearse
                    just this part instead of the whole speech. */}
                <Link
                  href={`/app/speeches/${speechId}/record?section=${note.section_id}`}
                  className="text-caption"
                  style={{
                    color: "var(--color-deep-indigo)",
                    textDecoration: "underline",
                    textUnderlineOffset: 4,
                    whiteSpace: "nowrap",
                  }}
                >
                  Practice this part →
                </Link>
              </div>
              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                <p className="text-body-sm">
                  <span
                    className="badge pill-mint"
                    style={{ marginRight: 8, verticalAlign: "1px" }}
                  >
                    <span className="dot" />
                    Landed
                  </span>
                  {note.what_landed}
                </p>
                <p className="text-body-sm">
                  <span
                    className="badge pill-gold"
                    style={{ marginRight: 8, verticalAlign: "1px" }}
                  >
                    <span className="dot" />
                    Work on
                  </span>
                  {note.what_to_work_on}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== Suggested edits ===== */}
      {suggestedEdits.length > 0 && (
        <div className="mt-8" style={{ maxWidth: 760 }}>
          <h3 className="text-subheading">Suggested edits</h3>
          <p className="text-body-sm mt-2" style={{ color: "var(--color-muted-ash)" }}>
            Tap to stage the ones you want. Apply them and record your next take.
          </p>

          <div className="mt-5" style={{ display: "grid", gap: 10 }}>
            {suggestedEdits.map((edit) => {
              const on = staged.has(edit.id);
              return (
                <button
                  key={edit.id}
                  onClick={() => toggle(edit.id)}
                  className="card-bordered"
                  style={{
                    padding: 18,
                    textAlign: "left",
                    cursor: "pointer",
                    background: on ? "var(--color-whisper-gray)" : "var(--color-canvas-white)",
                    border: on
                      ? "1px solid var(--color-midnight-ink)"
                      : "1px solid rgba(17,17,17,0.08)",
                  }}
                >
                  <div className="flex items-baseline justify-between">
                    <div className="flex items-baseline gap-2">
                      <span className={`badge ${kindPill(edit.kind)}`}>
                        <span className="dot" />
                        {kindLabel(edit.kind)}
                      </span>
                      <span
                        className="text-caption"
                        style={{ color: "var(--color-muted-ash)" }}
                      >
                        {sectionNameById[edit.section_id] ?? "Section"}
                      </span>
                    </div>
                    <span
                      className="text-body-sm"
                      style={{
                        color: on ? "var(--color-deliver-green)" : "var(--color-muted-ash)",
                        fontWeight: on ? 500 : 400,
                      }}
                    >
                      {on ? "Staged" : "Tap to stage"}
                    </span>
                  </div>

                  {edit.before && (
                    <p
                      className="diff-line diff-skipped"
                      style={{ marginTop: 12 }}
                    >
                      &ldquo;{edit.before}&rdquo;
                    </p>
                  )}
                  {edit.after && (
                    <p
                      className="diff-line diff-improv"
                      style={{ marginTop: 4 }}
                    >
                      + &ldquo;{edit.after}&rdquo;
                    </p>
                  )}

                  <p
                    className="text-body-sm mt-3"
                    style={{ color: "var(--color-muted-ash)" }}
                  >
                    {edit.reason}
                  </p>
                </button>
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
