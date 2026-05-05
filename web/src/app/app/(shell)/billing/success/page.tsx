// Post-checkout success page. Stripe redirects here with the session
// id; we apply the entitlement synchronously (so the user sees their
// upgraded plan even if the async webhook hasn't fired yet), fire the
// Google Ads conversion pixel, then bounce them back to wherever they
// started — or to /app/billing as a default.

import { redirect } from "next/navigation";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { applyEntitlementFromCheckoutSession, safeReturnTo } from "@/lib/entitlements";
import { ConversionPixel } from "../conversion-pixel";
import { SuccessRedirect } from "./success-redirect";

export const metadata = { title: "Payment received — SpeechPrep" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const sessionId = typeof params.session_id === "string" ? params.session_id : null;

  // Auth gate — same shape as the rest of /app.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!sessionId) {
    redirect("/app/billing");
  }

  // Pull the Stripe session and apply the entitlement immediately. The
  // webhook will also run (likely seconds later); both paths are
  // idempotent and converge on the same row.
  let returnTo = "/app/billing";
  let conversion: { transactionId: string; value: number; currency: string } | null = null;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    // Make sure this Stripe session actually belongs to the logged-in
    // user — otherwise a stolen session_id could grant entitlement to
    // someone else's account.
    if (session.metadata?.user_id === user.id) {
      await applyEntitlementFromCheckoutSession(session);
    }
    returnTo = safeReturnTo(session.metadata?.return_to ?? null);
    if (session.amount_total && session.currency) {
      conversion = {
        transactionId: session.id,
        value: session.amount_total / 100,
        currency: session.currency.toUpperCase(),
      };
    }
  } catch {
    // If Stripe lookup fails, the webhook is still the source of truth
    // — fall through to the billing page so the user sees something.
    redirect("/app/billing");
  }

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        textAlign: "center",
      }}
    >
      {conversion && (
        <ConversionPixel
          transactionId={conversion.transactionId}
          value={conversion.value}
          currency={conversion.currency}
        />
      )}
      <div className="text-heading-sm">Payment received</div>
      <p className="text-body-sm" style={{ color: "var(--color-muted-ash)" }}>
        Taking you back to your speech&hellip;
      </p>
      <SuccessRedirect to={returnTo} />
    </div>
  );
}
