// OAuth / magic-link callback. Exchanges the `code` query param for a
// session cookie, then redirects to the requested next route (defaulting
// to /app).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/app";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  // Fallback: show a generic error page. For now, kick back to login.
  return NextResponse.redirect(new URL("/login?error=callback", url.origin));
}
