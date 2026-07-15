// Plan limits and Event Pass constants — the single source of truth for
// what each plan allows. Everything user-facing (pricing copy, paywall
// messages, the top-bar pill) and everything enforced (entitlement
// windows, recording caps) should read from here so marketing can never
// drift from the product again.
//
// Deliberately NOT "server-only": the top-bar (client component) reads
// FREE_SESSION_LIMIT, and none of these values are secrets.

export type Plan = "free" | "practiced" | "single_speech";

/** Free tier: one full rehearsal with the complete coach report. */
export const FREE_SESSION_LIMIT = 1;

/** Event Pass window: one speech, unlimited rehearsals + coaching. */
export const EVENT_PASS_DAYS = 30;

/** Event Pass price. Charged via inline Stripe price_data (see
 *  billing-actions.ts), so this constant IS the price — there is no
 *  dashboard price object to fall out of sync with. */
export const EVENT_PASS_UNIT_AMOUNT = 2400; // cents
export const EVENT_PASS_PRICE_USD = EVENT_PASS_UNIT_AMOUNT / 100;
export const EVENT_PASS_PRODUCT_NAME = "SpeechPrep Event Pass — one speech, 30 days";

/** The line-item price_data for the Event Pass checkout. Pure and
 *  side-effect free so it can be asserted in a dry run without touching
 *  Stripe. The plan stays keyed as "single_speech" in metadata — the
 *  webhook and entitlements.ts key off metadata, not price ID. */
export function eventPassPriceData() {
  return {
    currency: "usd",
    unit_amount: EVENT_PASS_UNIT_AMOUNT,
    product_data: { name: EVENT_PASS_PRODUCT_NAME },
  } as const;
}

/** Advertised recording caps, per plan. These are the numbers marketing
 *  states, so they must be enforced: WS-A wires this into the recorder
 *  (recorder.tsx) as the hard stop on a take. */
export const MAX_DURATION_MS: Record<Plan, number> = {
  free: 5 * 60_000, // 5 minutes
  practiced: 60 * 60_000, // 60 minutes
  single_speech: 60 * 60_000, // 60 minutes (Event Pass)
};

// Unknown/missing plans get the free-tier cap — the most conservative
// read, and what a logged-out or unprovisioned profile effectively is.
export function maxDurationMs(plan: string | null | undefined): number {
  return MAX_DURATION_MS[(plan ?? "free") as Plan] ?? MAX_DURATION_MS.free;
}
