"use client";

// Coach card on the session report: shows the AI summary, per-section
// notes, and a list of suggested edits the user can stage. Clicking
// "Apply" calls the coach-actions server action.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applySuggestions } from "@/app/app/coach-actions";

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

  function apply() {
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

  const kindLabel = (k: SuggestedEdit["kind"]) =>
    ({ cut: "Cut", adopt: "Adopt", rephrase: "Rephrase" }[k]);
  const kindPill = (k: SuggestedEdit["kind"]) =>
    ({ cut: "pill-red", adopt: "pill-blue", rephrase: "pill-gold" }[k]);

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

      {/* Summary */}
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

      {/* Per-section notes */}
      {perSection.length > 0 && (
        <div className="mt-6" style={{ display: "grid", gap: 12, maxWidth: 760 }}>
          {perSection.map((note) => (
            <div key={note.section_id} className="card-bordered" style={{ padding: 20 }}>
              <div
                className="text-caption"
                style={{ color: "var(--color-muted-ash)", marginBottom: 6 }}
              >
                {sectionNameById[note.section_id] ?? "Section"}
              </div>
              <h4 className="text-subheading">{note.headline}</h4>
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

      {/* Suggested edits */}
      {suggestedEdits.length > 0 && (
        <div className="mt-8" style={{ maxWidth: 760 }}>
          <h3 className="text-subheading">Suggested edits</h3>
          <p className="text-body-sm mt-2" style={{ color: "var(--color-muted-ash)" }}>
            Stage the ones you want, then apply. We&rsquo;ll save them as a new version of your script.
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

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={apply}
              disabled={staged.size === 0 || pending}
              className="btn-primary"
            >
              {pending
                ? "Applying…"
                : staged.size === 0
                ? "Stage some suggestions to apply"
                : `Apply ${staged.size} to script`}
            </button>
            {error && (
              <span className="text-body-sm" style={{ color: "var(--color-leadgen-red)" }}>
                {error}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
