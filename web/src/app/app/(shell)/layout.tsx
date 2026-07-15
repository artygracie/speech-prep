// Authed shell. The single piece of chrome is a thin top bar — the user
// is here to prepare one speech, not navigate a SaaS app, so the old
// 240px sidenav was overkill. Onboarding still lives outside this shell
// (full-bleed welcome).
//
// Auth is enforced by the parent `/app/layout.tsx` and the proxy. By the
// time we get here, `user` is guaranteed non-null.

import { createClient } from "@/lib/supabase/server";
import { FREE_SESSION_LIMIT } from "@/lib/plan-limits";
import { signOut } from "../actions";
import { TopBar, type TopBarPlan, type TopBarSpeech } from "../_shell/top-bar";

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The /app layout already redirects unauthed users; this is just a
  // defensive null guard to keep TypeScript happy.
  const userId = user!.id;

  // Pull the three things the bar needs in parallel: profile, plan, and
  // the list of speeches for the title-switcher dropdown.
  const [profileRes, entRes, speechesRes] = await Promise.all([
    supabase.from("profiles").select("display_name, email").eq("id", userId).single(),
    supabase
      .from("entitlements")
      .select("plan, free_sessions_remaining")
      .eq("user_id", userId)
      .single(),
    supabase
      .from("speeches")
      .select("id, title, occasion")
      .order("updated_at", { ascending: false })
      .limit(20),
  ]);

  const displayName =
    profileRes.data?.display_name ?? profileRes.data?.email ?? user?.email ?? "You";
  const email = profileRes.data?.email ?? user?.email ?? "";
  const plan = (entRes.data?.plan ?? "free") as TopBarPlan;
  const freeSessionsRemaining = entRes.data?.free_sessions_remaining ?? FREE_SESSION_LIMIT;
  const speeches: TopBarSpeech[] = (speechesRes.data ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    occasion: s.occasion,
  }));

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <TopBar
        displayName={displayName}
        email={email}
        plan={plan}
        freeSessionsRemaining={freeSessionsRemaining}
        speeches={speeches}
        signOut={signOut}
      />
      <main style={{ flex: 1 }} className="app-main-pad">
        {children}
      </main>
      <style>{`
        .app-main-pad { padding: 32px 40px; }
        @media (max-width: 880px) { .app-main-pad { padding: 24px 20px; } }
      `}</style>
    </div>
  );
}
