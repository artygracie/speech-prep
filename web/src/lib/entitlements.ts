// Apply Stripe-derived entitlement to a user's profile. Used by both
// the async webhook (Stripe → us) and the synchronous success redirect
// (so the user sees their upgraded plan immediately, even if the
// webhook is still in flight).
//
// Both sides of the race are idempotent: the writes are upserts based
// on the latest Stripe state, so it doesn't matter who wins.

import "server-only";
import type Stripe from "stripe";
import { stripe, PLAN_FOR_PRICE } from "@/lib/stripe";
import { EVENT_PASS_DAYS } from "@/lib/plan-limits";
import { createAdminClient } from "@/lib/supabase/admin";

export async function applyEntitlementFromCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const userId = (session.metadata?.user_id ?? null) as string | null;
  const planTag = (session.metadata?.plan ?? null) as string | null;
  const speechId = (session.metadata?.speech_id ?? null) as string | null;
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  if (!userId) return;

  const admin = createAdminClient();

  if (session.mode === "subscription" && session.subscription) {
    const subId =
      typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    const sub = await stripe.subscriptions.retrieve(subId);
    await applySubscription(userId, sub);
    return;
  }

  if (session.mode === "payment" && planTag === "single_speech") {
    // Event Pass: one speech, unlimited rehearsals + coaching for 30 days.
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + EVENT_PASS_DAYS);
    const { error } = await admin
      .from("profiles")
      .update({
        plan: "single_speech",
        stripe_customer_id: customerId,
        stripe_subscription_id: null,
        subscription_status: "one_shot",
        current_period_end: periodEnd.toISOString(),
        ...(speechId ? { one_shot_speech_id: speechId } : {}),
      })
      .eq("id", userId);
    if (error) throw error;
  }
}

export async function applySubscription(
  userId: string,
  sub: Stripe.Subscription,
): Promise<void> {
  const admin = createAdminClient();
  const item = sub.items.data[0];
  const priceId = item?.price.id;
  const inferredPlan = priceId ? PLAN_FOR_PRICE[priceId] : undefined;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const periodEndUnix =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    (item as unknown as { current_period_end?: number } | undefined)?.current_period_end ??
    null;

  const { error } = await admin
    .from("profiles")
    .update({
      plan: inferredPlan ?? "practiced",
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      subscription_status: sub.status,
      current_period_end: periodEndUnix
        ? new Date(periodEndUnix * 1000).toISOString()
        : null,
    })
    .eq("id", userId);
  if (error) throw error;
}

export async function resolveUserIdFromSubscription(
  sub: Stripe.Subscription,
): Promise<string | null> {
  const metaUserId = (sub.metadata?.user_id ?? null) as string | null;
  if (metaUserId) return metaUserId;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (!customerId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.id ?? null;
}

// Same-origin guard for redirect targets we receive via metadata. We
// only ever redirect to internal `/app/...` paths so a tampered Stripe
// session can't ship users off-site.
export function safeReturnTo(input: string | null | undefined): string {
  if (!input) return "/app/billing";
  if (!input.startsWith("/")) return "/app/billing";
  if (input.startsWith("//")) return "/app/billing";
  return input;
}
