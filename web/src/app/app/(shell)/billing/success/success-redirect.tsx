"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Brief client-side redirect after a successful checkout. The delay
// gives the conversion pixel time to fire (gtag is async) and lets the
// user actually see the "Payment received" confirmation instead of a
// jarring instant flash.
export function SuccessRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => {
      router.replace(to);
      router.refresh();
    }, 1200);
    return () => clearTimeout(t);
  }, [router, to]);
  return null;
}
