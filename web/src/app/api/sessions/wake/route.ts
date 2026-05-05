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

  if (!hasTranscript) {
    // Forward to the transcribe edge function. Don't await — it can
    // take 5–10s for Deepgram to round-trip, and we want wake to
    // return quickly. The page polling will surface progress.
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/transcribe`;
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[wake] transcribe call failed", err);
    });
  }

  if (hasTranscript && !hasReport) {
    // Coach hasn't run — fire the coach route. Pass the user's session
    // cookie so /api/coach/run can authorize as the same user.
    const cookieHeader = req.headers.get("cookie") ?? "";
    const origin =
      req.headers.get("origin") ??
      `${new URL(req.url).protocol}//${new URL(req.url).host}`;
    void fetch(`${origin}/api/coach/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
      },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[wake] coach call failed", err);
    });
  }

  return new Response("ok");
}
