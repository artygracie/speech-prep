// Server-only Stripe client + price/plan map.
//
// Imported by server actions and the webhook route handler. Never bundled
// to the client because we read STRIPE_SECRET_KEY here.

import "server-only";
import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  // Throwing at import time is intentional — we'd rather fail noisily on
  // first request than 500 with a misleading "stripe is undefined" later.
  // Local dev without Stripe set up: comment this out or set the var.
  // eslint-disable-next-line no-console
  console.warn("[stripe] STRIPE_SECRET_KEY not set — billing actions will fail");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_unset", {
  // Pinned to the SDK's default version so the types match what we get
  // back from the server. Bumping this should be a deliberate update +
  // type regen + redeploy.
  apiVersion: "2026-04-22.dahlia",
  appInfo: {
    name: "SpeechPrep",
    url: "https://speechprep.ai",
  },
});

// Price IDs are configured in Vercel + .env.local. We expose them here
// in one place so callers don't sprinkle process.env reads everywhere.
export const PRICES = {
  practiced_monthly: process.env.PRACTICED_PRICE_MONTHLY ?? "",
  practiced_yearly: process.env.PRACTICED_PRICE_YEARLY ?? "",
  // Superseded (2026-07-14): the Event Pass checkout now charges inline
  // price_data ($24 — see eventPassPriceData in @/lib/plan-limits), so
  // this env price is no longer used at checkout. Kept so PLAN_FOR_PRICE
  // still recognises historical $19 purchases in webhook replays.
  single_speech: process.env.SINGLE_SPEECH_PRICE ?? "",
} as const;

export type PriceKey = keyof typeof PRICES;

// What plan does this price imply once paid? Used by the webhook handler
// to flip profiles.plan after a successful checkout.
export const PLAN_FOR_PRICE: Record<string, "practiced" | "single_speech"> = {
  ...(PRICES.practiced_monthly ? { [PRICES.practiced_monthly]: "practiced" as const } : {}),
  ...(PRICES.practiced_yearly  ? { [PRICES.practiced_yearly]:  "practiced" as const } : {}),
  ...(PRICES.single_speech     ? { [PRICES.single_speech]:     "single_speech" as const } : {}),
};

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://speechprep.ai";
