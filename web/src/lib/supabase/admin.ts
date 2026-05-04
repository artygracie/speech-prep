// Service-role Supabase client. ONLY for the Stripe webhook handler and
// other server-to-server contexts where there's no user session and we
// need to bypass RLS to update someone else's row.
//
// Never import this from a Server Component or Server Action that runs
// on behalf of a user — those should use lib/supabase/server.ts so RLS
// stays enforced.

import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "createAdminClient requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
