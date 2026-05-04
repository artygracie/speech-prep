// Stripe webhook handler.
//
// Stripe POSTs here whenever something billing-relevant happens. Every
// request is signed with our STRIPE_WEBHOOK_SECRET; we verify the
// signature before reading the body. Any unverified payload is rejected
// 400 — without that check, anyone who finds the URL could fake a
// "subscription paid" event and grant themselves Pro access.
//
// Events we care about (configure these in the Stripe dashboard):
//   - checkout.session.completed       (covers both subscription and one-shot)
//   - customer.subscription.updated
//   - customer.subscription.deleted
//   - invoice.payment_failed
//
// All effects flow through `applyEntitlement`, which resolves the user
// from the Stripe metadata (set when we created the checkout session)
// and updates `profiles` to reflect the new entitlement.

import type Stripe from "stripe";
import { stripe, PLAN_FOR_PRICE } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// Force the route to run on the Node runtime — Stripe's signature
// verification uses Node's crypto and is unhappy on the Edge runtime.
export const runtime = "nodejs";
// We need the raw body for signature verification, so opt out of any
// Next-side request body parsing.
export const dynamic = "force-dynamic";

function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log("[stripe-webhook]", ...args);
}
function logError(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.error("[stripe-webhook]", ...args);
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    logError("STRIPE_WEBHOOK_SECRET not set");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing stripe-signature", { status: 400 });

  // The raw text body — DO NOT use req.json() here, the signature is
  // computed against the exact bytes Stripe sent.
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    logError("signature verification failed", err);
    return new Response(
      `Signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 400 },
    );
  }

  log("event", event.type, event.id);

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.created":
        await onSubscriptionChanged(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await onSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_failed":
        await onInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        // Returning 200 even for unhandled events is correct — it tells
        // Stripe we received it. We just don't have logic for it yet.
        log("unhandled event", event.type);
    }
  } catch (err) {
    logError("handler threw", err);
    // 500 → Stripe will retry with backoff for ~3 days.
    return new Response("handler error", { status: 500 });
  }

  return new Response("ok");
}

// ============================================================
// Handlers
// ============================================================

async function onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = (session.metadata?.user_id ?? null) as string | null;
  const planTag = (session.metadata?.plan ?? null) as string | null;
  const speechId = (session.metadata?.speech_id ?? null) as string | null;
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  if (!userId) {
    log("no user_id in checkout metadata; skipping", session.id);
    return;
  }

  const admin = createAdminClient();

  // Subscription path: details land via the subscription.* events too,
  // but we record the customer id and a placeholder plan now so the
  // user sees their entitlement immediately on the success redirect.
  if (session.mode === "subscription" && session.subscription) {
    const subId = typeof session.subscription === "string"
      ? session.subscription
      : session.subscription.id;
    const sub = await stripe.subscriptions.retrieve(subId);
    await applySubscription(userId, sub);
    return;
  }

  // One-shot pass: $19, gives 7 days of access locked to one speech
  // (or all speeches if no speech_id was passed).
  if (session.mode === "payment" && planTag === "single_speech") {
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + 7);

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
    log("granted one-shot pass", { userId, speechId, until: periodEnd.toISOString() });
    return;
  }
}

async function onSubscriptionChanged(sub: Stripe.Subscription): Promise<void> {
  const userId = await resolveUserIdFromSubscription(sub);
  if (!userId) {
    log("could not resolve user_id for subscription", sub.id);
    return;
  }
  await applySubscription(userId, sub);
}

async function onSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const userId = await resolveUserIdFromSubscription(sub);
  if (!userId) return;
  const admin = createAdminClient();
  // Drop the user back to free, but keep the customer id so a future
  // re-subscribe doesn't create a duplicate Stripe customer.
  const { error } = await admin
    .from("profiles")
    .update({
      plan: "free",
      stripe_subscription_id: null,
      subscription_status: "canceled",
      current_period_end: null,
    })
    .eq("id", userId);
  if (error) throw error;
  log("subscription canceled", { userId, sub: sub.id });
}

async function onInvoicePaymentFailed(inv: Stripe.Invoice): Promise<void> {
  // Just mark the status — Stripe's smart retry handles the actual
  // re-attempts. If retries fail, Stripe sends customer.subscription
  // .deleted and we drop them to free above.
  const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null;
  if (!customerId) return;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!profile) return;

  await admin
    .from("profiles")
    .update({ subscription_status: "past_due" })
    .eq("id", profile.id);
  log("invoice payment failed", { userId: profile.id });
}

// ============================================================
// Helpers
// ============================================================

async function applySubscription(userId: string, sub: Stripe.Subscription): Promise<void> {
  const admin = createAdminClient();
  // The first item's price drives the plan label. Multi-item subs aren't
  // a thing in our pricing model.
  const item = sub.items.data[0];
  const priceId = item?.price.id;
  const inferredPlan = priceId ? PLAN_FOR_PRICE[priceId] : undefined;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // The Stripe API exposes period_end on the sub item; on the sub itself
  // it's `current_period_end` for backwards compat.
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
  log("subscription applied", { userId, status: sub.status, plan: inferredPlan });
}

async function resolveUserIdFromSubscription(sub: Stripe.Subscription): Promise<string | null> {
  // First try the metadata we set at checkout time.
  const metaUserId = (sub.metadata?.user_id ?? null) as string | null;
  if (metaUserId) return metaUserId;

  // Fall back to looking the user up by their stripe_customer_id.
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
