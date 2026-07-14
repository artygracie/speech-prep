"use server";

// Billing server actions: spin up a Stripe Checkout session for a
// subscription or one-shot pass, and open the customer portal so the
// user can manage their subscription.
//
// All flows go through Stripe Checkout (hosted page) — much less surface
// area for us to maintain than embedded checkout, and Stripe handles
// every payment-method update + tax + receipt for free.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { stripe, PRICES, SITE_URL } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeReturnTo } from "@/lib/entitlements";
import { eventPassPriceData } from "@/lib/plan-limits";

// Reuse a customer if we have one; otherwise mint a new one and write
// the id back to the profile so we don't create duplicates on every
// checkout attempt.
async function ensureStripeCustomer(userId: string, email: string): Promise<string> {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .single();
  if (profile?.stripe_customer_id) return profile.stripe_customer_id;

  const customer = await stripe.customers.create({
    email,
    metadata: { user_id: userId },
  });
  await admin
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", userId);
  return customer.id;
}

// Subscription checkout. cadence is monthly (default) or yearly.
export async function startSubscriptionCheckout(formData: FormData): Promise<void> {
  const cadence = String(formData.get("cadence") ?? "monthly");
  const priceId = cadence === "yearly" ? PRICES.practiced_yearly : PRICES.practiced_monthly;
  if (!priceId) throw new Error(`No Stripe price configured for cadence=${cadence}`);

  // Where to send the user after they pay. Stored on the Stripe session
  // metadata so the post-checkout redirect target can read it back, and
  // sanitised to same-origin paths to prevent open redirects.
  const returnTo = safeReturnTo(formData.get("return_to")?.toString() ?? null);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) redirect("/login");

  const customerId = await ensureStripeCustomer(user.id, user.email);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    // The metadata flows into the webhook so we can attribute payments
    // back to the right user even in race conditions.
    metadata: { user_id: user.id, plan: "practiced", cadence, return_to: returnTo },
    subscription_data: {
      metadata: { user_id: user.id, plan: "practiced", cadence },
    },
    success_url: `${SITE_URL}/app/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/app/billing?status=cancelled`,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
  });
  if (!session.url) throw new Error("Stripe didn't return a checkout url");
  redirect(session.url);
}

// One-shot Event Pass ($24 once — one speech, 30 days). Optionally scoped
// to a specific speech_id (so the webhook can mark which speech the pass
// is locked to). The price is inline price_data, not a dashboard price
// object: entitlements key off metadata.plan, never the price ID, so the
// env-configured PRICES.single_speech is superseded and unused here.
export async function startOneShotCheckout(formData: FormData): Promise<void> {
  const speechId = String(formData.get("speech_id") ?? "");
  const returnTo = safeReturnTo(formData.get("return_to")?.toString() ?? null);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) redirect("/login");

  const customerId = await ensureStripeCustomer(user.id, user.email);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price_data: eventPassPriceData(), quantity: 1 }],
    metadata: {
      user_id: user.id,
      plan: "single_speech",
      return_to: returnTo,
      ...(speechId ? { speech_id: speechId } : {}),
    },
    payment_intent_data: {
      metadata: {
        user_id: user.id,
        plan: "single_speech",
        ...(speechId ? { speech_id: speechId } : {}),
      },
    },
    success_url: `${SITE_URL}/app/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/app/billing?status=cancelled`,
    allow_promotion_codes: true,
  });
  if (!session.url) throw new Error("Stripe didn't return a checkout url");
  redirect(session.url);
}

// Open the Stripe customer portal so the user can update card, cancel,
// switch cadence, etc. Requires the customer portal to be enabled in
// the Stripe dashboard (Settings → Billing → Customer portal).
export async function openCustomerPortal(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();
  if (!profile?.stripe_customer_id) {
    throw new Error("No Stripe customer on file — buy something first.");
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${SITE_URL}/app/billing`,
  });
  redirect(portal.url);
}
