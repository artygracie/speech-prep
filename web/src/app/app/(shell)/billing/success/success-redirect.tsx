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
      router.replace(to);
      router.refresh();
    };

    if (released.current) {
      timer = setTimeout(go, 1200);
    } else {
      // Wait for the pixel to release us, but cap at 3s so a blocked
      // gtag never strands the user on the success page.
      timer = setTimeout(go, 3000);
      const handler = () => {
        if (timer) clearTimeout(timer);
        // Small grace period after the pixel reports done so the request
        // is fully out the door before navigation tears down the page.
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
  }, [router, to]);
  return null;
}
