"use client";

// Auto-refresh while the report is still landing.
//
// The session report is server-rendered. When the user lands on it
// immediately after stopping a recording, the transcript and coach
// haven't necessarily finished yet — we render the page in a polite
// "transcribing…" state and historically asked the user to refresh.
//
// This component polls the page in the background instead. It calls
// router.refresh() on a 3-second interval as long as `done` is false,
// which re-runs the server component and pulls fresh DB state. Once
// the data lands, the parent stops rendering this component and the
// polling stops.
//
// We also fire a one-time "wake up" call to /api/sessions/transcribe
// for sessions that look stuck (uploaded for >60s with no transcript).
// The transcribe edge function is idempotent — calling it twice on the
// same session just re-runs the same work.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type Props = {
  sessionId: string;
  // True when the report data has fully landed. Parent decides this.
  done: boolean;
  // True if we suspect the transcribe job got lost. Parent decides
  // — typically based on session age + status.
  suspectedStuck: boolean;
};

export function AutoRefresh({ sessionId, done, suspectedStuck }: Props) {
  const router = useRouter();
  const wakeUpFiredRef = useRef(false);

  useEffect(() => {
    if (done) return;

    // Fire a wake-up at most once per page load if we think the
    // pipeline got lost. Best-effort; we don't await or handle errors
    // — the next router.refresh() will surface any progress.
    if (suspectedStuck && !wakeUpFiredRef.current) {
      wakeUpFiredRef.current = true;
      void fetch("/api/sessions/wake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      }).catch(() => { /* swallow — the next refresh will tell us */ });
    }

    const interval = setInterval(() => {
      router.refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, [done, suspectedStuck, sessionId, router]);

  return null;
}
