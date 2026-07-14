"use server";

// Session lifecycle actions:
//
//   1. createSession      — call when user hits Record. Inserts a session
//                           row in 'recording' status, returns its id +
//                           a signed upload URL into the recordings bucket.
//                           Throws PaywallError if the user is out of
//                           free sessions and has no paid entitlement.
//   2. finalizeSession    — call when MediaRecorder yields its final blob.
//                           Updates the session row with audio metadata and
//                           kicks off the transcription edge function in the
//                           background. The session credit is NOT debited
//                           here — /api/coach/run debits on report delivery,
//                           so failed runs never burn a free session.
//   3. deleteSession      — destructive cleanup; removes audio + row.
//
// Storage layout: {user_id}/{session_id}.{ext}.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "recordings";

// Mark a session as failed without uploading audio. Called when the
// user navigates away mid-recording (the beforeunload handler in the
// recorder fires this via /api/sessions/abandon — beacons can't call
// server actions directly). Idempotent.
export async function abandonSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return; // logged out; nothing to do
  await supabase
    .from("sessions")
    .update({ status: "failed" })
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .eq("status", "recording"); // only flip from 'recording'; don't clobber an in-progress upload
}

function extFor(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  return "bin";
}

// Discriminated result so the client can branch cleanly. Server actions
// in Next 16 surface uncaught throws as opaque 500s; returning a result
// lets the recorder show a paywall CTA without seeing a server error.
export type CreateSessionResult =
  | { ok: true; sessionId: string; uploadPathPrefix: string }
  | { ok: false; reason: "paywall_no_sessions"; message: string }
  | { ok: false; reason: "paywall_wrong_speech"; message: string }
  | { ok: false; reason: "speech_not_found"; message: string }
  | { ok: false; reason: "internal"; message: string };

export async function createSession(
  speechId: string,
  mode: "with-script" | "freestyle",
): Promise<CreateSessionResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    // ---------- Profile guarantee ----------
    // The auth → profile trigger should run at signup, but if it ever
    // fails or there's a race, the entitlements view returns nothing
    // and we'd false-paywall a brand-new user. Lazy-create here.
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (!existingProfile) {
      await supabase.from("profiles").insert({
        id: user.id,
        email: user.email ?? `unknown-${user.id}@speechprep.local`,
        plan: "free",
        sessions_used: 0,
      });
    }

    // ---------- Entitlement check ----------
    // Use maybeSingle so a missing row doesn't throw — it returns null
    // and we treat that the same as "not entitled".
    const { data: ent } = await supabase
      .from("entitlements")
      .select("plan, is_entitled, free_sessions_remaining, one_shot_speech_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!ent || ent.is_entitled === false) {
      return {
        ok: false,
        reason: "paywall_no_sessions",
        message:
          "You're out of free sessions. Subscribe to keep practicing, or buy a $19 pass for this speech.",
      };
    }
    if (
      ent.plan === "single_speech" &&
      ent.one_shot_speech_id &&
      ent.one_shot_speech_id !== speechId
    ) {
      return {
        ok: false,
        reason: "paywall_wrong_speech",
        message:
          "Your $19 pass is for a different speech. Subscribe to record any speech.",
      };
    }

    // Find the speech and its current version.
    const { data: speech, error } = await supabase
      .from("speeches")
      .select("id, current_version")
      .eq("id", speechId)
      .maybeSingle();
    if (error || !speech) {
      return { ok: false, reason: "speech_not_found", message: "Speech not found." };
    }

    // Resolve the script_version_id for the current_version.
    const { data: ver, error: verErr } = await supabase
      .from("script_versions")
      .select("id")
      .eq("speech_id", speechId)
      .eq("v", speech.current_version)
      .maybeSingle();
    if (verErr || !ver) {
      return { ok: false, reason: "internal", message: "Couldn't load script version." };
    }

    const { data: session, error: sessErr } = await supabase
      .from("sessions")
      .insert({
        speech_id: speechId,
        script_version_id: ver.id,
        user_id: user.id,
        mode,
        status: "recording",
        tags: [],
      })
      .select("id")
      .single();
    if (sessErr || !session) {
      return { ok: false, reason: "internal", message: "Couldn't create the session row." };
    }

    return {
      ok: true,
      sessionId: session.id,
      uploadPathPrefix: `${user.id}/`,
    };
  } catch (err) {
    console.error("[createSession] threw", err);
    return {
      ok: false,
      reason: "internal",
      message: err instanceof Error ? err.message : "Unknown server error.",
    };
  }
}

export async function finalizeSession(args: {
  sessionId: string;
  audioPath: string;       // {user_id}/{session_id}.{ext} — already uploaded by client
  audioMime: string;
  audioBytes: number;
  durationMs: number;
  tags: { kind: string; atMs: number }[];
}): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Owner check (RLS will also enforce).
  const { data: existing } = await supabase
    .from("sessions")
    .select("id, user_id, speech_id")
    .eq("id", args.sessionId)
    .single();
  if (!existing || existing.user_id !== user.id) throw new Error("Session not found");

  // Update the session.
  const { error: upErr } = await supabase
    .from("sessions")
    .update({
      audio_path: args.audioPath,
      audio_mime: args.audioMime,
      audio_bytes: args.audioBytes,
      duration_ms: args.durationMs,
      tags: args.tags,
      status: "uploaded",
    })
    .eq("id", args.sessionId);
  if (upErr) throw upErr;

  // NOTE: no credit debit here. sessions_used is bumped by
  // /api/coach/run once the report actually lands (guarded by
  // sessions.debited_at so it can only happen once per session).

  // Kick off transcription. We don't await — it can run in the background.
  // For now this is a stub that logs; the real edge function lands when
  // the Deepgram secret is set.
  void requestTranscription(args.sessionId);

  revalidatePath(`/app/speeches/${existing.speech_id}`);
  revalidatePath(`/app/speeches/${existing.speech_id}/sessions/${args.sessionId}`);
}

// Best-effort fire-and-forget. If the edge function isn't deployed yet
// (which is the state until the user adds DEEPGRAM_API_KEY as a secret),
// this just no-ops and the session stays in 'uploaded' status.
async function requestTranscription(sessionId: string): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return;
    const fnUrl = `${supabaseUrl}/functions/v1/transcribe`;
    // The edge function requires the shared pipeline secret — it's no
    // longer an open endpoint. It uses the service role key server-to-
    // server, so no user JWT is forwarded.
    await fetch(fnUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-coach-trigger": process.env.COACH_TRIGGER_SECRET ?? "",
      },
      body: JSON.stringify({ session_id: sessionId }),
      // Don't block on a slow ASR.
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Edge function not deployed yet, or timed out kicking off — it's
    // okay, the session sits as 'uploaded' until the next attempt.
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("sessions")
    .select("audio_path, speech_id")
    .eq("id", sessionId)
    .single();
  if (!session) return;

  if (session.audio_path) {
    await supabase.storage.from(BUCKET).remove([session.audio_path]);
  }
  await supabase.from("sessions").delete().eq("id", sessionId);
  revalidatePath(`/app/speeches/${session.speech_id}`);
}

// Build a temporary signed URL for playback. Storage RLS keeps this
// scoped to the row owner.
export async function getPlaybackUrl(audioPath: string, expiresInSec = 60 * 30): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(audioPath, expiresInSec);
  if (error || !data) throw error ?? new Error("Failed to sign URL");
  return data.signedUrl;
}
