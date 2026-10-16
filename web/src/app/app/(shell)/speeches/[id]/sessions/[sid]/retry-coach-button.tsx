"use client";

// Re-runs the coach for a session whose notes never arrived, then
// refreshes the report. The coach route is idempotent and refuses a
// second run while one is in flight, so a double click is harmless.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RetryCoachButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "failed">("idle");

  async function retry() {
    setState("running");
    try {
      const res = await fetch("/api/coach/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      // 202 = another run holds the claim; the refresh picks up its result.
      if (!res.ok) throw new Error(`coach/run ${res.status}`);
      router.refresh();
      setState("idle");
    } catch (err) {
      console.error("[report] coach retry failed", err);
      setState("failed");
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button className="btn-light" onClick={retry} disabled={state === "running"}>
        {state === "running" ? "Writing your notes…" : "Try the coach notes again"}
      </button>
      {state === "failed" && (
        <span className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
          That didn&rsquo;t work either. Your timing and diff are still here.
        </span>
      )}
    </div>
  );
}
