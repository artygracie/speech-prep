"use client";

// Auto-draft button + review modal for the session report. Click the
// button → call previewAutoDraft → render a track-changes diff between
// current sections and the proposed v(n+1). If the user clicks "Save",
// commit it as a new version. If they cancel, nothing happens.
//
// This is the headline of the practice-revision loop made into UI: one
// click to see what your next draft looks like, one click to commit.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewAutoDraft,
  commitAutoDraft,
} from "@/app/app/coach-actions";
import { buildScriptDiff, coalesceDiff, type ScriptSection } from "@/lib/alignment";
import { DiffDocument } from "./diff-document";

type Section = {
  id: string;
  name: string;
  body: string;
  target_seconds: number;
  position: number;
};

type Preview = {
  proposed: Section[];
  current: Section[];
  appliedCount: number;
};

export function AutoDraftButton({
  sessionId,
  speechId,
  enabled,
}: {
  sessionId: string;
  speechId: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await previewAutoDraft(sessionId);
        setPreview({
          proposed: res.proposedSections,
          current: res.currentSections,
          appliedCount: res.appliedCount,
        });
        setOpen(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't draft.");
      }
    });
  }

  function commit() {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      try {
        const { newVersion } = await commitAutoDraft(sessionId, preview.proposed);
        setOpen(false);
        router.push(`/app/speeches/${speechId}?applied=v${newVersion}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save.");
      }
    });
  }

  // Compute diff lazily once we have a preview. Build a fake
  // ScriptSection[] for both sides and reuse the same script-vs-script
  // diff helper used on the version diff page.
  const diff = preview
    ? (() => {
        const oldSecs: ScriptSection[] = preview.current.map((s) => ({
          id: s.id,
          body: s.body,
          targetSeconds: s.target_seconds,
          position: s.position,
        }));
        const newSecs: ScriptSection[] = preview.proposed.map((s) => ({
          id: s.id,
          body: s.body,
          targetSeconds: s.target_seconds,
          position: s.position,
        }));
        // Section ids are the same on both sides (proposed reuses
        // current ids since edits are in-place body changes), so no
        // remapping is needed — we can pass new sections directly to
        // DiffDocument.
        return coalesceDiff(buildScriptDiff(oldSecs, newSecs));
      })()
    : [];
  const sectionList = preview
    ? preview.proposed.map((s) => ({ id: s.id, name: s.name }))
    : [];
  const scriptBodies: Record<string, string> = preview
    ? Object.fromEntries(preview.proposed.map((s) => [s.id, s.body]))
    : {};

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        className="btn-light"
        onClick={openModal}
        disabled={pending}
        style={{ fontSize: 12 }}
      >
        {pending && !open ? "Drafting…" : "Show me v(n+1) →"}
      </button>
      {error && !open && (
        <div
          className="text-caption mt-2"
          style={{ color: "var(--color-leadgen-red)" }}
        >
          {error}
        </div>
      )}

      {open && preview && (
        <div
          role="dialog"
          aria-label="Auto-drafted next version"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17,17,17,0.4)",
            zIndex: 50,
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            padding: "5vh 16px",
            overflowY: "auto",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            style={{
              background: "var(--color-canvas-white)",
              borderRadius: 12,
              maxWidth: 920,
              width: "100%",
              padding: "32px 36px",
              boxShadow: "0 10px 40px rgba(0,0,0,0.18)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 12,
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <h2 className="text-heading-lg">Your next draft</h2>
                <p
                  className="text-body mt-2"
                  style={{ color: "var(--color-muted-ash)" }}
                >
                  Track-changes view of what would change. Nothing&rsquo;s saved yet.
                </p>
              </div>
              <span
                className="text-caption"
                style={{ color: "var(--color-muted-ash)" }}
              >
                {preview.appliedCount}{" "}
                {preview.appliedCount === 1 ? "edit" : "edits"} applied
              </span>
            </div>

            {error && (
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
                {error}
              </div>
            )}

            {diff.length === 0 ? (
              <div
                className="empty-state mt-6"
                style={{ padding: "24px" }}
              >
                <p className="text-subheading">
                  Nothing to change yet.
                </p>
                <p
                  className="text-body mt-2"
                  style={{ color: "var(--color-muted-ash)" }}
                >
                  Without coach feedback or paraphrases, there&rsquo;s no
                  draft to propose. Record another take and try again.
                </p>
              </div>
            ) : (
              <div className="mt-6">
                <DiffDocument
                  diff={diff}
                  sections={sectionList}
                  mode="with-script"
                  scriptBodies={scriptBodies}
                />
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                marginTop: 24,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                className="btn-light"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={commit}
                disabled={pending || diff.length === 0}
              >
                {pending ? "Saving…" : "Save as new draft"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
