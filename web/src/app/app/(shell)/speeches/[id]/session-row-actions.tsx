"use client";

// Tiny client component for per-session row actions on the speech
// detail page: delete (with confirm) for every session, plus a Retry
// for `failed` ones — it re-fires the transcribe pipeline through
// /api/sessions/wake (ownership is re-verified server-side there).
// Server-side delete is in sessions-actions.deleteSession.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSession } from "@/app/app/sessions-actions";

export function SessionRowActions({
  sessionId,
  status = null,
}: {
  sessionId: string;
  // sessions.status — Retry renders only for "failed".
  status?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const ok = window.confirm(
      "Delete this session?\n\nAudio + transcript will be permanently removed. This can't be undone.",
    );
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteSession(sessionId);
      } catch {
        // Server action revalidates; on failure we just leave the row.
      }
    });
  }

  function onRetry(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      try {
        const res = await fetch("/api/sessions/wake", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
        if (!res.ok) {
          // 409 = no audio was ever uploaded (e.g. a silent take) —
          // there's nothing to re-process.
          window.alert(
            res.status === 409
              ? "Nothing was recorded for this session, so there's nothing to retry. Record a fresh take instead."
              : "Couldn't retry this session. Give it a minute and try again.",
          );
          return;
        }
        router.refresh();
      } catch {
        // Network hiccup — leave the row as-is; the user can retry.
      }
    });
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {status === "failed" && (
        <button
          type="button"
          onClick={onRetry}
          disabled={pending}
          title="Retry this session"
          style={{
            background: "transparent",
            border: 0,
            color: "var(--color-deep-indigo)",
            cursor: "pointer",
            padding: "4px 6px",
            fontSize: 12,
            fontWeight: 500,
            lineHeight: 1,
            opacity: pending ? 0.4 : 1,
          }}
        >
          {pending ? "Retrying…" : "Retry"}
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        title="Delete session"
        aria-label="Delete session"
        style={{
          background: "transparent",
          border: 0,
          color: "var(--color-muted-ash)",
          cursor: "pointer",
          padding: "4px 6px",
          fontSize: 14,
          lineHeight: 1,
          opacity: pending ? 0.4 : 1,
        }}
      >
        {pending ? "…" : "✕"}
      </button>
    </span>
  );
}
