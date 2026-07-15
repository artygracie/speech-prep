"use client";

import { useEffect } from "react";
import { whenGtagReady } from "@/lib/gtag";

// Google Ads secondary conversion: "report delivered". Rendered by the
// session report page once the pipeline has finished, i.e. the user is
// looking at a real coach report — the product's aha moment and the signal
// Google's bidding should optimize toward alongside purchases.
//
// No-ops when NEXT_PUBLIC_GADS_CONVERSION_REPORT is unset (conversion action
// not created yet — see docs/analytics.md) and dedupes per session via
// localStorage so revisiting a report doesn't refire.

const SEND_TO = process.env.NEXT_PUBLIC_GADS_CONVERSION_REPORT;

export function ReportConversion({ sessionId }: { sessionId: string }) {
  useEffect(() => {
    if (!SEND_TO) return;

    const dedupeKey = `sp-report-conv:${sessionId}`;
    try {
      if (localStorage.getItem(dedupeKey)) return;
    } catch {
      // Storage unavailable (private mode) — fire anyway; Google dedupes
      // weakly on its side and an occasional double-count beats zero data.
    }

    return whenGtagReady(() => {
      window.gtag!("event", "conversion", { send_to: SEND_TO });
      try {
        localStorage.setItem(dedupeKey, "1");
      } catch {
        // Ignore — see above.
      }
    });
  }, [sessionId]);

  return null;
}
