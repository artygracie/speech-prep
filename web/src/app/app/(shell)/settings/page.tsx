import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Settings — SpeechPrep" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("email, plan, sessions_used, created_at")
    .eq("id", user!.id)
    .single();

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 className="text-heading-lg">Settings</h1>

      <div className="grid md:grid-cols-2 gap-6 mt-10">
        <div className="card-bordered" style={{ padding: 28 }}>
          <h3 className="text-heading-sm">Account</h3>
          <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)" }}>
            Signed in as <strong style={{ color: "var(--color-midnight-ink)" }}>{profile?.email}</strong>.
          </p>
          <div className="mt-6">
            <label className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
              Plan
            </label>
            <div className="text-subheading mt-1" style={{ textTransform: "capitalize" }}>
              {profile?.plan ?? "free"}
            </div>
          </div>
        </div>

        <div className="card-bordered" style={{ padding: 28 }}>
          <h3 className="text-heading-sm">Privacy</h3>
          <p className="text-body mt-3" style={{ color: "var(--color-muted-ash)" }}>
            Your recordings are encrypted at rest, never used for training, and yours to
            delete on demand — remove any session from its speech page whenever you like.
          </p>
        </div>
      </div>
    </div>
  );
}
