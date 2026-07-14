// OAuth / magic-link callback. Exchanges the `code` query param for a
// session cookie, then redirects to the requested next route (defaulting
// to /app).
//
// This is also the analytics seam for the top of the funnel: the first
// authenticated request after account creation lands here, so we (1) record
// the `signup` event and (2) persist the first-touch attribution cookie to
// profiles.attribution. The profiles row itself already exists — it's created
// by the handle_new_user DB trigger the moment auth.users gets the row.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ATTRIBUTION_COOKIE, parseAttributionCookie } from "@/lib/attribution";
import { track } from "@/lib/track";
import type { Database } from "@/types/database.types";

// Magic-link flow: the auth.users row is created when the link is requested,
// and the user typically clicks the email within minutes. A login this soon
// after account creation is a signup, not a returning visit.
const SIGNUP_WINDOW_MS = 30 * 60 * 1000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/app";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (data.user) {
        await recordSignupAnalytics(supabase, data.user);
      }
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  // Fallback: show a generic error page. For now, kick back to login.
  return NextResponse.redirect(new URL("/login?error=callback", url.origin));
}

// Best-effort — a broken analytics write must never block login.
async function recordSignupAnalytics(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<void> {
  try {
    const cookieStore = await cookies();
    const attribution = parseAttributionCookie(
      cookieStore.get(ATTRIBUTION_COOKIE)?.value,
    );

    // First-touch only: `.is("attribution", null)` makes re-logins a no-op.
    // RLS (profiles_update_own) scopes the write to the user's own row.
    if (attribution) {
      await supabase
        .from("profiles")
        .update({ attribution })
        .eq("id", user.id)
        .is("attribution", null);
    }

    const isNewUser =
      Date.now() - new Date(user.created_at).getTime() < SIGNUP_WINDOW_MS;
    if (isNewUser) {
      await track(
        "signup",
        {
          method: "magic_link",
          utm_source: attribution?.utm_source,
          gclid: attribution?.gclid,
        },
        { userId: user.id },
      );
    }
  } catch (err) {
    console.error("[auth/callback] signup analytics failed", err);
  }
}
