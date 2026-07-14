import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DraftRow = {
  id: string;
  title: string;
  email_sent_at: string;
  reminder_sent_at: string | null;
  pr_number: number | null;
};

async function closePr(prNumber: number): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/artygracie/speech-prep/pulls/${prNumber}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ state: "closed" }),
    },
  );
  if (!res.ok) {
    console.warn(`[draft-reminder] close PR #${prNumber} failed: ${res.status}`);
  }
}

async function sendEmail(subject: string, html: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "SpeechPrep <noreply@speechprep.ai>",
      to: "gracie@artygroup.com",
      subject,
      html,
    }),
  });
  if (!res.ok) {
    console.warn(`[draft-reminder] email send failed: ${res.status}`);
  }
}

export async function GET(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response("unauthorized", { status: 401 });
    }
  }

  // `drafts` / `draft_revisions` aren't in the generated database types
  // yet — use the untyped client shape for these tables and cast rows
  // via DraftRow. Remove the cast once the types are regenerated.
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin
    .from("drafts")
    .select("id, title, email_sent_at, reminder_sent_at, pr_number")
    .eq("status", "awaiting_review");

  if (error) {
    console.error("[draft-reminder] fetch error", error);
    return new Response("db error", { status: 500 });
  }

  const drafts = (data ?? []) as DraftRow[];
  const now = Date.now();
  let reminders = 0;
  let rejected = 0;

  for (const { id, title, email_sent_at, reminder_sent_at, pr_number } of drafts) {
    const hoursSince = (now - new Date(email_sent_at).getTime()) / 3_600_000;
    console.log(`[draft-reminder] "${title}" (${id}): ${hoursSince.toFixed(1)}h since email`);

    if (hoursSince >= 120) {
      if (pr_number) await closePr(pr_number);

      await admin
        .from("drafts")
        .update({ status: "rejected", status_reason: "Auto-rejected after 5 days" })
        .eq("id", id);

      await admin.from("draft_revisions").insert({
        draft_id: id,
        kind: "system_event",
        content: "Auto-rejected after 5 days of no review",
      });

      await sendEmail(
        `Auto-rejected: ${title}`,
        "<p>No review after 5 days. Re-arm from /admin/drafts/rejected if needed.</p>",
      );

      console.log(`[draft-reminder] auto-rejected ${id}`);
      rejected++;
    } else if (hoursSince >= 48 && !reminder_sent_at) {
      const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://speechprep.ai";
      const nudgeRes = await fetch(`${base}/api/admin/drafts/send-approval`, {
        method: "POST",
        headers: {
          "X-Internal-Key": process.env.INTERNAL_KEY ?? "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ draftId: id }),
      });
      if (!nudgeRes.ok) {
        console.warn(`[draft-reminder] send-approval failed for ${id}: ${nudgeRes.status}`);
      }

      await admin
        .from("drafts")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", id);

      await admin.from("draft_revisions").insert({
        draft_id: id,
        kind: "system_event",
        content: "Reminder sent (48h)",
      });

      console.log(`[draft-reminder] nudged ${id}`);
      reminders++;
    } else {
      console.log(`[draft-reminder] no action (${hoursSince.toFixed(1)}h, reminder=${reminder_sent_at})`);
    }
  }

  const summary = `Checked ${drafts.length} drafts. ${reminders} reminders sent. ${rejected} auto-rejected.`;
  console.log(`[draft-reminder] ${summary}`);
  return new Response(summary, { status: 200 });
}
