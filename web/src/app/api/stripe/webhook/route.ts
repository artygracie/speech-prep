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
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  applyEntitlementFromCheckoutSession,
  applySubscription,
  resolveUserIdFromSubscription,
} from "@/lib/entitlements";

// Force the route to run on the Node runtime — Stripe's signature
// verification uses Node's crypto and is unhappy on the Edge runtime.
export const runtime = "nodejs";
// We need the raw body for signature verification, so opt out of any
// Next-side request body parsing.
export const dynamic = "force-dynamic";

function log(...args: unknown[]) {
  console.log("[stripe-webhook]", ...args);
}
function logError(...args: unknown[]) {
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
  if (!userId) {
    log("no user_id in checkout metadata; skipping", session.id);
    return;
  }
  await applyEntitlementFromCheckoutSession(session);
  log("applied entitlement", { userId, mode: session.mode });
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

