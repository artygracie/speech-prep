"use server";

// Session lifecycle actions:
//
//   1. createSession      — call when user hits Record. Inserts a session
//                           row in 'recording' status, returns its id +
//                           a signed upload URL into the recordings bucket.
//   2. finalizeSession    — call when MediaRecorder yields its final blob.
//                           Updates the session row with audio metadata,
//                           bumps profiles.sessions_used, kicks off the
//                           transcription edge function in the background.
//   3. deleteSession      — destructive cleanup; removes audio + row.
//
// Storage layout: {user_id}/{session_id}.{ext}.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "recordings";

function extFor(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  return "bin";
}

export async function createSession(
  speechId: string,
  mode: "with-script" | "freestyle",
): Promise<{ sessionId: string; uploadPathPrefix: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Find the speech and its current version.
  const { data: speech, error } = await supabase
    .from("speeches")
    .select("id, current_version")
    .eq("id", speechId)
    .single();
  if (error || !speech) throw error ?? new Error("Speech not found");

  // Resolve the script_version_id for the current_version.
  const { data: ver, error: verErr } = await supabase
    .from("script_versions")
    .select("id")
    .eq("speech_id", speechId)
    .eq("v", speech.current_version)
    .single();
  if (verErr || !ver) throw verErr ?? new Error("Version not found");

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
  if (sessErr || !session) throw sessErr ?? new Error("Failed to create session");

  return {
    sessionId: session.id,
    uploadPathPrefix: `${user.id}/`,
  };
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

  // Bump profile counter (best-effort).
  await supabase.rpc; // no-op, just to leave a hook later
  const { data: profile } = await supabase
    .from("profiles")
    .select("sessions_used")
    .eq("id", user.id)
    .single();
  if (profile) {
    await supabase
      .from("profiles")
      .update({ sessions_used: (profile.sessions_used ?? 0) + 1 })
      .eq("id", user.id);
  }

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
    // We don't pass auth headers — the edge function uses the service role
    // key to bypass RLS server-to-server. The session_id alone is enough
    // because the function checks ownership via that row.
    await fetch(fnUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
