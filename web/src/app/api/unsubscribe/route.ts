// One-click unsubscribe.
//
// Two methods on purpose:
//   POST — what Gmail and Yahoo call automatically when someone hits their
//          native "unsubscribe" button, per List-Unsubscribe-Post. It must
//          work with no session, no confirmation page, and no JavaScript,
//          or the mailbox provider treats the header as a lie.
//   GET  — what a person gets when they click the link in the footer.
//          Same effect, then a plain confirmation page.
//
// The token is a capability: possession is authorization. That is the point
// — the recipient is by definition not logged in, and making someone sign in
// to stop email is exactly the dark pattern the bulk-sender rules exist to
// stamp out. The token is a random uuid, unique-indexed, and revocable by
// regenerating it.

import { createAdminClient } from "@/lib/supabase/admin";
import { track } from "@/lib/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The column is uuid. Comparing it to a non-uuid string makes Postgres
// raise 22P02, which would surface to the reader as "something went wrong"
// when the honest answer is "that link is malformed".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function unsubscribe(token: string): Promise<"ok" | "unknown" | "error"> {
  if (!UUID_RE.test(token)) return "unknown";
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .update({ email_unsubscribed_at: new Date().toISOString() })
      .eq("unsubscribe_token", token)
      // Already-unsubscribed stays a success from the caller's point of
      // view, but we only want to log a state change once.
      .is("email_unsubscribed_at", null)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[unsubscribe] update failed:", error.message);
      return "error";
    }
    if (data?.id) {
      await track("email_unsubscribed", {}, { userId: data.id });
    }
    return "ok";
  } catch (err) {
    console.error("[unsubscribe] threw:", err);
    return "error";
  }
}

export async function POST(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const result = await unsubscribe(token);
  // Always 200 for the one-click flow. A non-200 makes Gmail show the user
  // an error for something that is not their problem.
  return new Response(result === "error" ? "error" : "ok", { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const result = await unsubscribe(token);

  const message =
    result === "ok"
      ? {
          heading: "You're unsubscribed.",
          body: "We won't send you any more rehearsal reminders. Your speeches and recordings are untouched, and signing in still works exactly as before.",
        }
      : result === "unknown"
        ? {
            heading: "That link didn't work.",
            body: "It may have been truncated by your mail client. You can turn reminders off in Settings once you're signed in.",
          }
        : {
            heading: "Something went wrong.",
            body: "We couldn't update your preferences just now. Try the link again in a minute, or turn reminders off in Settings.",
          };

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${message.heading} — SpeechPrep</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         color: #111111; background: #ffffff; margin: 0;
         display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  main { max-width: 32rem; padding: 32px 24px; }
  h1 { font-size: 28px; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 16px; }
  p { font-size: 16px; line-height: 1.55; color: #6d6c6b; margin: 0 0 24px; }
  a { color: #111111; }
</style></head>
<body><main>
  <h1>${message.heading}</h1>
  <p>${message.body}</p>
  <p><a href="/">Back to SpeechPrep</a></p>
</main></body></html>`;

  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" },
  });
}
