// /app layout. Auth gate only. The visible shell (sidenav + topbar) lives
// inside the (shell) route group, so onboarding can render full-bleed
// alongside the regular app routes.
//
// First-run detection happens in the dashboard route, not here, so that
// /app/onboarding itself can render without bouncing.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatsigIdentify } from "@/components/statsig-identify";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <>
      <StatsigIdentify userId={user.id} />
      {children}
    </>
  );
}
