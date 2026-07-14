// Funnel event allowlist — the single source of truth for what may land in
// public.events. Server code (src/lib/track.ts) types against EventName;
// the /api/t beacon route rejects anything not listed here.
//
// Isomorphic on purpose (no "server-only"): client code may import the list
// to type its beacon calls.

export const EVENT_NAMES = [
  // Acquisition → activation
  "signup", // auth callback, first login after account creation
  "speech_created", // props: { source: "paste" | "upload" | "writer", occasion }
  "session_started", // recorder pressed Record (fired by WS-A via trackSessionStarted)
  "session_uploaded", // recording finalized + uploaded (WS-A via trackSessionUploaded)
  "report_delivered", // ai_reports row written (WS-A via trackReportDelivered)
  "report_viewed", // session report page rendered with the report present

  // Monetization
  "checkout_opened", // Stripe checkout session created (WS-B via trackCheckoutOpened)
  "purchase_completed", // billing success page, verified against Stripe

  // Reserved for Wave 2 (public demo + OAuth) — listed now so the allowlist
  // never needs a deploy to start accepting them.
  "demo_started",
  "demo_report",
  "demo_signup",
  "oauth_signup",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export function isEventName(value: unknown): value is EventName {
  return (
    typeof value === "string" && (EVENT_NAMES as readonly string[]).includes(value)
  );
}
