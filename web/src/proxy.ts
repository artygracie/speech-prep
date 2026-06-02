// Next.js 16 — file convention is `proxy` (renamed from `middleware`).
// Runs on every request to refresh Supabase auth cookies and gate /app.

import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on every request except static assets, image optimization, and
  // inbound webhooks (which carry no auth cookies and must not be redirected).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|assets/|api/stripe/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
