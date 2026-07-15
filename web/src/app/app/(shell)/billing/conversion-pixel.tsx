"use client";

import { useEffect, useRef } from "react";
import { whenGtagReady } from "@/lib/gtag";

// Google Ads purchase conversion. `sendTo` is the conversion action's
// send_to label ("AW-XXXXXXXX/xxxx") — the success page reads it from
// NEXT_PUBLIC_GADS_CONVERSION_PURCHASE and only renders this component when
// it's set, so an unconfigured environment is a clean no-op.

type Props = {
  sendTo: string;
  transactionId: string;
  value: number;
  currency: string;
  onComplete?: () => void;
};

export function ConversionPixel({
  sendTo,
  transactionId,
  value,
  currency,
  onComplete,
}: Props) {
  const fired = useRef(false);
  const completed = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const release = () => {
      if (completed.current) return;
      completed.current = true;
      onComplete?.();
    };

    const send = () => {
      window.gtag!("event", "conversion", {
        send_to: sendTo,
        value,
        currency,
        transaction_id: transactionId,
        event_callback: release,
        event_timeout: 2000,
      });
    };

    // Fire as soon as gtag.js is up; if it never loads (ad blocker), queue
    // the hit into dataLayer as a fallback and release the redirect.
    const cancel = whenGtagReady(send, () => {
      console.warn("[conversion-pixel] gtag never loaded; using dataLayer fallback");
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push([
        "event",
        "conversion",
        { send_to: sendTo, value, currency, transaction_id: transactionId },
      ]);
      release();
    });

    // Hard cap so a missing event_callback never strands the user.
    const fallback = setTimeout(release, 3000);
    return () => {
      cancel();
      clearTimeout(fallback);
    };
  }, [sendTo, transactionId, value, currency, onComplete]);

  return null;
}
