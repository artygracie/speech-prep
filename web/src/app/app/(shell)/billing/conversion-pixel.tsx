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

// Poll for window.gtag (set by gtag.js once it loads) and fire the
// conversion as soon as it's available. Polling beats queueing into
// dataLayer ourselves because gtag.js's loader is picky about what's
// already on window.gtag — installing a custom stub can prevent the
// real library from taking over cleanly.
const POLL_INTERVAL_MS = 50;
const MAX_WAIT_MS = 4000;

export function ConversionPixel({ transactionId, value, currency, onComplete }: Props) {
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
      console.log("[conversion-pixel] firing gtag event", { transactionId, value, currency });
      window.gtag!("event", "conversion", {
        send_to: "AW-18139578575/iM_JCO2GxKccEM-B0MlD",
        value,
        currency,
        transaction_id: transactionId,
        event_callback: () => {
          console.log("[conversion-pixel] event_callback fired (hit sent)");
          release();
        },
        event_timeout: 2000,
      });
    };

    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      console.log("[conversion-pixel] gtag ready immediately");
      send();
    } else {
      console.log("[conversion-pixel] gtag not ready, polling…");
      const start = Date.now();
      const interval = setInterval(() => {
        if (typeof window !== "undefined" && typeof window.gtag === "function") {
          clearInterval(interval);
          console.log("[conversion-pixel] gtag became ready after", Date.now() - start, "ms");
          send();
        } else if (Date.now() - start >= MAX_WAIT_MS) {
          clearInterval(interval);
          console.warn("[conversion-pixel] gtag never loaded; pushing into dataLayer as fallback");
          if (typeof window !== "undefined") {
            window.dataLayer = window.dataLayer || [];
            window.dataLayer.push([
              "event",
              "conversion",
              {
                send_to: "AW-18139578575/iM_JCO2GxKccEM-B0MlD",
                value,
                currency,
                transaction_id: transactionId,
              },
            ]);
          }
          release();
        }
      }, POLL_INTERVAL_MS);
      return () => clearInterval(interval);
    }

    // Hard cap so a missing event_callback never strands the user.
    const fallback = setTimeout(() => {
      console.warn("[conversion-pixel] 3s fallback fired — releasing redirect without callback");
      release();
    }, 3000);
    return () => clearTimeout(fallback);
  }, [transactionId, value, currency, onComplete]);

  return null;
}
