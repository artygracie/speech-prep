"use client";

// Drafts timeline. Renders every script_versions row for a speech as a
// vertical timeline, with auto-collapse of consecutive manual saves
// within a 5-minute window so the panel stays readable for active
// editors. Coach-applied and restored versions never collapse — they're
// the milestones.

import { useMemo, useState, useTransition } from "react";
import { restoreVersion } from "../../../actions";

type Draft = {
  id: string;
  v: number;
  summary: string | null;
  created_at: string;
  parent_version_id: string | null;
  session_count: number;
};

type Props = {
  speechId: string;
  currentVersion: number;
  drafts: Draft[]; // ordered DESC by v from the server
};

const COLLAPSE_WINDOW_MS = 5 * 60 * 1000;

// A "milestone" is a draft that should never be collapsed away — coach
// applies, restores, and the first draft of a speech all qualify. We
// detect them by summary prefix; saveScript writes the generic
// "Edited script" string, which is the only thing that gets collapsed.
function isMilestone(d: Draft): boolean {
  const s = (d.summary ?? "").toLowerCase();
  return (
    s.startsWith("applied ") ||
    s.startsWith("rolled back") ||
    s.startsWith("first draft") ||
    s.startsWith("auto-drafted")
  );
}

type DisplayDraft = Draft & { collapsedFrom: number[] };

function collapseDrafts(drafts: Draft[]): DisplayDraft[] {
  if (drafts.length === 0) return [];
  // drafts come in DESC order (newest first). We walk in that order and
  // when we see a generic "Edited script" entry that's within 5 min of
  // the entry we just kept, we attach it to that entry instead of
  // emitting a new row.
  const out: DisplayDraft[] = [];
  for (const d of drafts) {
    const last = out[out.length - 1];
    const lastIsMergeable =
      last && !isMilestone(last) && !isMilestone(d);
    const withinWindow =
      last &&
      new Date(last.created_at).getTime() -
        new Date(d.created_at).getTime() <=
        COLLAPSE_WINDOW_MS;
    if (lastIsMergeable && withinWindow) {
      last.collapsedFrom.push(d.v);
      // Move session_count up too so the merged row owns the children.
      last.session_count += d.session_count;
      continue;
    }
    out.push({ ...d, collapsedFrom: [] });
  }
  return out;
}

function fmtRel(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function summaryFor(d: DisplayDraft): string {
  if (d.summary) return d.summary;
  return "Edited script";
}

export default function DraftsPanel({ speechId, currentVersion, drafts }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const display = useMemo(() => collapseDrafts(drafts), [drafts]);
  const hasCollapsed = display.some((d) => d.collapsedFrom.length > 0);
  const visible = showAll ? drafts.map((d) => ({ ...d, collapsedFrom: [] as number[] })) : display;

  function handleRestore(v: number) {
    if (v === currentVersion) return;
    const ok = window.confirm(
      `Restore v${v} as the new current draft?\n\nThis is reversible — your current v${currentVersion} will still be there in the timeline.`,
    );
    if (!ok) return;
    setErrMsg(null);
    startTransition(async () => {
      try {
        await restoreVersion(speechId, v);
        // Server action revalidates /app/speeches/[id]; the page will
        // reflect the new currentVersion automatically.
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : "Restore failed");
      }
    });
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h2 className="text-heading">Drafts</h2>
        <span
          className="text-caption"
          style={{ color: "var(--color-muted-ash)" }}
        >
          {drafts.length} {drafts.length === 1 ? "version" : "versions"}
          {hasCollapsed && !showAll ? " · grouped" : ""}
        </span>
      </div>
      <p
        className="text-body mt-2"
        style={{ color: "var(--color-muted-ash)" }}
      >
        Every save makes a new draft. Roll back if a change made things
        worse — the rollback is itself a new draft, so you never lose
        anything.
      </p>

      {errMsg && (
        <div
          className="mt-3 text-body-sm"
          style={{
            color: "var(--color-leadgen-red)",
            background: "rgba(220, 38, 38, 0.06)",
            border: "1px solid rgba(220, 38, 38, 0.2)",
            padding: "8px 12px",
            borderRadius: 8,
          }}
        >
          {errMsg}
        </div>
      )}

      <ol
        className="mt-5"
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gap: 10,
          position: "relative",
        }}
      >
        {visible.map((d) => {
          const isCurrent = d.v === currentVersion;
          const compareHref =
            isCurrent
              ? null
              : `/app/speeches/${speechId}/versions/${d.v}/vs/${currentVersion}`;
          const groupSize = d.collapsedFrom.length;
          return (
            <li
              key={d.id}
              className="card-elevated"
              style={{
                padding: "14px 16px",
                display: "grid",
                gap: 8,
                position: "relative",
                borderLeft: isCurrent
                  ? "3px solid var(--color-deliver-green)"
                  : "3px solid transparent",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  alignItems: "baseline",
                }}
              >
                <div className="flex items-baseline gap-3">
                  <span
                    className="num"
                    style={{
                      fontSize: 18,
                      fontWeight: 500,
                    }}
                  >
                    v{d.v}
                  </span>
                  {isCurrent && (
                    <span
                      className="text-caption"
                      style={{
                        color: "var(--color-deliver-green)",
                        fontWeight: 500,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                      }}
                    >
                      Current
                    </span>
                  )}
                  {groupSize > 0 && (
                    <span
                      className="text-caption"
                      style={{
                        color: "var(--color-muted-ash)",
                      }}
                      title={`Collapsed: v${d.collapsedFrom
                        .slice()
                        .sort((a, b) => a - b)
                        .join(", v")}`}
                    >
                      +{groupSize} earlier save{groupSize > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <div
                  className="text-caption"
                  style={{ color: "var(--color-muted-ash)" }}
                >
                  {fmtRel(d.created_at)}
                </div>
              </div>

              <div className="text-body-sm">{summaryFor(d)}</div>

              <div
                className="text-caption"
                style={{ color: "var(--color-muted-ash)" }}
              >
                {d.session_count > 0
                  ? `${d.session_count} ${
                      d.session_count === 1 ? "session" : "sessions"
                    } recorded against this draft`
                  : "No sessions recorded against this draft"}
              </div>

              <div
                className="flex gap-2 mt-2"
                style={{ flexWrap: "wrap" }}
              >
                {compareHref && (
                  <a
                    href={compareHref}
                    className="btn-light"
                    style={{ fontSize: 12, padding: "6px 10px" }}
                  >
                    Compare to v{currentVersion}
                  </a>
                )}
                {!isCurrent && (
                  <button
                    type="button"
                    className="btn-light"
                    style={{ fontSize: 12, padding: "6px 10px" }}
                    disabled={pending}
                    onClick={() => handleRestore(d.v)}
                  >
                    {pending ? "Restoring…" : "Restore"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {hasCollapsed && (
        <button
          type="button"
          className="btn-light mt-4"
          style={{ fontSize: 12, padding: "6px 10px" }}
          onClick={() => setShowAll((s) => !s)}
        >
          {showAll
            ? "Group rapid saves"
            : "Show every save"}
        </button>
      )}
    </div>
  );
}
