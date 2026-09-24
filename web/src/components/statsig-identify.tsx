"use client";

// Attaches the Supabase user id to the running Statsig session, so replays
// from the authed app are searchable by user instead of by anonymous
// stableID. Renders nothing; mounted once from /app/layout.tsx, which
// already resolves the user for its auth gate.

import { useEffect } from "react";
import { identifyStatsig } from "@/lib/statsig";

export function StatsigIdentify({ userId }: { userId: string }) {
  useEffect(() => {
    identifyStatsig(userId);
  }, [userId]);

  return null;
}
