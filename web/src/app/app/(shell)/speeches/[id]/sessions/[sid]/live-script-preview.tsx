"use client";

// LiveScriptPreview — sticky right-rail companion to the Coach card.
//
// As the user picks/unpicks edits in the Coach card, the rail renders
// the resulting v(n+1) script body inline with track-changes marks:
//   - cut    → spoken text struck through in red
//   - adopt  → new text inserted in indigo italic with leading "+"
//   - rephrase → old struck through, new in soft gold
//   - drill  → no script change; render as a small "drill" tag in the
//              section header so the user sees that section is being
//              drilled but not rewritten
//
// This is the convergence loop made visible: pick an edit and the
// script transforms. The "Apply & record →" button on the Coach card
// then commits exactly what the rail shows.
//
// Hidden on mobile (<1100px) — the page is already a single scroll
// column there.

import { useMemo } from "react";
import { usePickedEdits } from "./picked-edits-context";

type Section = {
  id: string;
  name: string;
  body: string;
};

type SuggestedEdit = {
  id: string;
  kind: "cut" | "adopt" | "rephrase" | "drill";
  section_id: string;
  before?: string;
  after?: string;
};

// Render-time fragments for a section body with picked edits applied.
// We don't mutate the string in-place; instead we produce an array of
// segments tagged with their visual treatment, so we can render with
// inline JSX (struck-through spans, etc.) and keep the layout fluid.
type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "cut"; text: string }
  | { kind: "rephrase-old"; text: string }
  | { kind: "rephrase-new"; text: string }
  | { kind: "adopt"; text: string };

function buildPreviewSegments(
  body: string,
  picked: SuggestedEdit[],
): BodySegment[] {
  // Sort the picked edits so we apply them left→right within the body.
  // Each edit's `before` substring is found by case-insensitive index;
  // we walk the body once, splitting on each match.
  const edits = picked
    .filter((e) => e.kind !== "drill") // drill doesn't mutate
    .filter((e) => {
      // adopt with no before is appended — handled separately at the end
      if (e.kind === "adopt") return true;
      if (!e.before) return false;
      return body.toLowerCase().includes(e.before.toLowerCase());
    })
    .map((e) => {
      const idx = e.before
        ? body.toLowerCase().indexOf(e.before.toLowerCase())
        : -1;
      return { ...e, _idx: idx };
    })
    .sort((a, b) => {
      // adopt edits go to the end (they append). Among non-adopt,
      // earliest index first.
      if (a.kind === "adopt" && b.kind !== "adopt") return 1;
      if (b.kind === "adopt" && a.kind !== "adopt") return -1;
      return a._idx - b._idx;
    });

  const segments: BodySegment[] = [];
  let cursor = 0;

  for (const edit of edits) {
    if (edit.kind === "adopt") continue; // handled after the walk
    if (!edit.before) continue;
    // Re-find from cursor to handle overlapping matches across the
    // already-consumed prefix.
    const lower = body.toLowerCase();
    const matchIdx = lower.indexOf(edit.before.toLowerCase(), cursor);
    if (matchIdx < 0) continue;

    // Push the unchanged prefix between cursor and the match.
    if (matchIdx > cursor) {
      segments.push({ kind: "text", text: body.slice(cursor, matchIdx) });
    }

    const matched = body.slice(matchIdx, matchIdx + edit.before.length);
    if (edit.kind === "cut") {
      segments.push({ kind: "cut", text: matched });
    } else if (edit.kind === "rephrase") {
      segments.push({ kind: "rephrase-old", text: matched });
      if (edit.after) {
        segments.push({ kind: "rephrase-new", text: edit.after });
      }
    }
    cursor = matchIdx + edit.before.length;
  }

  // Trailing tail of the body, then any "adopt" edits appended at the end.
  if (cursor < body.length) {
    segments.push({ kind: "text", text: body.slice(cursor) });
  }

  for (const edit of edits) {
    if (edit.kind === "adopt" && edit.after) {
      segments.push({ kind: "adopt", text: edit.after });
    }
  }

  return segments;
}

export function LiveScriptPreview({
  sections,
  suggestedEdits,
}: {
  sections: Section[];
  suggestedEdits: SuggestedEdit[];
}) {
  const { picked } = usePickedEdits();

  // Group picked edits by section so each section's preview gets only
  // its own changes. Done eagerly inside useMemo so the segment build
  // runs on every pick toggle but stays cheap (O(n*m) substring search
  // over short bodies).
  const editsBySection = useMemo(() => {
    const map = new Map<string, SuggestedEdit[]>();
    for (const e of suggestedEdits) {
      if (!picked.has(e.id)) continue;
      const arr = map.get(e.section_id) ?? [];
      arr.push(e);
      map.set(e.section_id, arr);
    }
    return map;
  }, [picked, suggestedEdits]);

  // Per-section: how many picked edits target this section, and is any
  // of them a drill? Drills don't change the script body but do flag
  // a section as "being drilled."
  const drilledSectionIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of suggestedEdits) {
      if (!picked.has(e.id)) continue;
      if (e.kind === "drill") set.add(e.section_id);
    }
    return set;
  }, [picked, suggestedEdits]);

  // Total non-drill picked count → drives the header count.
  const changedSectionCount = useMemo(() => {
    return sections.filter((s) => (editsBySection.get(s.id)?.length ?? 0) > 0)
      .length;
  }, [sections, editsBySection]);

  return (
    <>
      <style>{`
        .lsp-rail {
          position: sticky;
          /* 52px top bar + 16px breathing room */
          top: 68px;
          padding: 22px 22px 24px;
          background: var(--color-canvas-white);
          border: 1px solid rgba(17,17,17,0.08);
          border-radius: 12px;
          max-height: calc(100vh - 88px);
          overflow-y: auto;
        }
        .lsp-label {
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.12em; text-transform: uppercase;
          color: var(--color-muted-ash);
          margin-bottom: 4px;
        }
        .lsp-subtitle {
          font-family: var(--font-script);
          font-size: 16px;
          line-height: 1.35;
          color: var(--color-midnight-ink);
          margin: 0 0 14px 0;
        }
        .lsp-empty {
          font-family: var(--font-script);
          font-size: 14.5px;
          line-height: 1.5;
          color: var(--color-muted-ash);
          font-style: italic;
          margin: 0;
        }
        .lsp-section {
          padding: 12px 0;
          border-top: 1px solid rgba(17,17,17,0.06);
        }
        .lsp-section:first-of-type { border-top: 0; padding-top: 6px; }
        .lsp-section-head {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 6px;
        }
        .lsp-section-name {
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--color-midnight-ink);
        }
        .lsp-section-tag {
          display: inline-block;
          padding: 1px 6px;
          border-radius: 999px;
          font-size: 9.5px;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          background: rgba(17,17,17,0.06);
          color: var(--color-muted-ash);
        }
        .lsp-section-tag.is-changed {
          background: rgba(71, 208, 150, 0.14);
          color: #1f6f48;
        }
        .lsp-section-tag.is-drill {
          background: rgba(26, 79, 136, 0.12);
          color: #1a4f88;
        }
        .lsp-section-body {
          font-family: 'Iowan Old Style', 'Charter', Georgia, serif;
          font-size: 13.5px;
          line-height: 1.6;
          color: var(--color-midnight-ink);
          margin: 0;
        }
        .lsp-cut {
          color: rgba(17,17,17,0.4);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
        }
        .lsp-rephrase-old {
          color: rgba(17,17,17,0.4);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
        }
        .lsp-rephrase-new {
          background: rgba(251,199,104,0.28);
          color: #4a3508;
          border-radius: 3px;
          padding: 0 3px;
        }
        .lsp-adopt {
          background: rgba(50,142,250,0.10);
          color: var(--color-deep-indigo);
          border-radius: 3px;
          padding: 0 3px;
          font-style: italic;
        }
        .lsp-adopt::before {
          content: "+ ";
          font-style: normal;
          opacity: 0.55;
        }
        .lsp-footer {
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid rgba(17,17,17,0.06);
          font-size: 12px;
          color: var(--color-muted-ash);
        }
      `}</style>

      <aside className="lsp-rail" aria-label="Next-version preview">
        <div className="lsp-label">Your next draft</div>
        <p className="lsp-subtitle">
          {picked.size === 0
            ? "Pick edits to see your script change."
            : changedSectionCount === 0 && drilledSectionIds.size > 0
            ? "No script changes — drilling only."
            : `Live preview of v(n+1) — ${changedSectionCount} ${
                changedSectionCount === 1 ? "section" : "sections"
              } changed.`}
        </p>

        {picked.size === 0 ? (
          <p className="lsp-empty">
            Your script will rewrite itself in real time as you select Coach&rsquo;s suggestions on the left.
          </p>
        ) : (
          sections.map((section) => {
            const sectionEdits = editsBySection.get(section.id) ?? [];
            const isDrilled = drilledSectionIds.has(section.id);
            const isChanged = sectionEdits.length > 0;
            const segments = isChanged
              ? buildPreviewSegments(section.body, sectionEdits)
              : null;
            return (
              <div key={section.id} className="lsp-section">
                <div className="lsp-section-head">
                  <span className="lsp-section-name">{section.name}</span>
                  {isChanged && (
                    <span className="lsp-section-tag is-changed">
                      {sectionEdits.length === 1
                        ? "1 edit"
                        : `${sectionEdits.length} edits`}
                    </span>
                  )}
                  {isDrilled && (
                    <span className="lsp-section-tag is-drill">drill</span>
                  )}
                  {!isChanged && !isDrilled && (
                    <span
                      className="lsp-section-tag"
                      style={{ background: "transparent", color: "var(--color-muted-ash)" }}
                    >
                      unchanged
                    </span>
                  )}
                </div>
                {segments && (
                  <p className="lsp-section-body">
                    {segments.map((seg, i) => (
                      <SegmentSpan key={i} seg={seg} />
                    ))}
                  </p>
                )}
              </div>
            );
          })
        )}
      </aside>
    </>
  );
}

function SegmentSpan({ seg }: { seg: BodySegment }) {
  switch (seg.kind) {
    case "text":
      return <span>{seg.text}</span>;
    case "cut":
      return <span className="lsp-cut">{seg.text}</span>;
    case "rephrase-old":
      return <span className="lsp-rephrase-old">{seg.text}</span>;
    case "rephrase-new":
      return <span className="lsp-rephrase-new">{seg.text}</span>;
    case "adopt":
      return (
        <>
          {" "}
          <span className="lsp-adopt">{seg.text}</span>
        </>
      );
  }
}
