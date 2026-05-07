// POST /api/admin/drafts/send-approval
//
// Re-sends the review-request email for a draft that is still
// awaiting_review. Called by the cron job (after 48 h of silence) or
// manually from the admin panel.
//
// Auth: X-Internal-Key header must match the X_INTERNAL_KEY env var.
// The endpoint is intentionally NOT behind Supabase auth so the cron
// job can call it without a user session.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const key = process.env.X_INTERNAL_KEY;
  return !!key && req.headers.get("x-internal-key") === key;
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  let draftId: string | null = null;
  try {
    draftId = (await req.json())?.draftId ?? null;
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!draftId) return new Response("missing draftId", { status: 400 });

  const supabase = createAdminClient();
  const { data: draft } = await supabase
    .from("drafts")
    .select("id, title, pr_number")
    .eq("id", draftId)
    .eq("status", "awaiting_review")
    .maybeSingle();

  if (!draft) return new Response("draft not found or not awaiting review", { status: 404 });

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error("[send-approval] RESEND_API_KEY not set");
    return new Response("email service not configured", { status: 500 });
  }

  const reviewUrl = `https://www.speechprep.ai/admin/drafts/${draft.id}`;
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "SpeechPrep <noreply@speechprep.ai>",
      to: ["gracie@artygroup.com"],
      subject: `Review needed: ${draft.title}`,
      text: [
        `A draft is waiting for your approval.`,
        ``,
        `Title:  ${draft.title}`,
        `PR:     #${draft.pr_number ?? "N/A"}`,
        ``,
        `Review it here: ${reviewUrl}`,
        ``,
        `This reminder was sent because no action was taken within 48 hours.`,
      ].join("\n"),
    }),
  });

  if (!emailRes.ok) {
    const body = await emailRes.text();
    console.error("[send-approval] Resend error:", emailRes.status, body);
    return new Response("email send failed", { status: 502 });
  }

  return new Response("ok");
}
