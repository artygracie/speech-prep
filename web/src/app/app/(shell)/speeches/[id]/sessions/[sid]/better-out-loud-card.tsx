"use client";

// BetterOutLoudCard — Script-visible mode hero panel.
//
// Surfaces moments the speaker improvised something off-script that
// landed well. Each item is a candidate for adoption into the next
// script revision. This is the magic feature for Script-visible mode:
// it turns the act of practicing aloud into the act of editing.
//
// Source: DiffRow.kind === "improv" rows from the alignment, filtered
// to non-trivial content (≥3 words). Trivial improvs ("um", "yeah") are
// dropped — they're disfluencies, not lines worth adopting.
//
// Action: "Adopt into script →" creates an ad-hoc adopt-kind suggested
// edit and applies it via the existing applyAdHocAdopt server action.
// The user lands on the speech page with a confirmation.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyAdHocAdopt } from "@/app/app/coach-actions";

export type BetterOutLoudItem = {
  // Stable id derived from section + position so accept tracking can
  // dedupe across re-renders.
  id: string;
  sectionId: string;
  sectionName: string;
  spoken: string;
};

export function BetterOutLoudCard({
  sessionId,
  items,
}: {
  sessionId: string;
  items: BetterOutLoudItem[];
}) {
  const router = useRouter();
  const [adoptedIds, setAdoptedIds] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return null;

  function adopt(item: BetterOutLoudItem) {
    setError(null);
    startTransition(async () => {
      try {
        const { newVersion } = await applyAdHocAdopt(
          sessionId,
          item.sectionId,
          item.spoken,
        );
        setAdoptedIds((prev) => new Set(prev).add(item.id));
        // Soft refresh — keeps the user on the report so they can
        // adopt more before navigating away.
        router.refresh();
        // Stash the new version in the URL hash so the speech page
        // can show a "v(N) created" toast if the user navigates back
        // shortly after. (Soft signal; not load-bearing.)
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", `?adopted=v${newVersion}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't adopt.");
      }
    });
  }

  return (
    <section className="mt-10">
      <style>{`
        .bol-card {
          background: var(--color-canvas-white);
          border: 1px solid rgba(50,142,250,0.16);
          border-radius: 12px;
          padding: 28px 32px;
          max-width: 760px;
        }
        @media (max-width: 720px) { .bol-card { padding: 22px 20px; } }
        .bol-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--color-deep-indigo, #3a5fb1);
          margin-bottom: 6px;
        }
        .bol-header-prose {
          font-size: 13.5px;
          color: var(--color-muted-ash);
          margin: 0 0 18px;
          max-width: 540px;
          line-height: 1.5;
        }
        .bol-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 18px;
          align-items: flex-start;
          padding: 16px 0;
        }
        .bol-row + .bol-row { border-top: 1px solid rgba(17,17,17,0.05); }
        .bol-section {
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--color-muted-ash);
          margin-bottom: 6px;
        }
        .bol-spoken {
          font-family: var(--font-script);
          font-size: 16.5px;
          line-height: 1.55;
          color: var(--color-deep-indigo, #3a5fb1);
          font-style: italic;
          margin: 0;
        }
        .bol-spoken::before {
          content: "+ ";
          font-style: normal;
          opacity: 0.55;
          margin-right: 2px;
        }
        .bol-action {
          appearance: none;
          background: transparent;
          border: 1px solid rgba(50,142,250,0.32);
          padding: 8px 14px;
          border-radius: 7px;
          font-size: 12.5px;
          font-weight: 500;
          color: var(--color-deep-indigo, #3a5fb1);
          cursor: pointer;
          white-space: nowrap;
          transition: background 120ms ease;
        }
        .bol-action:hover:not(:disabled) {
          background: rgba(50,142,250,0.06);
        }
        .bol-action.is-adopted {
          background: rgba(50,142,250,0.12);
          border-color: rgba(50,142,250,0.5);
        }
        .bol-action:disabled { opacity: 0.5; cursor: not-allowed; }
        .bol-error {
          margin-top: 12px;
          font-size: 12.5px;
          color: var(--color-leadgen-red, #e16540);
        }
      `}</style>
      <div className="bol-card">
        <div className="bol-label">Better out loud</div>
        <p className="bol-header-prose">
          You said these off the cuff and they landed. Adopt them into the script
          so the next take builds on what worked.
        </p>
        {items.map((item) => {
          const adopted = adoptedIds.has(item.id);
          return (
            <div key={item.id} className="bol-row">
              <div>
                <div className="bol-section">{item.sectionName}</div>
                <p className="bol-spoken">&ldquo;{item.spoken}&rdquo;</p>
              </div>
              <button
                type="button"
                onClick={() => adopt(item)}
                disabled={pending || adopted}
                className={`bol-action ${adopted ? "is-adopted" : ""}`}
              >
                {adopted ? "Adopted ✓" : "Adopt into script →"}
              </button>
            </div>
          );
        })}
        {error && <div className="bol-error">{error}</div>}
      </div>
    </section>
  );
}
