// Billing page. Shows the user's current entitlement, lets them upgrade
// or buy a one-shot pass, and links to the Stripe customer portal for
// subscription management.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  startSubscriptionCheckout,
  startOneShotCheckout,
  openCustomerPortal,
} from "@/app/app/billing-actions";
import { FREE_SESSION_LIMIT } from "@/lib/plan-limits";

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
  // Where to bounce back to after a successful checkout. Threaded into
  // Stripe metadata so the /billing/success page can read it and
  // redirect.
  const returnTo = fromRecordSpeechId ? `/app/speeches/${fromRecordSpeechId}/record` : null;

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
  const sessionsLeft = ent?.free_sessions_remaining ?? FREE_SESSION_LIMIT;

  return (
    <div style={{ maxWidth: 880 }}>
      <h1 className="text-heading-lg">Billing</h1>

      {/* Status banners */}
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
          You&rsquo;ve used your free rehearsal. Pick an option below to keep practicing.
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
            {plan === "practiced" ? "Practiced" : plan === "single_speech" ? "Event Pass" : "Free"}
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
              : sessionsLeft > 0
              ? "Your free rehearsal — with the complete coach report — is waiting."
              : "Free rehearsal used."}
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
            {/* Event Pass — the hero option */}
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
                  Event Pass · one-time
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
                  $24<span style={{ fontSize: 16, opacity: 0.6 }}> once</span>
                </div>
                <p className="text-body-sm mt-2" style={{ opacity: 0.7 }}>
                  One speech. Unlimited rehearsals and coaching for 30 days. No
                  subscription — and we delete the recordings after, if you want.
                </p>
              </div>
              <form action={startOneShotCheckout} style={{ marginTop: "auto" }}>
                {fromRecordSpeechId && (
                  <input type="hidden" name="speech_id" value={fromRecordSpeechId} />
                )}
                {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
                <button
                  type="submit"
                  className="btn-light"
                  style={{
                    width: "100%",
                    background: "var(--color-canvas-white)",
                    color: "var(--color-midnight-ink)",
                  }}
                >
                  {fromRecordSpeechId ? "Get the Event Pass for this speech" : "Get the Event Pass"}
                </button>
              </form>
            </div>

            {/* Practiced — for repeat speakers */}
            <div
              className="card-bordered"
              style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}
            >
              <div>
                <div className="text-caption" style={{ color: "var(--color-muted-ash)" }}>
                  Practiced · for repeat speakers
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
                  $12<span style={{ fontSize: 16, color: "var(--color-muted-ash)" }}> / mo</span>
                </div>
                <p className="text-body-sm mt-2" style={{ color: "var(--color-muted-ash)" }}>
                  Unlimited rehearsals across every speech.
                </p>
              </div>
              <form action={startSubscriptionCheckout} style={{ marginTop: "auto" }}>
                <input type="hidden" name="cadence" value="monthly" />
                {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
                <button type="submit" className="btn-light" style={{ width: "100%" }}>
                  Subscribe monthly
                </button>
              </form>
              <form action={startSubscriptionCheckout}>
                <input type="hidden" name="cadence" value="yearly" />
                {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
                <button
                  type="submit"
                  className="btn-ghost"
                  style={{
                    width: "100%",
                    color: "var(--color-muted-ash)",
                    fontSize: 13,
                  }}
                >
                  Or pay yearly — $96, two months free →
                </button>
              </form>
            </div>
          </div>

          <p className="text-body-sm mt-6" style={{ color: "var(--color-muted-ash)" }}>
            For scale: a human coach runs about $50 per half hour, and speechwriters
            start at $200. Both options charge securely through Stripe, and
            subscriptions can be cancelled any time from this page.
          </p>
        </section>
      )}
    </div>
  );
}
