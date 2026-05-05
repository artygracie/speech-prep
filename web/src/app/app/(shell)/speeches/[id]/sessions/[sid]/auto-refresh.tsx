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
// We also fire two kinds of wake-ups:
//
//   1. /api/sessions/wake when we suspect the transcribe job got lost
//      (uploaded > 60s with no transcript).
//   2. /api/coach/run directly when the transcript has landed but no
//      ai_reports row exists yet. This is the path the user is on
//      most of the time — Deepgram landed the transcript fast, and
//      now we need the coach to write its notes. We call coach/run
//      here rather than going through the wake handler because the
//      wake handler used to fire-and-forget the coach inner fetch,
//      which Vercel serverless kills when the wake handler returns.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type Props = {
  sessionId: string;
  // True when the report data has fully landed. Parent decides this.
  done: boolean;
  // True if we suspect the transcribe job got lost. Parent decides
  // — typically based on session age + status.
  suspectedStuck: boolean;
  // True when the transcript exists but no ai_reports row does. We
  // fire the coach route directly when this is true.
  needsCoach: boolean;
};

export function AutoRefresh({
  sessionId,
  done,
  suspectedStuck,
  needsCoach,
}: Props) {
  const router = useRouter();
  const wakeUpFiredRef = useRef(false);
  const coachFiredRef = useRef(false);

  useEffect(() => {
    if (done) return;

    // Arm 1: re-fire the transcribe job if it looks stuck.
    if (suspectedStuck && !wakeUpFiredRef.current) {
      wakeUpFiredRef.current = true;
      void fetch("/api/sessions/wake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      }).catch(() => { /* swallow — the next refresh will tell us */ });
    }

    // Arm 2: fire the coach route directly. Once per page load —
    // the route is idempotent (no-ops if a report already exists),
    // so re-firing on subsequent mounts is harmless. We don't await
    // because the coach call itself can take 15-30s and we don't
    // want to block the polling.
    if (needsCoach && !coachFiredRef.current) {
      coachFiredRef.current = true;
      void fetch("/api/coach/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      }).catch(() => { /* swallow — failure shows up as no report */ });
    }

    const interval = setInterval(() => {
      router.refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, [done, suspectedStuck, needsCoach, sessionId, router]);

  return null;
}
