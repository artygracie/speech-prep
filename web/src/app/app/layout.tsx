// /app layout. Wraps every authed route in the sidenav + topbar shell.
// The proxy redirects unauthenticated users to /login before this layout
// even renders, so we can assume `user` is non-null by the time we get here.

import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";
import { SideNavLink } from "./_shell/side-nav-link";

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, email, plan, sessions_used")
    .eq("id", user.id)
    .single();

  const displayName = profile?.display_name ?? profile?.email ?? user.email ?? "You";
  const plan = profile?.plan ?? "free";
  const sessionsUsed = profile?.sessions_used ?? 0;
  const sessionsLimit = 3;

  return (
    <>
      <style>{`
        .app-shell { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
        @media (max-width: 880px) { .app-shell { grid-template-columns: 1fr; } .app-sidenav { display: none; } }
        .app-sidenav {
          background: var(--color-whisper-gray);
          border-right: 1px solid rgba(17,17,17,0.06);
          padding: 20px 16px; display: flex; flex-direction: column; gap: 6px;
          position: sticky; top: 0; height: 100vh;
        }
        .app-topbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 40px;
          border-bottom: 1px solid rgba(17,17,17,0.06);
          background: rgba(255,255,255,0.85);
          backdrop-filter: saturate(140%) blur(8px);
          position: sticky; top: 0; z-index: 30;
        }
        @media (max-width: 880px) { .app-topbar { padding: 12px 20px; } }
        .app-main-pad { padding: 36px 40px; }
        @media (max-width: 880px) { .app-main-pad { padding: 24px 20px; } }
        .group-label {
          font-size: 11px; font-weight: 500; text-transform: uppercase;
          letter-spacing: 0.08em; color: var(--color-muted-ash);
          padding: 12px 10px 4px;
        }
      `}</style>

      <div className="app-shell">
        <aside className="app-sidenav">
          <Link href="/" aria-label="SpeechPrep — home" style={{ padding: "4px 6px", marginBottom: 12 }}>
            <Image
              src="/assets/logo-wordmark-dark.png"
              alt="SpeechPrep"
              width={140}
              height={22}
              style={{ height: 22, width: "auto" }}
              priority
            />
          </Link>

          <SideNavLink href="/app" exact>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12l9-9 9 9" />
              <path d="M5 10v10h14V10" />
            </svg>
            Speeches
          </SideNavLink>

          <div className="group-label">Account</div>
          <SideNavLink href="/app/settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </SideNavLink>

          <div style={{ marginTop: "auto", padding: "12px 10px" }}>
            <div className="text-body-sm" style={{ fontWeight: 500 }}>
              {displayName}
            </div>
            <div className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
              {plan === "free"
                ? `Free plan · ${sessionsUsed} of ${sessionsLimit} used`
                : `${plan.charAt(0).toUpperCase() + plan.slice(1)} plan`}
            </div>
            <form action={signOut} className="mt-3">
              <button type="submit" className="btn-ghost" style={{ paddingLeft: 0 }}>
                Sign out
              </button>
            </form>
          </div>
        </aside>

        <main>
          <div className="app-topbar">
            <div className="text-body-sm" style={{ color: "var(--color-muted-ash)" }} id="topbar-context">
              Workspace
            </div>
            {/* Right side intentionally empty. Users typically focus on
                one speech at a time, so a global "New speech" CTA was
                noise. The dashboard surfaces it where it belongs. */}
          </div>
          <div className="app-main-pad">{children}</div>
        </main>
      </div>
    </>
  );
}
