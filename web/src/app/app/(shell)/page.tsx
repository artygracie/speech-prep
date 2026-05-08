// Speeches dashboard. Reads the user's speeches via Supabase. RLS keeps it
// scoped to the requesting user automatically. First-run users (zero
// speeches) bounce to /app/onboarding so we never show them an empty
// dashboard — the empty state on this page is for veterans who happen to
// have deleted all their speeches and is much shorter / more functional.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function fmtRel(iso: string) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function SpeechesDashboard() {
  const supabase = await createClient();
  const { data: speeches } = await supabase
    .from("speeches")
    .select("id, title, occasion, current_version, created_at, updated_at")
    .order("updated_at", { ascending: false });

  const list = speeches ?? [];

  // First-run: a user with zero speeches has never onboarded. Send them
  // to the welcome page rather than showing an empty dashboard. Returning
  // users who deleted all their speeches will also pass through here, but
  // the onboarding page is intentionally non-stateful — it just creates
  // a speech and gets out of the way.
  if (list.length === 0) {
    redirect("/app/onboarding");
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="text-display">Your speeches</h1>
          <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)", maxWidth: 540 }}>
            Pick up where you left off, or start something new.
          </p>
        </div>
        {/* 'New speech' is the only affordance on the dashboard. We don't
            duplicate it in the topbar — users typically focus on one
            speech at a time. The first-time empty state lives at
            /app/onboarding, which the redirect above sends new users to. */}
        <Link href="/app/speeches/new" className="btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New speech
        </Link>
      </div>

      <div
        className="card-bordered mt-10"
        style={{ overflow: "hidden" }}
      >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1fr 0.5fr",
              gap: 16,
              padding: "14px 18px",
              borderBottom: "1px solid rgba(17,17,17,0.06)",
              background: "var(--color-whisper-gray)",
            }}
          >
            <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
              Title
            </span>
            <span className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
              Last activity
            </span>
            <span />
          </div>
          {list.map((sp) => (
            <Link
              key={sp.id}
              href={`/app/speeches/${sp.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 1fr 0.5fr",
                gap: 16,
                alignItems: "center",
                padding: "16px 18px",
                borderBottom: "1px solid rgba(17,17,17,0.04)",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <div>
                <div className="text-subheading">{sp.title}</div>
                <div className="text-caption mt-1" style={{ color: "var(--color-muted-ash)" }}>
                  {(sp.occasion ?? "Speech")} · v{sp.current_version}
                </div>
              </div>
              <div className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
                {fmtRel(sp.updated_at)}
              </div>
              <div className="text-body-sm" style={{ color: "var(--color-muted-ash)", textAlign: "right" }}>
                →
              </div>
            </Link>
          ))}
      </div>
    </div>
  );
}
