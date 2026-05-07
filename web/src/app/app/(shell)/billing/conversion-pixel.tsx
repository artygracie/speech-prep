"use client";

import { useEffect, useRef } from "react";

type Props = {
  transactionId: string;
  value: number;
  currency: string;
  onComplete?: () => void;
};

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export function ConversionPixel({ transactionId, value, currency, onComplete }: Props) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    // Make sure gtag exists even if the gtag.js script hasn't loaded yet —
    // queueing into dataLayer means the call is replayed when gtag.js
    // arrives. Without this, the call silently no-ops on fast navigations
    // where the effect runs before afterInteractive scripts hydrate.
    if (typeof window !== "undefined") {
      window.dataLayer = window.dataLayer || [];
      if (!window.gtag) {
        window.gtag = function gtag(...args: unknown[]) {
          window.dataLayer!.push(args);
        };
      }
    }

    window.gtag!("event", "conversion", {
      send_to: "AW-18139578575/iM_JCO2GxKccEM-B0MlD",
      value,
      currency,
      transaction_id: transactionId,
      // event_callback fires once the hit has been sent. We use it to
      // gate the post-checkout redirect so the request doesn't get
      // cancelled mid-flight by client-side navigation.
      event_callback: onComplete,
      // Safety net — if gtag never loads, don't block the redirect forever.
      event_timeout: 2000,
    });

    // Belt-and-suspenders: if event_callback never fires (e.g. ad blocker
    // or gtag.js failed to load), still release the redirect.
    const fallback = setTimeout(() => onComplete?.(), 2500);
    return () => clearTimeout(fallback);
  }, [transactionId, value, currency, onComplete]);

  return null;
}
