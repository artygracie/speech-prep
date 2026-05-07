"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Brief client-side redirect after a successful checkout. The delay
// gives the conversion pixel time to fire (gtag is async) and lets the
// user actually see the "Payment received" confirmation instead of a
// jarring instant flash.
//
// `waitForPixel` lets the success page hold the redirect until the
// conversion event has actually been sent (the page calls release()).
// We still cap the wait so a missing/blocked gtag never strands the user.
export function SuccessRedirect({
  to,
  waitForPixel = false,
}: {
  to: string;
  waitForPixel?: boolean;
}) {
  const router = useRouter();
  const released = useRef(!waitForPixel);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const go = () => {
      console.log("[success-redirect] navigating to", to);
      router.replace(to);
      router.refresh();
    };

    console.log("[success-redirect] mounted, waitForPixel=", waitForPixel);

    if (released.current) {
      timer = setTimeout(go, 1200);
    } else {
      // Wait for the pixel to release us, but cap at 3s so a blocked
      // gtag never strands the user on the success page.
      timer = setTimeout(() => {
        console.warn("[success-redirect] 3s cap hit without pixel-fired event");
        go();
      }, 3000);
      const handler = () => {
        console.log("[success-redirect] pixel-fired received, redirecting after 400ms");
        if (timer) clearTimeout(timer);
        timer = setTimeout(go, 400);
      };
      window.addEventListener("speechprep:pixel-fired", handler, { once: true });
      return () => {
        window.removeEventListener("speechprep:pixel-fired", handler);
        if (timer) clearTimeout(timer);
      };
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [router, to, waitForPixel]);
  return null;
}
