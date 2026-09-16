"use server";

// Persist the browser's IANA timezone onto the caller's own profile.
//
// Validated server-side against the Intl database rather than trusted:
// this is a user-supplied string landing in a column the cron later feeds
// to Intl.DateTimeFormat, and an unvalidated value would throw inside the
// sweep for every future run.

import { createClient } from "@/lib/supabase/server";

export async function saveTimezone(zone: string): Promise<void> {
  if (typeof zone !== "string" || zone.length > 64) return;

  try {
    // Throws on an unknown zone, which is the validation.
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
  } catch {
    return;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // RLS scopes this to the caller's own row.
  const { error } = await supabase
    .from("profiles")
    .update({ timezone: zone })
    .eq("id", user.id);

  if (error) console.error("[timezone] update failed:", error.message);
}
