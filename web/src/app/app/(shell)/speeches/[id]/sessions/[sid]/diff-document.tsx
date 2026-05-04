"use client";

// DiffDocument — the said-vs-written view, rendered as a document
// rather than a stack of debugger-looking cards.
//
// Three tabs over the same underlying alignment data:
//
//   1. Diff       — the script with track-changes inline
//   2. Transcript — clean rendering of just what you said
//   3. Script     — clean rendering of just what you wrote
//
// The diff view is the primary one. It flows as continuous serif body
// text with section headings, like the script editor and the speech
// detail page. Inline:
//
//   - Words you said as written          → normal black text
//   - Words you skipped                  → strikethrough, muted
//   - Words you said differently         → original struck through,
//                                          spoken text in soft gold inline
//   - Lines you ad-libbed                → inserted in soft blue italic,
//                                          prefixed with a small "+"
//
// The whole document keeps its visual rhythm — section headings flow,
// paragraphs flow, edits sit inline like editorial marks rather than
// stacked event cards.

import { useState } from "react";
import type { DiffRow, WordOp } from "@/lib/alignment";

type Section = { id: string; name: string };

type Props = {
  diff: DiffRow[];
  sections: Section[];
  // Plain-text transcript for the Transcript tab. Optional — falls back
  // to reconstructing from the diff if not passed.
  transcriptText?: string;
  // Section bodies for the Script tab. Indexed by section id.
  scriptBodies: Record<string, string>;
};

type Tab = "diff" | "transcript" | "script";

export function DiffDocument({ diff, sections, transcriptText, scriptBodies }: Props) {
  const [tab, setTab] = useState<Tab>("diff");

  // Group diff rows by section so we can render each section as a
  // continuous prose block rather than mixing across boundaries.
  const rowsBySection = new Map<string, DiffRow[]>();
  // Improv rows can have a null sectionId — bucket those into the most
  // recently active section so they render in the right place.
  let lastSectionId: string | null = sections[0]?.id ?? null;
  for (const row of diff) {
    const sid = row.sectionId ?? lastSectionId ?? sections[0]?.id ?? "";
    if (row.sectionId) lastSectionId = row.sectionId;
    if (!rowsBySection.has(sid)) rowsBySection.set(sid, []);
    rowsBySection.get(sid)!.push(row);
  }

  // For the Transcript tab, derive the spoken text per section from
  // the same bucketed diff rows used by the Diff tab. This way the
  // Transcript tab gets the same section structure (heading + body)
  // as Diff and Script, instead of a single dump of prose. The
  // `transcriptText` prop is still accepted but is only used as a
  // fallback if we have no diff rows at all.
  function spokenForSection(sectionId: string): string {
    const rows = rowsBySection.get(sectionId) ?? [];
    if (rows.length === 0) return "";
    return rows
      .map((r) => {
        if (r.kind === "match" || r.kind === "improv") return r.spoken;
        if (r.kind === "paraphrase") return spokenFromOps(r.ops);
        return ""; // skipped rows have no spoken text
      })
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  const totalSpoken = sections
    .map((s) => spokenForSection(s.id))
    .filter(Boolean)
    .join(" ")
    .trim();
  // Fallback for the rare case where the diff is empty but we have a
  // raw transcript string from the DB.
  const fallbackTranscript =
    !totalSpoken && transcriptText && transcriptText.trim().length > 0
      ? transcriptText
      : null;

  return (
    <>
      <style>{`
        /* ===== Tabs ===== */
        .diff-tabs {
          display: inline-flex;
          gap: 2px;
          padding: 4px;
          border-radius: 10px;
          background: var(--color-whisper-gray);
          border: 1px solid rgba(17,17,17,0.06);
          margin-bottom: 18px;
        }
        .diff-tabs button {
          background: transparent;
          border: 0;
          padding: 7px 14px;
          border-radius: 7px;
          font-size: 13px;
          font-weight: 500;
          color: var(--color-muted-ash);
          cursor: pointer;
          transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease;
        }
        .diff-tabs button.is-on {
          background: var(--color-canvas-white);
          color: var(--color-midnight-ink);
          box-shadow: 0 1px 2px rgba(17,17,17,0.04);
        }

        /* ===== Document shell ===== */
        .diff-doc {
          background: var(--color-canvas-white);
          border-radius: 12px;
          border: 1px solid rgba(17,17,17,0.06);
          padding: 8px 36px 36px;
        }
        @media (max-width: 880px) { .diff-doc { padding: 8px 22px 24px; } }

        .diff-section {
          padding: 28px 0 14px;
          border-top: 1px solid rgba(17,17,17,0.06);
        }
        .diff-section:first-child { border-top: 0; }
        .diff-section-name {
          font-size: 13px;
          font-weight: 500;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--color-muted-ash);
          margin-bottom: 14px;
        }
        .diff-prose {
          font-family: 'Iowan Old Style', 'Charter', Georgia, serif;
          font-size: 18px;
          line-height: 1.75;
          color: var(--color-midnight-ink);
        }

        /* ===== Inline edit marks (Diff tab) ===== */
        .ed-skipped {
          color: rgba(17,17,17,0.36);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.55);
          text-decoration-thickness: 1.5px;
        }
        .ed-paraphrase {
          /* Bumped from 0.22 to 0.34 alpha for both visibility and
             WCAG contrast — the previous tint was too thin to read
             as "highlighted" against the white page. */
          background: rgba(251,199,104,0.34);
          border-radius: 3px;
          padding: 0 3px;
        }
        .ed-paraphrase del {
          color: rgba(17,17,17,0.36);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
          margin-right: 4px;
        }
        .ed-improv {
          background: rgba(50,142,250,0.10);
          color: var(--color-deep-indigo);
          border-radius: 3px;
          padding: 0 3px;
          font-style: italic;
        }
        .ed-improv::before {
          content: "+ ";
          opacity: 0.6;
          font-style: normal;
          font-weight: 500;
        }

        /* Empty section message */
        .diff-empty {
          font-style: italic;
          color: var(--color-muted-ash);
          font-family: 'Inter', sans-serif;
          font-size: 14px;
        }

        /* Plain prose for Transcript / Script tabs */
        .doc-prose-clean {
          font-family: 'Iowan Old Style', 'Charter', Georgia, serif;
          font-size: 18px;
          line-height: 1.75;
          color: var(--color-midnight-ink);
          white-space: pre-wrap;
        }

        /* Counts pill row at the bottom */
        .diff-counts {
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px solid rgba(17,17,17,0.06);
          display: flex; gap: 8px; flex-wrap: wrap;
        }
      `}</style>

      <div className="diff-tabs" role="tablist" aria-label="View">
        <button
          role="tab"
          aria-selected={tab === "diff"}
          className={tab === "diff" ? "is-on" : ""}
          onClick={() => setTab("diff")}
        >
          Diff
        </button>
        <button
          role="tab"
          aria-selected={tab === "transcript"}
          className={tab === "transcript" ? "is-on" : ""}
          onClick={() => setTab("transcript")}
        >
          Transcript
        </button>
        <button
          role="tab"
          aria-selected={tab === "script"}
          className={tab === "script" ? "is-on" : ""}
          onClick={() => setTab("script")}
        >
          Script
        </button>
      </div>

      {tab === "diff" ? (
        <article className="diff-doc">
          {sections.map((sec) => {
            const rows = rowsBySection.get(sec.id) ?? [];
            return (
              <section key={sec.id} className="diff-section">
                <h3 className="diff-section-name">{sec.name}</h3>
                <p className="diff-prose">
                  {rows.length === 0 ? (
                    <span className="diff-empty">— this section wasn&rsquo;t reached —</span>
                  ) : (
                    rows.map((row, i) => (
                      <DiffSpan key={i} row={row} />
                    ))
                  )}
                </p>
              </section>
            );
          })}

          <DiffCounts diff={diff} />
        </article>
      ) : tab === "transcript" ? (
        <article className="diff-doc">
          {fallbackTranscript ? (
            // Edge case: no diff rows but we have a raw transcript
            // from the DB. Fall through to a single block so the user
            // still sees something.
            <section className="diff-section">
              <h3 className="diff-section-name">What you said</h3>
              <p className="doc-prose-clean">{fallbackTranscript}</p>
            </section>
          ) : (
            sections.map((sec) => {
              const spoken = spokenForSection(sec.id);
              return (
                <section key={sec.id} className="diff-section">
                  <h3 className="diff-section-name">{sec.name}</h3>
                  <p className="doc-prose-clean">
                    {spoken || (
                      <span className="diff-empty">
                        — this section wasn&rsquo;t reached —
                      </span>
                    )}
                  </p>
                </section>
              );
            })
          )}
        </article>
      ) : (
        <article className="diff-doc">
          {sections.map((sec) => (
            <section key={sec.id} className="diff-section">
              <h3 className="diff-section-name">{sec.name}</h3>
              <p className="doc-prose-clean">
                {scriptBodies[sec.id]?.trim() || (
                  <span className="diff-empty">— empty section —</span>
                )}
              </p>
            </section>
          ))}
        </article>
      )}
    </>
  );
}

// Reconstruct what the speaker actually said from a paraphrase row's
// ops list — used for the Transcript tab.
function spokenFromOps(ops: WordOp[]): string {
  return ops
    .map((o) => {
      if (o.kind === "equal") return o.text;
      if (o.kind === "sub" || o.kind === "ins") return o.spoken;
      return ""; // del — nothing was said
    })
    .filter(Boolean)
    .join(" ");
}

// One span per diff row, rendered inline so the surrounding paragraph
// flows as continuous prose.
function DiffSpan({ row }: { row: DiffRow }) {
  if (row.kind === "match") {
    return <span>{row.spoken} </span>;
  }
  if (row.kind === "paraphrase") {
    // Render each op as its own inline mark so only the actually-changed
    // words are highlighted/struck — the unchanged words flow as normal
    // body text.
    return (
      <>
        {row.ops.map((op, i) => (
          <OpSpan key={i} op={op} />
        ))}
      </>
    );
  }
  if (row.kind === "skipped") {
    return <span className="ed-skipped">{row.written} </span>;
  }
  // improv
  return <span className="ed-improv">{row.spoken} </span>;
}

function OpSpan({ op }: { op: WordOp }) {
  if (op.kind === "equal") return <span>{op.text} </span>;
  if (op.kind === "del") {
    return (
      <>
        <span className="ed-skipped">{op.written}</span>{" "}
      </>
    );
  }
  if (op.kind === "ins") {
    return (
      <>
        <span className="ed-paraphrase">{op.spoken}</span>{" "}
      </>
    );
  }
  // sub
  return (
    <>
      <span className="ed-paraphrase">
        <del>{op.written}</del>
        {op.spoken}
      </span>{" "}
    </>
  );
}

function DiffCounts({ diff }: { diff: DiffRow[] }) {
  const m = diff.filter((r) => r.kind === "match").length;
  const p = diff.filter((r) => r.kind === "paraphrase").length;
  const s = diff.filter((r) => r.kind === "skipped").length;
  const i = diff.filter((r) => r.kind === "improv").length;
  return (
    <div className="diff-counts">
      <span className="badge pill-soft"><span className="dot" />{m} matched</span>
      <span className="badge pill-gold"><span className="dot" />{p} paraphrased</span>
      <span className="badge pill-red"><span className="dot" />{s} skipped</span>
      <span className="badge pill-blue"><span className="dot" />{i} ad-lib</span>
    </div>
  );
}
