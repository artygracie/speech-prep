// POST /api/cron/purge-recordings
//
// Deletes the audio of recordings past their retention date (see
// lib/retention.ts) and clears sessions.audio_path, so the report shows
// no playback for them. Transcripts and reports stay.
//
// Auth: `Authorization: Bearer ${CRON_SECRET}`. Without the secret set
// the route refuses everything, so deploying it deletes nothing until a
// scheduler is configured on purpose. `?dry_run=1` reports what would
// be deleted without deleting it.

import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordingExpiresAt } from "@/lib/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sessions read per page, and the most deleted in one run. A backlog
// drains over several runs rather than racing maxDuration.
const PAGE_SIZE = 500;
const MAX_PER_RUN = 2000;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const dryRun = new URL(req.url).searchParams.get("dry_run") === "1";

  const admin = createAdminClient();
  const now = Date.now();
  const expired: { id: string; path: string }[] = [];

  for (let from = 0; expired.length < MAX_PER_RUN; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("sessions")
      .select("id, speech_id, audio_path, created_at")
      .not("audio_path", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("[purge-recordings] read failed", { error: error.message });
      return new Response(`read failed: ${error.message}`, { status: 500 });
    }
    const speechIds = [...new Set(data.map((s) => s.speech_id))];
    const { data: speeches, error: spErr } = speechIds.length
      ? await admin.from("speeches").select("id, event_date").in("id", speechIds)
      : { data: [], error: null };
    if (spErr) {
      console.error("[purge-recordings] speech read failed", { error: spErr.message });
      return new Response(`read failed: ${spErr.message}`, { status: 500 });
    }
    const eventDateBySpeech = new Map(speeches.map((sp) => [sp.id, sp.event_date]));
    for (const s of data) {
      const eventDate = eventDateBySpeech.get(s.speech_id) ?? null;
      if (s.audio_path && recordingExpiresAt(eventDate, s.created_at).getTime() <= now) {
        expired.push({ id: s.id, path: s.audio_path });
        if (expired.length >= MAX_PER_RUN) break;
      }
    }
    if (data.length < PAGE_SIZE) break;
  }

  if (dryRun || expired.length === 0) {
    return Response.json({ dryRun, expired: expired.length });
  }

  let deleted = 0;
  for (let i = 0; i < expired.length; i += 100) {
    const batch = expired.slice(i, i + 100);
    const { error: rmErr } = await admin.storage
      .from("recordings")
      .remove(batch.map((b) => b.path));
    if (rmErr) {
      console.error("[purge-recordings] storage remove failed", { error: rmErr.message });
      return new Response(`remove failed after ${deleted}: ${rmErr.message}`, { status: 500 });
    }
    const { error: updErr } = await admin
      .from("sessions")
      .update({ audio_path: null })
      .in("id", batch.map((b) => b.id));
    if (updErr) {
      console.error("[purge-recordings] clear audio_path failed", { error: updErr.message });
      return new Response(`update failed after ${deleted}: ${updErr.message}`, { status: 500 });
    }
    deleted += batch.length;
  }

  console.log("[purge-recordings] done", { deleted });
  return Response.json({ dryRun, deleted });
}
