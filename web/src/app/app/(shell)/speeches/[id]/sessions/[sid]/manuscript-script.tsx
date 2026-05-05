"use client";

// ManuscriptScript — the session report's primary surface.
//
// The user's script rendered as a long-form manuscript, with coach
// suggestions and speaker deviations as inline track-changes. Three
// view modes:
//
//   "coach"   — show only coach edits (default). The user reviews and
//               accepts/rejects each one in place.
//   "spoken"  — show only speaker deviations from the script (skipped
//               lines, paraphrases, ad-libs). This is the diff view,
//               folded into the same document.
//   "both"    — show both layers simultaneously.
//
// Acceptance is local component state. By default the top N coach
// edits are accepted; the rest are pending. Click Reject on an
// accepted edit and the change reverts inline; click Accept on a
// pending edit and the change becomes part of the rendered script.
//
// On apply, accepted coach-edit ids are sent to the existing
// applySuggestionsAndRecord server action — same path as before.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applySuggestions,
  applySuggestionsAndRecord,
  applyDrillSuggestion,
} from "@/app/app/coach-actions";
import { MODE_PRIMARY_CTA, type SessionMode } from "@/lib/modes";
import type { DiffRow, WordOp } from "@/lib/alignment";

const DEFAULT_ACCEPT_COUNT = 3;

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

type SectionInput = {
  id: string;
  name: string;
  body: string;
  pacing?: {
    actualSeconds: number;
    targetSeconds: number;
    deltaSeconds: number;
  };
  memoryBand?: "word-perfect" | "mostly-there" | "rough" | "blank" | "not-reached";
};

type ViewMode = "coach" | "spoken" | "both";

type AcceptanceState = "accepted" | "pending" | "rejected";

// A run of script body rendered with inline annotations. We tokenise
// each section once per render — text → coach-edit → text → text-with-
// speaker-deviation → ... — then walk the tokens once to render JSX.
type Token =
  | { kind: "text"; text: string }
  | {
      kind: "coach-edit";
      edit: SuggestedEdit;
      original: string; // matched substring from the body (for cut/rephrase)
    }
  | {
      kind: "speaker-skipped";
      text: string;
    }
  | {
      kind: "speaker-paraphrase";
      ops: WordOp[];
    }
  | {
      kind: "speaker-improv";
      spoken: string;
    };

// ─── Tokenisation ────────────────────────────────────────────────────
//
// For each section we walk the body once, splitting on coach edit
// `before` substrings. Speaker deviations (DiffRow) don't have
// stable substring anchors against the SCRIPT body — they're
// alignment-driven. So we render speaker layers from the diff rows
// directly, separately, and the "Both" view uses both passes side
// by side. (A previous attempt to merge them into one token stream
// was deferred — the v1 of this redesign keeps the two layers
// independently rendered, with the toggle picking which one shows.)

function tokeniseCoachEdits(body: string, edits: SuggestedEdit[]): Token[] {
  // Adopts with no `before` are pure insertions at the section tail.
  // Cuts and rephrases match a verbatim before-string in the body.
  const indexed = edits
    .filter((e) => e.kind !== "drill")
    .map((edit) => {
      if (edit.kind === "adopt" && !edit.before) {
        return { edit, idx: -1, len: 0 };
      }
      if (!edit.before) return null;
      const idx = body.toLowerCase().indexOf(edit.before.toLowerCase());
      if (idx < 0) return null;
      return { edit, idx, len: edit.before.length };
    })
    .filter((x): x is { edit: SuggestedEdit; idx: number; len: number } => x !== null)
    // Sort by position; tail-appends (idx === -1) go last.
    .sort((a, b) => {
      if (a.idx < 0 && b.idx < 0) return 0;
      if (a.idx < 0) return 1;
      if (b.idx < 0) return -1;
      return a.idx - b.idx;
    });

  const tokens: Token[] = [];
  let cursor = 0;

  for (const { edit, idx, len } of indexed) {
    if (idx < 0) {
      // Adopt-tail: handled after the walk
      continue;
    }
    if (idx < cursor) continue; // overlapping; skip the later one
    if (idx > cursor) {
      tokens.push({ kind: "text", text: body.slice(cursor, idx) });
    }
    const matched = body.slice(idx, idx + len);
    tokens.push({ kind: "coach-edit", edit, original: matched });
    cursor = idx + len;
  }

  if (cursor < body.length) {
    tokens.push({ kind: "text", text: body.slice(cursor) });
  }

  // Tail-append adopts.
  for (const { edit, idx } of indexed) {
    if (idx < 0) {
      tokens.push({ kind: "coach-edit", edit, original: "" });
    }
  }

  return tokens;
}

function tokeniseSpokenDeviations(diffRows: DiffRow[], sectionId: string): Token[] {
  const rows = diffRows.filter((r) => r.sectionId === sectionId);
  const tokens: Token[] = [];
  for (const row of rows) {
    if (row.kind === "match") {
      tokens.push({ kind: "text", text: row.spoken + " " });
    } else if (row.kind === "skipped") {
      tokens.push({ kind: "speaker-skipped", text: row.written + " " });
    } else if (row.kind === "paraphrase") {
      tokens.push({ kind: "speaker-paraphrase", ops: row.ops });
    } else if (row.kind === "improv") {
      tokens.push({ kind: "speaker-improv", spoken: row.spoken + " " });
    }
  }
  return tokens;
}

// ─── Component ───────────────────────────────────────────────────────

export function ManuscriptScript({
  speechId,
  sessionId,
  mode,
  sections,
  suggestedEdits,
  diffRows,
}: {
  speechId: string;
  sessionId: string;
  mode: SessionMode;
  sections: SectionInput[];
  suggestedEdits: SuggestedEdit[];
  diffRows: DiffRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The user's choice for which annotation layer to show. Starts at
  // "coach" (default reading mode). The "spoken" / "both" toggles
  // surface alternate views of the same document.
  const [viewMode, setViewMode] = useState<ViewMode>("coach");

  // Default acceptance: top N coach edits accepted, rest pending,
  // drills always pending (drills aren't accept/reject — they're
  // a separate Drill action).
  const initialAcceptance = useMemo(() => {
    const map = new Map<string, AcceptanceState>();
    let accepted = 0;
    for (const edit of suggestedEdits) {
      if (edit.kind === "drill") {
        map.set(edit.id, "pending");
        continue;
      }
      if (accepted < DEFAULT_ACCEPT_COUNT) {
        map.set(edit.id, "accepted");
        accepted += 1;
      } else {
        map.set(edit.id, "pending");
      }
    }
    return map;
  }, [suggestedEdits]);
  const [acceptance, setAcceptance] = useState<Map<string, AcceptanceState>>(
    initialAcceptance,
  );

  function setEdit(id: string, state: AcceptanceState) {
    setAcceptance((prev) => {
      const next = new Map(prev);
      next.set(id, state);
      return next;
    });
  }

  // Group edits by section for tokenisation.
  const editsBySection = useMemo(() => {
    const map = new Map<string, SuggestedEdit[]>();
    for (const e of suggestedEdits) {
      const arr = map.get(e.section_id) ?? [];
      arr.push(e);
      map.set(e.section_id, arr);
    }
    return map;
  }, [suggestedEdits]);

  const acceptedEdits = useMemo(
    () =>
      suggestedEdits.filter(
        (e) => acceptance.get(e.id) === "accepted" && e.kind !== "drill",
      ),
    [suggestedEdits, acceptance],
  );
  const pendingDrills = useMemo(
    () => suggestedEdits.filter((e) => e.kind === "drill"),
    [suggestedEdits],
  );

  function applyAndRecord() {
    setError(null);
    startTransition(async () => {
      try {
        const ids = acceptedEdits.map((e) => e.id);
        if (ids.length > 0) {
          await applySuggestionsAndRecord(sessionId, ids);
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

  function applyOnly() {
    setError(null);
    startTransition(async () => {
      try {
        const ids = acceptedEdits.map((e) => e.id);
        if (ids.length === 0) return;
        const { newVersion } = await applySuggestions(sessionId, ids);
        router.push(`/app/speeches/${speechId}?applied=v${newVersion}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't apply.");
      }
    });
  }

  function startDrill(editId: string) {
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

  const primaryLabel = pending
    ? "Working…"
    : acceptedEdits.length === 0
    ? mode === "freestyle"
      ? "Drill again →"
      : "Record again →"
    : MODE_PRIMARY_CTA[mode];

  return (
    <>
      <style>{`
        /* ─── Layout shell ─────────────────────────────────────────── */
        .ms {
          max-width: 760px;
          margin: 0;
          padding-bottom: 96px; /* room for sticky bar */
        }

        /* ─── View toggle (sticky just under the page header) ──────── */
        .ms-toggle {
          position: sticky;
          top: 0;
          z-index: 10;
          background: var(--color-canvas-white);
          padding: 14px 0 12px;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
          border-bottom: 1px solid rgba(17,17,17,0.06);
        }
        .ms-toggle-pill {
          appearance: none;
          background: transparent;
          border: 0;
          padding: 6px 12px;
          font-size: 12.5px;
          font-weight: 500;
          color: var(--color-muted-ash);
          cursor: pointer;
          border-radius: 999px;
          transition: background 120ms ease, color 120ms ease;
        }
        .ms-toggle-pill:hover { color: var(--color-midnight-ink); }
        .ms-toggle-pill[aria-selected="true"] {
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
        }
        .ms-toggle-spacer { flex: 1; }
        .ms-toggle-meta {
          font-size: 11.5px;
          color: var(--color-muted-ash);
          letter-spacing: 0.04em;
        }

        /* ─── Section heading (with inline pacing/memory chip) ─────── */
        .ms-section { padding-top: 32px; }
        .ms-section:first-of-type { padding-top: 12px; }
        .ms-section-head {
          display: flex;
          align-items: baseline;
          gap: 12px;
          margin-bottom: 12px;
        }
        .ms-section-name {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--color-midnight-ink);
        }
        .ms-section-chip {
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0.04em;
          padding: 2px 8px;
          border-radius: 999px;
          font-variant-numeric: tabular-nums;
        }
        .ms-section-chip.green {
          background: rgba(71, 208, 150, 0.14);
          color: #1f6f48;
        }
        .ms-section-chip.gold {
          background: rgba(251,199,104,0.22);
          color: #5a4310;
        }
        .ms-section-chip.red {
          background: rgba(225,101,64,0.14);
          color: #88321a;
        }
        .ms-section-chip.indigo {
          background: rgba(50,142,250,0.10);
          color: var(--color-deep-indigo, #3a5fb1);
        }
        .ms-section-chip.muted {
          background: rgba(17,17,17,0.05);
          color: var(--color-muted-ash);
        }

        /* ─── Manuscript body ──────────────────────────────────────── */
        .ms-body {
          font-family: 'Iowan Old Style', 'Charter', Georgia, serif;
          font-size: 18px;
          line-height: 1.75;
          color: var(--color-midnight-ink);
          margin: 0;
        }

        /* ─── Track-changes inline marks (coach view) ──────────────── */
        /* Pending coach edit: track-changes visible, accept/reject in margin */
        .ms-edit {
          position: relative;
          display: inline;
        }
        .ms-edit-pending.ms-cut {
          color: rgba(17,17,17,0.5);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.55);
          text-decoration-thickness: 1.5px;
          background: rgba(225,101,64,0.06);
          border-radius: 3px;
          padding: 0 2px;
        }
        .ms-edit-pending.ms-rephrase-old {
          color: rgba(17,17,17,0.5);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.55);
          text-decoration-thickness: 1.5px;
          margin-right: 4px;
        }
        .ms-edit-pending.ms-rephrase-new {
          background: rgba(251,199,104,0.32);
          color: #4a3508;
          border-radius: 3px;
          padding: 0 4px;
        }
        .ms-edit-pending.ms-adopt {
          background: rgba(50,142,250,0.10);
          color: var(--color-deep-indigo, #3a5fb1);
          border-radius: 3px;
          padding: 0 4px;
          font-style: italic;
        }
        .ms-edit-pending.ms-adopt::before {
          content: "+ ";
          font-style: normal;
          opacity: 0.55;
          margin-right: 2px;
        }

        /* Accepted edit: change is "decided" — render the result */
        .ms-edit-accepted.ms-cut {
          color: rgba(17,17,17,0.32);
          text-decoration: line-through;
          text-decoration-color: rgba(17,17,17,0.18);
          text-decoration-thickness: 1px;
        }
        .ms-edit-accepted.ms-rephrase-new {
          color: var(--color-midnight-ink);
        }
        .ms-edit-accepted.ms-adopt {
          color: var(--color-midnight-ink);
          font-style: italic;
        }
        .ms-edit-accepted.ms-adopt::before {
          content: "+ ";
          font-style: normal;
          opacity: 0.4;
        }

        /* Rejected: hidden entirely, original text rendered as plain script */

        /* ─── Margin chip (accept/reject, drill, why) ──────────────── */
        .ms-edit-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin: 0 4px 0 6px;
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.02em;
          color: var(--color-muted-ash);
          vertical-align: 2px;
          line-height: 1;
          white-space: nowrap;
        }
        .ms-edit-btn {
          appearance: none;
          background: transparent;
          border: 1px solid rgba(17,17,17,0.18);
          color: var(--color-midnight-ink);
          padding: 3px 8px;
          border-radius: 5px;
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0.02em;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease;
        }
        .ms-edit-btn:hover { background: var(--color-whisper-gray, rgba(17,17,17,0.04)); }
        .ms-edit-btn.is-accept-active {
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
          border-color: var(--color-midnight-ink);
        }
        .ms-edit-btn.is-reject {
          color: var(--color-muted-ash);
          border-color: rgba(17,17,17,0.12);
        }
        .ms-edit-btn.is-drill {
          color: var(--color-deep-indigo, #3a5fb1);
          border-color: rgba(50,142,250,0.32);
        }
        .ms-edit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .ms-edit-reason {
          display: block;
          font-family: 'Inter', sans-serif;
          font-size: 12.5px;
          color: var(--color-muted-ash);
          margin: 4px 0 8px;
          line-height: 1.5;
          padding-left: 12px;
          border-left: 2px solid rgba(201, 154, 74, 0.4);
        }

        /* ─── Drill annotation (paragraph-level) ──────────────────── */
        .ms-drill-block {
          margin: 16px 0;
          padding: 10px 14px;
          border-left: 3px solid rgba(26, 79, 136, 0.45);
          background: rgba(26, 79, 136, 0.04);
          border-radius: 0 6px 6px 0;
        }
        .ms-drill-block-meta {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 4px;
        }
        .ms-drill-block-label {
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--color-deep-indigo, #3a5fb1);
        }
        .ms-drill-block-target {
          font-family: 'Iowan Old Style', 'Charter', Georgia, serif;
          font-size: 16.5px;
          line-height: 1.55;
          color: var(--color-midnight-ink);
          margin: 4px 0 0;
        }
        .ms-drill-block-tactic {
          font-size: 13.5px;
          color: rgba(17,17,17,0.78);
          margin-top: 8px;
          line-height: 1.5;
        }

        /* ─── Speaker layer (spoken view) ─────────────────────────── */
        .ms-spoken-skipped {
          color: rgba(17,17,17,0.4);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
        }
        .ms-spoken-paraphrase-old {
          color: rgba(17,17,17,0.45);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
          margin-right: 4px;
        }
        .ms-spoken-paraphrase-new {
          background: rgba(251,199,104,0.32);
          color: #4a3508;
          border-radius: 3px;
          padding: 0 3px;
        }
        .ms-spoken-improv {
          background: rgba(50,142,250,0.10);
          color: var(--color-deep-indigo, #3a5fb1);
          border-radius: 3px;
          padding: 0 3px;
          font-style: italic;
        }
        .ms-spoken-improv::before {
          content: "+ ";
          font-style: normal;
          opacity: 0.55;
        }

        /* ─── Sticky action bar ───────────────────────────────────── */
        .ms-bar {
          position: fixed;
          left: 0; right: 0; bottom: 0;
          z-index: 20;
          background: var(--color-canvas-white);
          border-top: 1px solid rgba(17,17,17,0.08);
          padding: 12px 24px calc(12px + env(safe-area-inset-bottom, 0px));
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          box-shadow: 0 -2px 16px rgba(17,17,17,0.04);
        }
        .ms-bar-inner {
          display: flex;
          align-items: center;
          gap: 14px;
          width: 100%;
          max-width: 760px;
        }
        .ms-bar-count {
          font-size: 13px;
          color: var(--color-muted-ash);
          flex: 1;
        }
        .ms-bar-count strong {
          color: var(--color-midnight-ink);
          font-weight: 500;
        }
        .ms-bar-error {
          font-size: 12.5px;
          color: var(--color-leadgen-red, #e16540);
          margin-right: 8px;
        }
      `}</style>

      <div className="ms">
        <div className="ms-toggle" role="tablist" aria-label="View">
          <button
            role="tab"
            aria-selected={viewMode === "coach"}
            className="ms-toggle-pill"
            onClick={() => setViewMode("coach")}
          >
            Coach edits
          </button>
          <button
            role="tab"
            aria-selected={viewMode === "spoken"}
            className="ms-toggle-pill"
            onClick={() => setViewMode("spoken")}
          >
            What you said
          </button>
          <button
            role="tab"
            aria-selected={viewMode === "both"}
            className="ms-toggle-pill"
            onClick={() => setViewMode("both")}
          >
            Both
          </button>
          <span className="ms-toggle-spacer" />
          <span className="ms-toggle-meta">
            {viewMode === "coach"
              ? `${acceptedEdits.length} of ${suggestedEdits.filter((e) => e.kind !== "drill").length} accepted`
              : viewMode === "spoken"
              ? "How your delivery diverged"
              : "Coach + speaker layers overlaid"}
          </span>
        </div>

        {sections.map((section) => {
          const sectionEdits = editsBySection.get(section.id) ?? [];
          const inlineEdits = sectionEdits.filter((e) => e.kind !== "drill");
          const drillEdits = sectionEdits.filter((e) => e.kind === "drill");
          const showCoach = viewMode === "coach" || viewMode === "both";
          const showSpoken = viewMode === "spoken" || viewMode === "both";

          // Coach-layer tokens use the script body as the source of truth.
          const coachTokens = showCoach
            ? tokeniseCoachEdits(section.body, inlineEdits)
            : null;
          // Spoken-layer tokens use the diff rows for this section.
          const spokenTokens = showSpoken
            ? tokeniseSpokenDeviations(diffRows, section.id)
            : null;

          return (
            <section key={section.id} className="ms-section">
              <header className="ms-section-head">
                <span className="ms-section-name">{section.name}</span>
                <SectionChip section={section} mode={mode} />
              </header>

              {/* Coach layer */}
              {coachTokens && (
                <p className="ms-body">
                  {coachTokens.length === 0 ? (
                    <span>{section.body}</span>
                  ) : (
                    coachTokens.map((tok, i) => (
                      <CoachToken
                        key={i}
                        token={tok}
                        acceptance={acceptance}
                        onSetEdit={setEdit}
                      />
                    ))
                  )}
                </p>
              )}

              {/* Drill annotations (paragraph-level — they don't fit
                  inline). Always shown when there are drills for the
                  section, regardless of view mode. */}
              {drillEdits.map((edit) => (
                <div key={edit.id} className="ms-drill-block">
                  <div className="ms-drill-block-meta">
                    <span className="ms-drill-block-label">Drill</span>
                    <button
                      type="button"
                      onClick={() => startDrill(edit.id)}
                      disabled={pending}
                      className="ms-edit-btn is-drill"
                    >
                      Drill →
                    </button>
                  </div>
                  {edit.line_target && (
                    <p className="ms-drill-block-target">
                      &ldquo;{edit.line_target}&rdquo;
                    </p>
                  )}
                  {edit.tactic && (
                    <p className="ms-drill-block-tactic">{edit.tactic}</p>
                  )}
                  {!edit.tactic && edit.reason && (
                    <p className="ms-drill-block-tactic">{edit.reason}</p>
                  )}
                </div>
              ))}

              {/* Spoken layer — rendered separately when in
                  "spoken" or "both" view. In "both" we render the
                  spoken layer as a small subhead under the script. */}
              {spokenTokens && (
                <p
                  className="ms-body"
                  style={
                    viewMode === "both"
                      ? {
                          marginTop: 12,
                          paddingTop: 12,
                          borderTop: "1px dashed rgba(17,17,17,0.10)",
                          fontSize: 16,
                          color: "rgba(17,17,17,0.78)",
                        }
                      : undefined
                  }
                >
                  {viewMode === "both" && (
                    <span
                      style={{
                        display: "block",
                        fontFamily: "Inter, sans-serif",
                        fontSize: 11,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "var(--color-muted-ash)",
                        marginBottom: 6,
                      }}
                    >
                      What you said
                    </span>
                  )}
                  {spokenTokens.length === 0 ? (
                    <span style={{ color: "var(--color-muted-ash)", fontStyle: "italic" }}>
                      — this section wasn&rsquo;t reached —
                    </span>
                  ) : (
                    spokenTokens.map((tok, i) => <SpokenToken key={i} token={tok} />)
                  )}
                </p>
              )}
            </section>
          );
        })}

        {/* Empty state when there are no sections at all */}
        {sections.length === 0 && (
          <p
            style={{
              color: "var(--color-muted-ash)",
              fontStyle: "italic",
              padding: "32px 0",
            }}
          >
            No sections to display.
          </p>
        )}
      </div>

      {/* ─── Sticky action bar ──────────────────────────────────── */}
      <div className="ms-bar">
        <div className="ms-bar-inner">
          <span className="ms-bar-count">
            {pendingDrills.length > 0
              ? `${acceptedEdits.length} ${
                  acceptedEdits.length === 1 ? "edit" : "edits"
                } accepted · ${pendingDrills.length} drill ${
                  pendingDrills.length === 1 ? "section" : "sections"
                }`
              : acceptedEdits.length === 0
              ? `No edits yet — accept some above`
              : `${acceptedEdits.length} ${
                  acceptedEdits.length === 1 ? "edit" : "edits"
                } accepted`}
          </span>
          {error && <span className="ms-bar-error">{error}</span>}
          {acceptedEdits.length > 0 && (
            <button
              type="button"
              onClick={applyOnly}
              disabled={pending}
              className="btn-light"
              style={{ fontSize: 13 }}
            >
              Apply to script only
            </button>
          )}
          <button
            type="button"
            onClick={applyAndRecord}
            disabled={pending}
            className="btn-primary"
            style={{ padding: "11px 20px", fontSize: 14 }}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Token renderers ─────────────────────────────────────────────────

function CoachToken({
  token,
  acceptance,
  onSetEdit,
}: {
  token: Token;
  acceptance: Map<string, AcceptanceState>;
  onSetEdit: (id: string, state: AcceptanceState) => void;
}) {
  if (token.kind === "text") {
    return <span>{token.text}</span>;
  }
  if (token.kind !== "coach-edit") {
    // Shouldn't happen in coach-layer rendering, but fall through cleanly.
    return null;
  }
  const { edit, original } = token;
  const state = acceptance.get(edit.id) ?? "pending";

  // Rejected: render the original text as if the edit didn't exist.
  if (state === "rejected") {
    if (edit.kind === "cut" || edit.kind === "rephrase") {
      return <span>{original}</span>;
    }
    // Adopt rejected → render nothing
    return null;
  }

  if (edit.kind === "cut") {
    return (
      <span className="ms-edit">
        <span className={`ms-edit-pending ms-cut${state === "accepted" ? " ms-edit-accepted" : ""}`}>
          {original}
        </span>
        <EditChip edit={edit} state={state} onSetEdit={onSetEdit} />
      </span>
    );
  }
  if (edit.kind === "rephrase") {
    return (
      <span className="ms-edit">
        {state === "pending" && (
          <span className="ms-edit-pending ms-rephrase-old">{original}</span>
        )}
        <span
          className={`ms-edit-pending ms-rephrase-new${state === "accepted" ? " ms-edit-accepted" : ""}`}
        >
          {edit.after}
        </span>
        <EditChip edit={edit} state={state} onSetEdit={onSetEdit} />
      </span>
    );
  }
  if (edit.kind === "adopt") {
    return (
      <span className="ms-edit">
        {" "}
        <span
          className={`ms-edit-pending ms-adopt${state === "accepted" ? " ms-edit-accepted" : ""}`}
        >
          {edit.after}
        </span>
        <EditChip edit={edit} state={state} onSetEdit={onSetEdit} />
      </span>
    );
  }
  return null;
}

function EditChip({
  edit,
  state,
  onSetEdit,
}: {
  edit: SuggestedEdit;
  state: AcceptanceState;
  onSetEdit: (id: string, state: AcceptanceState) => void;
}) {
  return (
    <span className="ms-edit-chip">
      <button
        type="button"
        className={`ms-edit-btn${state === "accepted" ? " is-accept-active" : ""}`}
        onClick={() =>
          onSetEdit(edit.id, state === "accepted" ? "pending" : "accepted")
        }
        title={edit.reason}
      >
        {state === "accepted" ? "Accepted" : "Accept"}
      </button>
      {state !== "rejected" && (
        <button
          type="button"
          className="ms-edit-btn is-reject"
          onClick={() => onSetEdit(edit.id, "rejected")}
          title="Reject this suggestion"
        >
          Reject
        </button>
      )}
    </span>
  );
}

function SpokenToken({ token }: { token: Token }) {
  if (token.kind === "text") return <span>{token.text}</span>;
  if (token.kind === "speaker-skipped") {
    return <span className="ms-spoken-skipped">{token.text}</span>;
  }
  if (token.kind === "speaker-improv") {
    return <span className="ms-spoken-improv">{token.spoken}</span>;
  }
  if (token.kind === "speaker-paraphrase") {
    return (
      <>
        {token.ops.map((op, i) => {
          if (op.kind === "equal") return <span key={i}>{op.text} </span>;
          if (op.kind === "del") {
            return (
              <span key={i} className="ms-spoken-paraphrase-old">
                {op.written}{" "}
              </span>
            );
          }
          if (op.kind === "ins") {
            return (
              <span key={i} className="ms-spoken-paraphrase-new">
                {op.spoken}{" "}
              </span>
            );
          }
          // sub
          return (
            <span key={i}>
              <span className="ms-spoken-paraphrase-old">{op.written}</span>
              <span className="ms-spoken-paraphrase-new">{op.spoken}</span>{" "}
            </span>
          );
        })}
      </>
    );
  }
  return null;
}

function SectionChip({
  section,
  mode,
}: {
  section: SectionInput;
  mode: SessionMode;
}) {
  // From-memory mode: show the memory band, not pacing — recall is
  // the user's primary lens here.
  if (mode === "freestyle" && section.memoryBand) {
    const band = section.memoryBand;
    const label =
      band === "word-perfect"
        ? "word-perfect"
        : band === "mostly-there"
        ? "mostly there"
        : band === "rough"
        ? "rough — drill this"
        : band === "blank"
        ? "blanked"
        : "not reached";
    const color =
      band === "word-perfect"
        ? "green"
        : band === "mostly-there"
        ? "indigo"
        : band === "rough"
        ? "gold"
        : band === "blank"
        ? "red"
        : "muted";
    return <span className={`ms-section-chip ${color}`}>{label}</span>;
  }
  // Script-visible mode: show pacing.
  if (section.pacing) {
    const { actualSeconds, targetSeconds, deltaSeconds } = section.pacing;
    const sign = deltaSeconds > 0 ? "+" : deltaSeconds < 0 ? "−" : "";
    const abs = Math.abs(deltaSeconds);
    const color =
      Math.abs(deltaSeconds) <= 5
        ? "green"
        : deltaSeconds > 0
        ? "red"
        : "gold";
    return (
      <span className={`ms-section-chip ${color}`}>
        {fmtSec(actualSeconds)} / {fmtSec(targetSeconds)} · {sign}
        {abs}s
      </span>
    );
  }
  return null;
}

function fmtSec(s: number): string {
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
