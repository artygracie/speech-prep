// Server-side Supabase client. Use inside Server Components, route handlers,
// and server actions. Reads/writes the auth session cookie via Next's cookie
// store so reads inside RSCs are RLS-aware automatically.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database.types";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Inside Server Components Next forbids setting cookies; these
          // writes only succeed in Server Actions / Route Handlers.
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Ignored — happens in Server Components where cookies are
            // immutable. Middleware refreshes the session, so this is safe.
          }
        },
      },
    },
  );
}
