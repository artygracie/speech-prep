"use client";

// Tiny client component for per-session row actions: just a delete
// button with a confirm. Lives next to each session card on the speech
// detail page. Server-side delete is in sessions-actions.deleteSession.

import { useTransition } from "react";
import { deleteSession } from "@/app/app/sessions-actions";

export function SessionRowActions({ sessionId }: { sessionId: string }) {
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

  return (
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
  );
}
