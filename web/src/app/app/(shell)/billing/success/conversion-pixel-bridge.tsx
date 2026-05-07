"use client";

import { useCallback } from "react";
import { ConversionPixel } from "../conversion-pixel";

// Bridges the ConversionPixel's onComplete to a window event so the
// SuccessRedirect (a sibling, not a parent) can listen and release the
// redirect once the conversion hit has actually been sent.
export function ConversionPixelBridge({
  transactionId,
  value,
  currency,
}: {
  transactionId: string;
  value: number;
  currency: string;
}) {
  const onComplete = useCallback(() => {
    console.log("[conversion-pixel-bridge] dispatching speechprep:pixel-fired");
    window.dispatchEvent(new Event("speechprep:pixel-fired"));
  }, []);

  return (
    <ConversionPixel
      transactionId={transactionId}
      value={value}
      currency={currency}
      onComplete={onComplete}
    />
  );
}
