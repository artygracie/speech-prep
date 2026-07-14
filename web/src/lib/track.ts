// Server-side funnel tracking. Writes to public.events via the service-role
// client — the events table has no client-facing RLS policies, so this module
// (and the /api/t beacon route that wraps it) is the only write path.
//
// track() never throws: analytics must never take down a user-facing flow.
// Failures are logged and swallowed. Callers can `await track(...)` (route
// handlers / server actions, guarantees the insert happens before the
// response) — don't `void`-fire it on serverless, the platform may freeze the
// lambda before the insert lands.
//
// Event names live in src/lib/events.ts. Funnel queries over this table live
// in docs/analytics.md.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventName } from "@/lib/events";
import type { Json } from "@/types/database.types";

type TrackOptions = {
  userId?: string | null;
  /** Client-generated id for pre-auth events (demo flows, Wave 2). */
  anonId?: string | null;
};

export async function track(
  name: EventName,
  props: Record<string, Json | undefined> = {},
  { userId = null, anonId = null }: TrackOptions = {},
): Promise<void> {
  try {
    const admin = createAdminClient();
    // JSON-roundtrip drops `undefined` values so optional props can be passed
    // unconditionally at call sites.
    const cleanProps = JSON.parse(JSON.stringify(props)) as Json;
    const { error } = await admin.from("events").insert({
      name,
      props: cleanProps,
      user_id: userId,
      anon_id: anonId,
    });
    if (error) {
      console.error(`[track] insert failed for "${name}":`, error.message);
    }
  } catch (err) {
    console.error(`[track] threw for "${name}":`, err);
  }
}

// ---------------------------------------------------------------------------
// Named helpers for the recording/report pipeline and billing.
//
// These exist so the owning workstreams add exactly one line at each call
// site (see docs/analytics.md → "Pipeline integration"):
//
//   - trackSessionStarted   → sessions-actions.ts createSession, after the
//                             session row inserts successfully
//   - trackSessionUploaded  → sessions-actions.ts finalizeSession, after the
//                             row flips to 'uploaded'
//   - trackReportDelivered  → ai-coach.ts, after the ai_reports row is written
//   - trackCheckoutOpened   → billing-actions.ts, after Stripe returns a
//                             checkout session URL
// ---------------------------------------------------------------------------

export function trackSessionStarted(
  userId: string,
  props: { speech_id: string; session_id: string; mode: string },
): Promise<void> {
  return track("session_started", props, { userId });
}

export function trackSessionUploaded(
  userId: string,
  props: { speech_id: string; session_id: string; duration_ms?: number },
): Promise<void> {
  return track("session_uploaded", props, { userId });
}

export function trackReportDelivered(
  userId: string,
  props: { speech_id?: string; session_id: string },
): Promise<void> {
  return track("report_delivered", props, { userId });
}

export function trackCheckoutOpened(
  userId: string,
  props: { plan: string; speech_id?: string },
): Promise<void> {
  return track("checkout_opened", props, { userId });
}
