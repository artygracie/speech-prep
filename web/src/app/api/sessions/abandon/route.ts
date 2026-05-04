// POST /api/sessions/abandon
//
// Endpoint for navigator.sendBeacon, called from the recorder's
// beforeunload handler when the user closes the tab mid-recording.
// Beacons can't call server actions, so this is a thin wrapper around
// the abandonSession action — same logic, different transport.
//
// Always returns 200 (even on errors), because beacon responses are
// never read by the browser. We log failures server-side instead.

import { abandonSession } from "@/app/app/sessions-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    // Beacon sends as text/plain or as a Blob; we accept either.
    const body = await req.text();
    let sessionId: string | null = null;
    try {
      sessionId = JSON.parse(body)?.session_id ?? null;
    } catch {
      // Maybe url-encoded form data
      const params = new URLSearchParams(body);
      sessionId = params.get("session_id");
    }
    if (!sessionId) return new Response("ok");
    await abandonSession(sessionId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[abandon] failed", err);
  }
  return new Response("ok");
}
