"use client";

import { useEffect, useRef } from "react";

type Props = {
  transactionId: string;
  value: number;
  currency: string;
};

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function ConversionPixel({ transactionId, value, currency }: Props) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    window.gtag?.("event", "conversion", {
      send_to: "AW-18139578575/iM_JCO2GxKccEM-B0MlD",
      value,
      currency,
      transaction_id: transactionId,
    });
  }, [transactionId, value, currency]);

  return null;
}
