// GET /api/cron/drafts-reminder
//
// Processes drafts that have been in 'awaiting_review' too long:
//   >= 120 h (5 days) → auto-reject: close PR, update DB, send email
//   >= 48 h, no reminder yet → nudge: call send-approval, update DB
//
// Vercel Cron invokes this daily at 15:00 UTC (9:00 AM MT) by passing
// Authorization: Bearer <CRON_SECRET>. Manual triggers may use the
// X-Internal-Key header instead.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HOURS_48 = 48;
const HOURS_120 = 120;

function authorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const internalKey = process.env.X_INTERNAL_KEY;

  const authHeader = req.headers.get("authorization") ?? "";
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  if (internalKey && req.headers.get("x-internal-key") === internalKey) return true;
  return false;
}

async function closeGithubPR(prNumber: number | null): Promise<void> {
  if (!prNumber) return;
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("[drafts-reminder] GITHUB_TOKEN not set — cannot close PR", prNumber);
    return;
  }
  const res = await fetch(
    `https://api.github.com/repos/artygracie/speech-prep/pulls/${prNumber}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ state: "closed" }),
    },
  );
  if (!res.ok) {
    console.error("[drafts-reminder] GitHub close PR failed:", prNumber, res.status, await res.text());
  }
}

async function sendRejectionEmail(title: string, resendKey: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "SpeechPrep <noreply@speechprep.ai>",
      to: ["gracie@artygroup.com"],
      subject: `Auto-rejected: ${title}`,
      text: "No review after 5 days. Re-arm from /admin/drafts/rejected if needed.",
    }),
  });
  if (!res.ok) {
    console.error("[drafts-reminder] Resend rejection email failed:", res.status, await res.text());
  }
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: drafts, error } = await supabase
    .from("drafts")
    .select("id, title, email_sent_at, reminder_sent_at, pr_number")
    .eq("status", "awaiting_review");

  if (error) {
    console.error("[drafts-reminder] DB fetch failed:", error);
    return new Response("database error", { status: 500 });
  }

  const resendKey = process.env.RESEND_API_KEY ?? "";
  const now = new Date();
  let reminders = 0;
  let rejections = 0;

  for (const draft of drafts ?? []) {
    const emailSentAt = new Date(draft.email_sent_at);
    const hoursSince = (now.getTime() - emailSentAt.getTime()) / 1_000 / 3_600;

    if (hoursSince >= HOURS_120) {
      await closeGithubPR(draft.pr_number);

      await supabase
        .from("drafts")
        .update({ status: "rejected", status_reason: "Auto-rejected after 5 days" })
        .eq("id", draft.id);

      await supabase.from("draft_revisions").insert({
        draft_id: draft.id,
        kind: "system_event",
        content: "Auto-rejected after 5 days of no review",
      });

      if (resendKey) await sendRejectionEmail(draft.title, resendKey);
      rejections++;
    } else if (hoursSince >= HOURS_48 && !draft.reminder_sent_at) {
      const origin = new URL(req.url).origin;
      await fetch(`${origin}/api/admin/drafts/send-approval`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-key": process.env.X_INTERNAL_KEY ?? "",
        },
        body: JSON.stringify({ draftId: draft.id }),
      });

      await supabase
        .from("drafts")
        .update({ reminder_sent_at: now.toISOString() })
        .eq("id", draft.id);

      await supabase.from("draft_revisions").insert({
        draft_id: draft.id,
        kind: "system_event",
        content: "Reminder sent (48h)",
      });

      reminders++;
    }
  }

  const total = drafts?.length ?? 0;
  const summary = `Checked ${total} drafts. ${reminders} reminders sent. ${rejections} auto-rejected.`;
  console.log("[drafts-reminder]", summary);
  return new Response(summary);
}
