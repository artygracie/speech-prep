// POST /api/t — minimal first-party event beacon.
//
// For client-side funnel events (navigator.sendBeacon / fetch keepalive).
// Body: JSON { name, props?, anon_id? }. The name must be on the allowlist
// in src/lib/events.ts; anything else is dropped silently. The user, when
// logged in, is resolved from the session cookie server-side — the client
// cannot spoof someone else's user_id.
//
// Always returns 200 (beacon responses are never read); failures are logged.
// Manual check: see docs/analytics.md → "Verifying /api/t".

import { createClient } from "@/lib/supabase/server";
import { isEventName } from "@/lib/events";
import { track } from "@/lib/track";
import type { Json } from "@/types/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep payloads honest — props beyond this are dropped, not truncated,
// so a partial (corrupt) object never lands in the funnel.
const MAX_PROPS_BYTES = 2048;
const MAX_ANON_ID_LENGTH = 64;

export async function POST(req: Request): Promise<Response> {
  try {
    // sendBeacon posts as text/plain or Blob — parse the raw text.
    const raw = await req.text();
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return new Response("ok");
    }
    if (typeof body !== "object" || body === null) return new Response("ok");

    const { name, props, anon_id } = body as Record<string, unknown>;
    if (!isEventName(name)) return new Response("ok");

    let cleanProps: Record<string, Json> = {};
    if (
      props &&
      typeof props === "object" &&
      !Array.isArray(props) &&
      JSON.stringify(props).length <= MAX_PROPS_BYTES
    ) {
      cleanProps = props as Record<string, Json>;
    }

    const anonId =
      typeof anon_id === "string" && anon_id.length <= MAX_ANON_ID_LENGTH
        ? anon_id
        : null;

    // Resolve the user from the session cookie (may be absent for demo/
    // pre-auth events). Never trust a user id from the payload.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await track(name, cleanProps, { userId: user?.id ?? null, anonId });
  } catch (err) {
    console.error("[api/t] failed", err);
  }
  return new Response("ok");
}
