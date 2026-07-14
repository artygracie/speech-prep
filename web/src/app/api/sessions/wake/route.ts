// POST /api/sessions/wake
//
// Re-fires the transcribe edge function for a session that looks stuck.
// Called by the AutoRefresh client component when a session has been
// in 'uploaded' status for longer than ~60 seconds without a transcript.
//
// We re-verify ownership server-side before forwarding to the edge
// function so a malicious caller can't trigger transcribe runs on
// other people's sessions.

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Wake hands off to transcribe (5-10s) and/or coach (15-30s). The
// default 10s timeout would silently kill those inner calls. 60s is
// enough for either to complete; the client (AutoRefresh) doesn't
// await the wake response anyway.
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  let sessionId: string | null = null;
  try {
    sessionId = (await req.json())?.session_id ?? null;
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!sessionId) return new Response("missing session_id", { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  // Confirm the user owns this session before forwarding.
  const { data: sess } = await supabase
    .from("sessions")
    .select("id, user_id, status, audio_path")
    .eq("id", sessionId)
    .maybeSingle();
  if (!sess || sess.user_id !== user.id) {
    return new Response("not found", { status: 404 });
  }
  if (!sess.audio_path) {
    return new Response("no audio yet", { status: 409 });
  }

  // Two arms:
  //   - If transcript is missing, re-fire the transcribe edge function.
  //   - If transcript exists but ai_reports doesn't, fire the coach
  //     route. We always check both so a session that's stuck on the
  //     coach step (transcript landed, coach never ran) gets unstuck
  //     by the same wake call.
  const { data: transcript } = await supabase
    .from("transcripts")
    .select("session_id")
    .eq("session_id", sessionId)
    .maybeSingle();
  const { data: report } = await supabase
    .from("ai_reports")
    .select("id")
    .eq("session_id", sessionId)
    .maybeSingle();

  const hasTranscript = !!transcript;
  const hasReport = !!report;

  // Build origin from the host header — req.headers.get("origin") is
  // null on same-origin POSTs in many browsers and the URL-derived
  // fallback can be wrong behind proxies.
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : null;

  // Run the work in parallel and await both. We can't fire-and-forget
  // on serverless — the function freezes after the response, killing
  // the inner request. The client doesn't await this wake call, so
  // holding the connection open for 30s is fine.
  const tasks: Promise<unknown>[] = [];

  if (!hasTranscript) {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/transcribe`;
    tasks.push(
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // The transcribe function requires the shared pipeline
          // secret; ownership was already verified above.
          "x-coach-trigger": process.env.COACH_TRIGGER_SECRET ?? "",
        },
        body: JSON.stringify({ session_id: sessionId }),
      }).catch((err) => {
        console.error("[wake] transcribe call failed", err);
      }),
    );
  }

  if (hasTranscript && !hasReport && origin) {
    // Forward the cookie so /api/coach/run authorizes as the same user.
    const cookieHeader = req.headers.get("cookie") ?? "";
    tasks.push(
      fetch(`${origin}/api/coach/run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader,
        },
        body: JSON.stringify({ session_id: sessionId }),
      }).catch((err) => {
        console.error("[wake] coach call failed", err);
      }),
    );
  }

  await Promise.all(tasks);

  return new Response("ok");
}
