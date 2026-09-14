// Spend guards for the anonymous demo.
//
// /api/demo/report is unauthenticated by design: making someone log in
// before they can see a report is the exact leak the demo exists to fix
// (77% of signups never create a speech). That means the only thing
// standing between a scraper and our Deepgram + Anthropic bills is this
// module, so the limits are deliberately conservative.
//
// Three layers, cheapest first:
//   1. Payload caps      — rejected before any vendor call.
//   2. Per-IP burst      — in-memory, so it is per serverless instance and
//                          resets on cold start. Catches naive hammering,
//                          not a distributed attacker. Good enough because
//                          layer 3 is the real ceiling.
//   3. Global daily cap  — counted from public.events, so it is durable and
//                          shared across instances. This is what bounds the
//                          worst case in dollars.
//
// A durable per-IP limit needs a table and an IP hash; that is deliberately
// deferred until the demo is linked from ads (see the follow-up in Linear).

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, MAX_SCRIPT_CHARS } from "@/lib/demo-config";

const PER_IP_MAX = 5;
const PER_IP_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_DAILY_MAX = 400;

type Bucket = { count: number; resetAt: number };
const ipBuckets = new Map<string, Bucket>();

/** Best-effort client IP. Vercel sets x-forwarded-for; first hop is the client. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Per-instance burst limit. Returns false when the caller is over budget.
 * Prunes expired buckets opportunistically so the map can't grow unbounded.
 */
export function allowIp(ip: string, now = Date.now()): boolean {
  for (const [key, b] of ipBuckets) {
    if (b.resetAt <= now) ipBuckets.delete(key);
  }
  const existing = ipBuckets.get(ip);
  if (!existing || existing.resetAt <= now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + PER_IP_WINDOW_MS });
    return true;
  }
  if (existing.count >= PER_IP_MAX) return false;
  existing.count += 1;
  return true;
}

/**
 * Durable global ceiling, counted from the events table. Fails *open* on a
 * query error: a analytics outage should not take the demo down, and the
 * payload caps still apply.
 */
export async function withinGlobalDailyCap(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await admin
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("name", "demo_report")
      .gte("created_at", since);
    if (error) {
      console.error("[demo-limits] daily cap query failed:", error.message);
      return true;
    }
    return (count ?? 0) < GLOBAL_DAILY_MAX;
  } catch (err) {
    console.error("[demo-limits] daily cap threw:", err);
    return true;
  }
}
