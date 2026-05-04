// Billing page. Shows the user's current entitlement, lets them upgrade
// or buy a one-shot pass, and links to the Stripe customer portal for
// subscription management.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  startSubscriptionCheckout,
  startOneShotCheckout,
  openCustomerPortal,
} from "@/app/app/billing-actions";

export const metadata = { title: "Billing — SpeechPrep" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BillingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : null;
  const fromRecordSpeechId =
    params.from === "record" && typeof params.speech_id === "string" ? params.speech_id : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: ent } = await supabase
    .from("entitlements")
    .select("plan, subscription_status, current_period_end, free_sessions_remaining, one_shot_speech_id")
    .eq("user_id", user.id)
    .single();

  const plan = ent?.plan ?? "free";
  const isPaid = plan === "practiced" || plan === "single_speech";
  const sessionsLeft = ent?.free_sessions_remaining ?? 3;

  return (
    <div style={{ maxWidth: 880 }}>
      <h1 className="text-heading-lg">Billing</h1>

      {/* Status banners */}
      {status === "success" && (
        <div
          style={{
            marginTop: 24,
            padding: "12px 16px",
            background: "rgba(71,208,150,0.12)",
            border: "1px solid rgba(71,208,150,0.32)",
            borderRadius: 10,
            color: "#0d4a30",
            fontSize: 14,
          }}
        >
          Payment received. You&rsquo;re all set — head back to your speech and start
          recording.
        </div>
      )}
      {status === "cancelled" && (
        <div
          style={{
            marginTop: 24,
            padding: "12px 16px",
            background: "rgba(17,17,17,0.04)",
            border: "1px solid rgba(17,17,17,0.08)",
            borderRadius: 10,
            color: "var(--color-muted-ash)",
            fontSize: 14,
          }}
        >
          Checkout cancelled. Nothing was charged.
        </div>
      )}
      {fromRecordSpeechId && (
        <div
          style={{
            marginTop: 24,
            padding: "12px 16px",
            background: "rgba(225,101,64,0.10)",
            border: "1px solid rgba(225,101,64,0.22)",
            borderRadius: 10,
            color: "#88321a",
            fontSize: 14,
          }}
        >
          You&rsquo;re out of free sessions. Pick an option below to keep practicing.
        </div>
      )}

      {/* Current plan */}
      <section
        className="card-bordered"
        style={{ padding: 24, marginTop: 28, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}
      >
        <div>
          <div className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
            Current plan
          </div>
          <div className="text-heading-sm mt-2" style={{ textTransform: "capitalize" }}>
            {plan === "practiced" ? "Practiced" : plan === "single_speech" ? "Single speech pass" : "Free"}
          </div>
          <p className="text-body-sm mt-2" style={{ color: "var(--color-muted-ash)" }}>
            {plan === "practiced" && ent?.subscription_status
              ? `Subscription ${ent.subscription_status}` +
                (ent.current_period_end
                  ? ` · renews ${new Date(ent.current_period_end).toLocaleDateString()}`
                  : "")
              : plan === "single_speech"
              ? `Pass active until ${
                  ent?.current_period_end
                    ? new Date(ent.current_period_end).toLocaleDateString()
                    : "(unknown)"
                }`
              : `${sessionsLeft} free session${sessionsLeft === 1 ? "" : "s"} remaining`}
          </p>
        </div>
        {isPaid && (
          <form action={openCustomerPortal}>
            <button type="submit" className="btn-light">
              Manage subscription
            </button>
          </form>
        )}
      </section>

      {/* Upgrade options — only shown if not already on Practiced */}
      {plan !== "practiced" && (
        <section style={{ marginTop: 32 }}>
          <h2 className="text-heading">Choose a plan</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              marginTop: 16,
            }}
          >
            {/* Practiced — monthly */}
            <div
              className="card-bordered"
              style={{
                padding: 24,
                background: "var(--color-midnight-ink)",
                color: "var(--color-canvas-white)",
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <div>
                <div className="text-caption" style={{ opacity: 0.6 }}>
                  Practiced · monthly
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: 56,
                    lineHeight: 1,
                    marginTop: 14,
                  }}
                >
                  $12<span style={{ fontSize: 16, opacity: 0.6 }}> / mo</span>
                </div>
                <p className="text-body-sm mt-2" style={{ opacity: 0.7 }}>
                  Unlimited sessions across every speech.
                </p>
              </div>
              <form action={startSubscriptionCheckout} style={{ marginTop: "auto" }}>
                <input type="hidden" name="cadence" value="monthly" />
                <button
                  type="submit"
                  className="btn-light"
                  style={{
                    width: "100%",
                    background: "var(--color-canvas-white)",
                    color: "var(--color-midnight-ink)",
                  }}
                >
                  Subscribe monthly
                </button>
              </form>
              <form action={startSubscriptionCheckout}>
                <input type="hidden" name="cadence" value="yearly" />
                <button
                  type="submit"
                  className="btn-ghost"
                  style={{
                    width: "100%",
                    color: "var(--color-canvas-white)",
                    opacity: 0.85,
                    fontSize: 13,
                  }}
                >
                  Or pay yearly — $96, two months free →
                </button>
              </form>
            </div>

            {/* Single speech pass */}
            <div
              className="card-bordered"
              style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}
            >
              <div>
                <div className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
                  Single speech · one-time
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: 56,
                    lineHeight: 1,
                    marginTop: 14,
                  }}
                >
                  $19
                </div>
                <p className="text-body-sm mt-2" style={{ color: "var(--color-muted-ash)" }}>
                  Seven days, one speech, no card after.
                </p>
              </div>
              <form action={startOneShotCheckout} style={{ marginTop: "auto" }}>
                {fromRecordSpeechId && (
                  <input type="hidden" name="speech_id" value={fromRecordSpeechId} />
                )}
                <button type="submit" className="btn-light" style={{ width: "100%" }}>
                  {fromRecordSpeechId ? "Buy pass for this speech" : "Buy a single-speech pass"}
                </button>
              </form>
            </div>
          </div>

          <p className="text-body-sm mt-6" style={{ color: "var(--color-muted-ash)" }}>
            Both options charge securely through Stripe. Subscriptions can be
            cancelled any time from{" "}
            <Link href="/app/billing" style={{ color: "var(--color-midnight-ink)", textDecoration: "underline" }}>
              this page
            </Link>
            .
          </p>
        </section>
      )}
    </div>
  );
}
