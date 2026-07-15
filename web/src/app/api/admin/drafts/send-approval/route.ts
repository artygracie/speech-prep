import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftRow = { id: string; title: string; pr_number: number | null };

export async function POST(req: Request): Promise<Response> {
  const internalKey = req.headers.get("x-internal-key");
  if (!process.env.INTERNAL_KEY || internalKey !== process.env.INTERNAL_KEY) {
    return new Response("unauthorized", { status: 401 });
  }

  let draftId: string | undefined;
  try {
    const body = await req.json();
    draftId = body?.draftId;
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!draftId) return new Response("missing draftId", { status: 400 });

  // The drafts tables aren't in the generated Database types (the
  // feature's schema hasn't shipped to production) — use an untyped
  // view of the client for these calls rather than scattering
  // suppressions through the query chain.
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: draft, error } = await admin
    .from("drafts")
    .select("id, title, pr_number")
    .eq("id", draftId)
    .maybeSingle();

  if (error || !draft) return new Response("not found", { status: 404 });

  const { title, pr_number } = draft as DraftRow;
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://speechprep.ai";
  const reviewUrl = `${base}/admin/drafts/${draftId}`;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "SpeechPrep <noreply@speechprep.ai>",
      to: "gracie@artygroup.com",
      subject: `Reminder: draft awaiting review — "${title}"`,
      html: `<p>This draft is still awaiting your review${pr_number ? ` (PR #${pr_number})` : ""}.</p><p><a href="${reviewUrl}">Review now →</a></p>`,
    }),
  });

  if (!emailRes.ok) {
    const text = await emailRes.text();
    console.error("[send-approval] Resend error", emailRes.status, text);
    return new Response("email failed", { status: 502 });
  }

  return new Response("ok", { status: 200 });
}
