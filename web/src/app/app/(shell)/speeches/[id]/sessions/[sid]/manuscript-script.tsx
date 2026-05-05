"use client";

// ManuscriptScript — the session report's primary surface.
//
// Two-column layout:
//   - Left: the user's script as a manuscript, with coach edits and
//     speaker deviations as inline track-changes. The manuscript is
//     reading material — no buttons, no chrome on the lines.
//   - Right: a comments rail (Google-Docs style) anchoring one card
//     per coach edit. Each card has the full reason, the kind/
//     section meta, and the Accept/Reject buttons. Drills get their
//     own card with the tactic text.
//
// Hover an inline edit mark on the left → the matching card on the
// right activates. Click an active card → the manuscript scrolls to
// the anchor and flashes it. The two columns are kept in sync via
// scroll-into-view, no virtualization or heavy state.
//
// Three view modes (toggle, sticky at the top of the manuscript):
//   "coach"   — show coach-edit marks in the manuscript + the
//               comments rail (default).
//   "spoken"  — show speaker deviations from the script in the
//               manuscript instead. The rail is hidden in this view
//               (deviations aren't actionable cards, they're
//               observations).
//   "both"    — show both layers, comments rail visible.
//
// On apply, accepted coach-edit ids are sent to the existing
// applySuggestionsAndRecord server action — same path as before.

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
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

// A run of script body rendered with inline annotations.
type Token =
  | { kind: "text"; text: string }
  | {
      kind: "coach-edit";
      edit: SuggestedEdit;
      original: string; // matched substring from the body (for cut/rephrase)
    }
  | { kind: "speaker-skipped"; text: string }
  | { kind: "speaker-paraphrase"; ops: WordOp[] }
  | { kind: "speaker-improv"; spoken: string };

// ─── Tokenisation ────────────────────────────────────────────────────

function tokeniseCoachEdits(body: string, edits: SuggestedEdit[]): Token[] {
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
    .sort((a, b) => {
      if (a.idx < 0 && b.idx < 0) return 0;
      if (a.idx < 0) return 1;
      if (b.idx < 0) return -1;
      return a.idx - b.idx;
    });

  const tokens: Token[] = [];
  let cursor = 0;

  for (const { edit, idx, len } of indexed) {
    if (idx < 0) continue;
    if (idx < cursor) continue;
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
  const [viewMode, setViewMode] = useState<ViewMode>("coach");
  const [activeEditId, setActiveEditId] = useState<string | null>(null);

  // DOM refs for the bidirectional scroll-into-view between manuscript
  // anchors and rail cards. Keyed by edit id.
  const anchorRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const cardRefs = useRef<Map<string, HTMLElement | null>>(new Map());

  const setAnchorRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) anchorRefs.current.set(id, el);
    else anchorRefs.current.delete(id);
  }, []);
  const setCardRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

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

  // Activate an edit: scroll the corresponding rail card and manuscript
  // anchor into view, mark it active for highlighting.
  const activateEdit = useCallback((editId: string, source: "manuscript" | "rail") => {
    setActiveEditId(editId);
    const otherEl =
      source === "manuscript"
        ? cardRefs.current.get(editId)
        : anchorRefs.current.get(editId);
    if (otherEl) {
      otherEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

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

  // The rail only renders when we have coach edits and the view
  // includes them. In "spoken" view we hide the rail entirely.
  const showRail =
    suggestedEdits.length > 0 && (viewMode === "coach" || viewMode === "both");

  return (
    <>
      <style>{`
        /* ─── Two-column layout ─────────────────────────────────── */
        .ms-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 32px;
          padding-bottom: 96px; /* room for sticky bar */
        }
        @media (min-width: 1100px) {
          .ms-grid.has-rail {
            grid-template-columns: minmax(0, 720px) minmax(280px, 360px);
            gap: 48px;
          }
        }

        /* ─── View toggle (sticky at top of manuscript column) ──── */
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

        /* ─── Section heading ───────────────────────────────────── */
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
        .ms-section-chip.green { background: rgba(71, 208, 150, 0.14); color: #1f6f48; }
        .ms-section-chip.gold { background: rgba(251,199,104,0.22); color: #5a4310; }
        .ms-section-chip.red { background: rgba(225,101,64,0.14); color: #88321a; }
        .ms-section-chip.indigo { background: rgba(50,142,250,0.10); color: var(--color-deep-indigo, #3a5fb1); }
        .ms-section-chip.muted { background: rgba(17,17,17,0.05); color: var(--color-muted-ash); }

        /* ─── Manuscript body ───────────────────────────────────── */
        .ms-body {
          font-family: 'Iowan Old Style', 'Charter', Georgia, serif;
          font-size: 18px;
          line-height: 1.78;
          color: var(--color-midnight-ink);
          margin: 0;
        }

        /* ─── Inline edit marks (manuscript) ─────────────────────
           No buttons in the manuscript — just visual marks that
           anchor to a card in the rail. Hovering or clicking a
           mark activates its card. */
        .ms-edit-anchor {
          cursor: pointer;
          transition: background-color 120ms ease;
        }
        .ms-edit-anchor.is-active {
          outline: 2px solid rgba(50,142,250,0.45);
          outline-offset: 2px;
          border-radius: 2px;
        }
        .ms-cut.pending {
          color: rgba(17,17,17,0.55);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.55);
          text-decoration-thickness: 1.5px;
          background: rgba(225,101,64,0.06);
          border-radius: 3px;
          padding: 0 2px;
        }
        .ms-cut.accepted {
          color: rgba(17,17,17,0.32);
          text-decoration: line-through;
          text-decoration-color: rgba(17,17,17,0.18);
          text-decoration-thickness: 1px;
        }
        .ms-rephrase-old.pending {
          color: rgba(17,17,17,0.55);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.55);
          text-decoration-thickness: 1.5px;
          margin-right: 4px;
        }
        .ms-rephrase-new.pending {
          background: rgba(251,199,104,0.32);
          color: #4a3508;
          border-radius: 3px;
          padding: 0 4px;
        }
        .ms-rephrase-new.accepted {
          color: var(--color-midnight-ink);
        }
        .ms-adopt.pending {
          background: rgba(50,142,250,0.10);
          color: var(--color-deep-indigo, #3a5fb1);
          border-radius: 3px;
          padding: 0 4px;
          font-style: italic;
        }
        .ms-adopt.pending::before {
          content: "+ ";
          font-style: normal;
          opacity: 0.55;
          margin-right: 2px;
        }
        .ms-adopt.accepted {
          color: var(--color-midnight-ink);
          font-style: italic;
        }
        .ms-adopt.accepted::before {
          content: "+ ";
          font-style: normal;
          opacity: 0.4;
        }

        /* ─── Speaker layer ─────────────────────────────────────── */
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

        /* ─── Comments rail ─────────────────────────────────────── */
        .ms-rail {
          /* On wide screens the rail sits beside the manuscript and
             scrolls independently with the page. We keep it
             non-sticky so its top aligns with the manuscript top —
             feels more like Google Docs comments than a sidebar. */
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding-top: 64px; /* matches the height of the sticky toggle */
        }
        @media (max-width: 1099px) {
          .ms-rail { padding-top: 12px; }
        }

        .ms-rail-empty {
          padding: 20px;
          font-size: 13px;
          color: var(--color-muted-ash);
          font-style: italic;
          text-align: center;
          border: 1px dashed rgba(17,17,17,0.12);
          border-radius: 8px;
        }

        /* ─── Edit card ─────────────────────────────────────────── */
        .ms-card {
          background: var(--color-canvas-white);
          border: 1px solid rgba(17,17,17,0.10);
          border-radius: 10px;
          padding: 14px 16px;
          transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
          scroll-margin-top: 80px; /* don't hide behind the toggle on scroll */
        }
        .ms-card.is-active {
          border-color: rgba(50,142,250,0.45);
          box-shadow: 0 0 0 3px rgba(50,142,250,0.10);
        }
        .ms-card.is-accepted {
          background: rgba(71, 208, 150, 0.04);
          border-color: rgba(71, 208, 150, 0.24);
        }
        .ms-card.is-rejected {
          opacity: 0.55;
        }
        .ms-card-meta {
          display: flex;
          align-items: baseline;
          gap: 8px;
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--color-muted-ash);
          margin-bottom: 8px;
        }
        .ms-card-meta strong { font-weight: 600; }
        .ms-card-meta strong.cut { color: #88321a; }
        .ms-card-meta strong.adopt { color: var(--color-deep-indigo); }
        .ms-card-meta strong.rephrase { color: #5a4310; }
        .ms-card-meta strong.drill { color: #1a4f88; }

        .ms-card-redline {
          font-family: var(--font-script);
          font-size: 14.5px;
          line-height: 1.55;
          margin: 0;
        }
        .ms-card-redline.cut {
          color: rgba(17,17,17,0.5);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
        }
        .ms-card-redline.rephrase-old {
          color: rgba(17,17,17,0.5);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
          display: block;
        }
        .ms-card-redline.rephrase-new {
          background: rgba(251,199,104,0.28);
          color: #4a3508;
          border-radius: 3px;
          padding: 1px 6px;
          display: inline-block;
          margin-top: 4px;
        }
        .ms-card-redline.adopt {
          background: rgba(50,142,250,0.08);
          color: var(--color-deep-indigo, #3a5fb1);
          border-radius: 3px;
          padding: 1px 6px;
          display: inline-block;
          font-style: italic;
        }
        .ms-card-redline.drill {
          color: var(--color-midnight-ink);
          padding-left: 10px;
          border-left: 2px solid rgba(26, 79, 136, 0.4);
        }
        .ms-card-reason {
          margin-top: 10px;
          font-size: 12.5px;
          line-height: 1.5;
          color: rgba(17,17,17,0.7);
          font-family: 'Inter', sans-serif;
        }
        .ms-card-tactic {
          margin-top: 8px;
          font-size: 13px;
          line-height: 1.5;
          color: var(--color-midnight-ink);
          font-family: 'Inter', sans-serif;
        }
        .ms-card-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
        }
        .ms-card-btn {
          appearance: none;
          background: transparent;
          border: 1px solid rgba(17,17,17,0.18);
          color: var(--color-midnight-ink);
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease;
        }
        .ms-card-btn:hover {
          background: var(--color-whisper-gray, rgba(17,17,17,0.04));
        }
        .ms-card-btn.is-accept-active {
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
          border-color: var(--color-midnight-ink);
        }
        .ms-card-btn.is-reject-active {
          background: rgba(225,101,64,0.10);
          border-color: rgba(225,101,64,0.45);
          color: #88321a;
        }
        .ms-card-btn.is-drill {
          color: var(--color-deep-indigo, #3a5fb1);
          border-color: rgba(50,142,250,0.32);
        }
        .ms-card-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* ─── Sticky action bar ─────────────────────────────────── */
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
          max-width: 1140px;
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

      <div className={`ms-grid ${showRail ? "has-rail" : ""}`}>
        {/* ─── Left column: manuscript ─────────────────────────── */}
        <div>
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
            const showCoach = viewMode === "coach" || viewMode === "both";
            const showSpoken = viewMode === "spoken" || viewMode === "both";
            const coachTokens = showCoach
              ? tokeniseCoachEdits(section.body, inlineEdits)
              : null;
            const spokenTokens = showSpoken
              ? tokeniseSpokenDeviations(diffRows, section.id)
              : null;

            return (
              <section key={section.id} className="ms-section">
                <header className="ms-section-head">
                  <span className="ms-section-name">{section.name}</span>
                  <SectionChip section={section} mode={mode} />
                </header>

                {coachTokens && (
                  <p className="ms-body">
                    {coachTokens.length === 0 ? (
                      <span>{section.body}</span>
                    ) : (
                      coachTokens.map((tok, i) => (
                        <CoachTokenSpan
                          key={i}
                          token={tok}
                          acceptance={acceptance}
                          activeEditId={activeEditId}
                          onActivate={(id) => activateEdit(id, "manuscript")}
                          setAnchorRef={setAnchorRef}
                        />
                      ))
                    )}
                  </p>
                )}

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
                      spokenTokens.map((tok, i) => <SpokenTokenSpan key={i} token={tok} />)
                    )}
                  </p>
                )}
              </section>
            );
          })}

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

        {/* ─── Right column: comments rail ─────────────────────── */}
        {showRail && (
          <aside className="ms-rail" aria-label="Coach edits">
            {suggestedEdits.length === 0 ? (
              <div className="ms-rail-empty">No suggestions for this take.</div>
            ) : (
              suggestedEdits.map((edit) => (
                <EditCard
                  key={edit.id}
                  edit={edit}
                  sectionName={
                    sections.find((s) => s.id === edit.section_id)?.name ?? "Section"
                  }
                  state={acceptance.get(edit.id) ?? "pending"}
                  isActive={activeEditId === edit.id}
                  onSetState={(s) => setEdit(edit.id, s)}
                  onActivate={() => activateEdit(edit.id, "rail")}
                  onDrill={() => startDrill(edit.id)}
                  drillPending={pending}
                  setCardRef={setCardRef}
                />
              ))
            )}
          </aside>
        )}
      </div>

      {/* ─── Sticky action bar ─────────────────────────────────── */}
      <div className="ms-bar">
        <div className="ms-bar-inner">
          <span className="ms-bar-count">
            {acceptedEdits.length === 0
              ? `No edits accepted yet`
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

// ─── Manuscript token renderers ──────────────────────────────────────

function CoachTokenSpan({
  token,
  acceptance,
  activeEditId,
  onActivate,
  setAnchorRef,
}: {
  token: Token;
  acceptance: Map<string, AcceptanceState>;
  activeEditId: string | null;
  onActivate: (id: string) => void;
  setAnchorRef: (id: string, el: HTMLElement | null) => void;
}) {
  if (token.kind === "text") return <span>{token.text}</span>;
  if (token.kind !== "coach-edit") return null;

  const { edit, original } = token;
  const state = acceptance.get(edit.id) ?? "pending";

  // Rejected: hide the change. Show the original text plain (for cut/
  // rephrase) or nothing (for adopt). No anchor — there's nothing to
  // point to.
  if (state === "rejected") {
    if (edit.kind === "cut" || edit.kind === "rephrase") {
      return <span>{original}</span>;
    }
    return null;
  }

  const isActive = activeEditId === edit.id;
  const stateClass = state === "accepted" ? "accepted" : "pending";
  const activeClass = isActive ? " is-active" : "";

  if (edit.kind === "cut") {
    return (
      <span
        ref={(el) => setAnchorRef(edit.id, el)}
        className={`ms-edit-anchor ms-cut ${stateClass}${activeClass}`}
        onClick={() => onActivate(edit.id)}
        onMouseEnter={() => onActivate(edit.id)}
      >
        {original}
      </span>
    );
  }
  if (edit.kind === "rephrase") {
    return (
      <span
        ref={(el) => setAnchorRef(edit.id, el)}
        className={`ms-edit-anchor${activeClass}`}
        onClick={() => onActivate(edit.id)}
        onMouseEnter={() => onActivate(edit.id)}
      >
        {state === "pending" && (
          <span className={`ms-rephrase-old ${stateClass}`}>{original}</span>
        )}
        <span className={`ms-rephrase-new ${stateClass}`}>{edit.after}</span>
      </span>
    );
  }
  if (edit.kind === "adopt") {
    return (
      <span
        ref={(el) => setAnchorRef(edit.id, el)}
        className={`ms-edit-anchor${activeClass}`}
        onClick={() => onActivate(edit.id)}
        onMouseEnter={() => onActivate(edit.id)}
      >
        {" "}
        <span className={`ms-adopt ${stateClass}`}>{edit.after}</span>
      </span>
    );
  }
  return null;
}

function SpokenTokenSpan({ token }: { token: Token }) {
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

// ─── Rail card ───────────────────────────────────────────────────────

function EditCard({
  edit,
  sectionName,
  state,
  isActive,
  onSetState,
  onActivate,
  onDrill,
  drillPending,
  setCardRef,
}: {
  edit: SuggestedEdit;
  sectionName: string;
  state: AcceptanceState;
  isActive: boolean;
  onSetState: (s: AcceptanceState) => void;
  onActivate: () => void;
  onDrill: () => void;
  drillPending: boolean;
  setCardRef: (id: string, el: HTMLElement | null) => void;
}) {
  const kindLabel: Record<SuggestedEdit["kind"], string> = {
    cut: "Cut",
    adopt: "Adopt",
    rephrase: "Rephrase",
    drill: "Drill",
  };
  const stateClass =
    state === "accepted"
      ? "is-accepted"
      : state === "rejected"
      ? "is-rejected"
      : "";

  return (
    <div
      ref={(el) => setCardRef(edit.id, el)}
      className={`ms-card ${stateClass}${isActive ? " is-active" : ""}`}
      onMouseEnter={() => onActivate()}
      onClick={() => onActivate()}
    >
      <div className="ms-card-meta">
        <strong className={edit.kind}>{kindLabel[edit.kind]}</strong>
        <span aria-hidden="true">·</span>
        <span>{sectionName}</span>
      </div>

      {edit.kind === "cut" && edit.before && (
        <p className="ms-card-redline cut">&ldquo;{edit.before}&rdquo;</p>
      )}
      {edit.kind === "adopt" && edit.after && (
        <p className="ms-card-redline adopt">&ldquo;{edit.after}&rdquo;</p>
      )}
      {edit.kind === "rephrase" && (
        <>
          {edit.before && (
            <span className="ms-card-redline rephrase-old">
              &ldquo;{edit.before}&rdquo;
            </span>
          )}
          {edit.after && (
            <span className="ms-card-redline rephrase-new">
              &ldquo;{edit.after}&rdquo;
            </span>
          )}
        </>
      )}
      {edit.kind === "drill" && edit.line_target && (
        <p className="ms-card-redline drill">&ldquo;{edit.line_target}&rdquo;</p>
      )}

      {edit.kind === "drill" && edit.tactic ? (
        <p className="ms-card-tactic">{edit.tactic}</p>
      ) : (
        edit.reason && <p className="ms-card-reason">{edit.reason}</p>
      )}
      {edit.kind === "drill" && edit.tactic && edit.reason && (
        <p className="ms-card-reason">{edit.reason}</p>
      )}

      <div className="ms-card-actions">
        {edit.kind === "drill" ? (
          <button
            type="button"
            className="ms-card-btn is-drill"
            onClick={(e) => {
              e.stopPropagation();
              onDrill();
            }}
            disabled={drillPending}
          >
            Drill →
          </button>
        ) : (
          <>
            <button
              type="button"
              className={`ms-card-btn${state === "accepted" ? " is-accept-active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onSetState(state === "accepted" ? "pending" : "accepted");
              }}
            >
              {state === "accepted" ? "Accepted" : "Accept"}
            </button>
            <button
              type="button"
              className={`ms-card-btn${state === "rejected" ? " is-reject-active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onSetState(state === "rejected" ? "pending" : "rejected");
              }}
            >
              {state === "rejected" ? "Rejected" : "Reject"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SectionChip({
  section,
  mode,
}: {
  section: SectionInput;
  mode: SessionMode;
}) {
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
