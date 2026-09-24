// The lifecycle sweep. Runs hourly; sends at most one nudge per speech per
// local day, at roughly the hour nextNudge() asked for.
//
// Why this lives in the Next app rather than a Supabase edge function:
// the decision logic (`nextNudge`, `recommendNext`, `gatherSpeechSignals`)
// is app TypeScript that leans on `@/lib/alignment`. An edge function would
// need a hand-maintained Deno copy of all of it, which is exactly the
// arrangement that already causes drift between `alignment.ts` and the
// `transcribe` function's shadow copy. One implementation is worth more
// than one runtime.
//
// Authorization: Bearer CRON_SECRET, which is what .env.example has
// promised since the project was scaffolded and nothing has used until now.

import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { nextNudge, parseDateOnly, daysUntil, gatherSpeechSignals } from "@/lib/lifecycle";
import { renderEmail, isTemplateKey } from "@/lib/email/templates";
import { EmailUnavailableError, emailConfigured, sendEmail } from "@/lib/email/send";
import { SITE_URL } from "@/lib/site";
import { track } from "@/lib/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Fallback when a profile has no timezone yet. Most users are US. */
const DEFAULT_TZ = "America/Los_Angeles";
/** How far from the requested hour we still consider "now". */
const SLOT_TOLERANCE_HOURS = 1;
/** Ceiling per run, so one sweep can never surprise anyone with a burst. */
const MAX_SENDS_PER_RUN = 100;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The wall-clock hour and calendar date it is right now for this user. */
function localNow(tz: string): { hour: number; date: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    hour: Number(parts.hour),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function safeZone(tz: string | null): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

// Vercel Cron invokes the path with a GET and supplies the
// `Authorization: Bearer $CRON_SECRET` header itself. POST is kept so the
// job can also be triggered by hand or by an external scheduler.
export async function GET(req: Request): Promise<Response> {
  return runSweep(req);
}

export async function POST(req: Request): Promise<Response> {
  return runSweep(req);
}

async function runSweep(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  if (!emailConfigured()) {
    // Not an error: an unconfigured environment should no-op loudly in logs
    // rather than 500 a scheduled job every hour.
    console.warn("[cron/nudges] email not configured (RESEND_API_KEY / EMAIL_FROM); skipping");
    return Response.json({ skipped: "email_not_configured" }, { status: 200 });
  }

  const admin = createAdminClient();
  const { data: queue, error } = await admin
    .from("pending_speech_nudges")
    .select("*")
    .limit(500);

  if (error) {
    console.error("[cron/nudges] queue read failed:", error.message);
    return new Response("queue unavailable", { status: 500 });
  }

  let considered = 0;
  let sent = 0;
  let failed = 0;
  const skipped: Record<string, number> = {};
  const skip = (why: string) => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };

  for (const row of queue ?? []) {
    if (sent >= MAX_SENDS_PER_RUN) {
      skip("run_cap");
      continue;
    }
    // View columns are nullable by construction, so narrow once here and
    // work with the locals below. A row missing any of these is not
    // deliverable and should never have matched the view anyway.
    const speechId = row.speech_id;
    const userId = row.user_id;
    const email = row.email;
    const token = row.unsubscribe_token;
    if (!speechId || !userId || !email || !token) {
      skip("incomplete_row");
      continue;
    }
    considered += 1;

    const tz = safeZone(row.timezone);
    const { hour, date: localDate } = localNow(tz);

    // Expensive part. Only reached for rows the view already thinks are
    // plausible, and only for one speech at a time.
    let signals;
    try {
      signals = await gatherSpeechSignals(admin, speechId);
    } catch (err) {
      console.error(`[cron/nudges] signals failed for ${speechId}:`, err);
      skip("signals_failed");
      continue;
    }
    if (!signals) {
      skip("no_signals");
      continue;
    }

    const eventDate = row.event_date ? parseDateOnly(row.event_date) : null;

    const nudge = nextNudge(
      {
        id: speechId,
        currentVersion: row.current_version ?? 1,
        eventDate,
      },
      signals.sessions,
      signals.sections,
    );

    if (!nudge) {
      skip("nothing_due");
      continue;
    }
    if (!isTemplateKey(nudge.subjectKey)) {
      skip("unknown_key");
      continue;
    }
    // nextNudge() picks an hour (19:00, or 09:00 on the day). Only send when
    // the user's own clock is near it, which is the whole reason we store a
    // timezone: the "practice a few hours before sleep" rationale is
    // meaningless if everyone gets mail at one server hour.
    if (Math.abs(nudge.when.getHours() - hour) > SLOT_TOLERANCE_HOURS) {
      skip("wrong_hour");
      continue;
    }

    // Insert the lock BEFORE sending. A duplicate key means another run (or
    // another instance) already owns this send.
    const { error: lockErr } = await admin.from("email_sends").insert({
      user_id: userId,
      speech_id: speechId,
      subject_key: nudge.subjectKey,
      scheduled_for: localDate,
      status: "sending",
    });
    if (lockErr) {
      skip(lockErr.code === "23505" ? "already_sent" : "lock_failed");
      continue;
    }

    const unsubscribeUrl = `${SITE_URL}/api/unsubscribe?t=${token}`;
    const rendered = renderEmail(nudge.subjectKey, {
      speechTitle: row.title ?? "your speech",
      daysUntil: daysUntil(eventDate),
      actionUrl: `${SITE_URL}/app/speeches/${speechId}`,
      unsubscribeUrl,
    });

    try {
      const { id } = await sendEmail({
        to: email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        entityRef: userId,
        unsubscribeUrl,
      });
      await admin
        .from("email_sends")
        .update({ status: "sent", resend_id: id, sent_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("speech_id", speechId)
        .eq("subject_key", nudge.subjectKey)
        .eq("scheduled_for", localDate);
      await track(
        "email_sent",
        { subject_key: nudge.subjectKey, phase: nudge.phase, speech_id: speechId },
        { userId },
      );
      sent += 1;
    } catch (err) {
      failed += 1;
      // Delete the lock rather than marking it failed. PlanSeats' drip left
      // the row in place, so one transient Resend error permanently
      // suppressed that email for that user. Deleting lets the next sweep
      // retry; the dedupe key still prevents a double send.
      await admin
        .from("email_sends")
        .delete()
        .eq("user_id", userId)
        .eq("speech_id", speechId)
        .eq("subject_key", nudge.subjectKey)
        .eq("scheduled_for", localDate);
      if (err instanceof EmailUnavailableError) {
        console.error("[cron/nudges] email misconfigured, aborting run:", err.message);
        break;
      }
      console.error(`[cron/nudges] send failed for ${userId}:`, err);
    }
  }

  return Response.json({ considered, sent, failed, skipped }, { status: 200 });
}
