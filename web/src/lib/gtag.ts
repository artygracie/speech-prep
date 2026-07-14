// Client-side Google tag helpers, shared by the conversion components.
//
// gtag.js is loaded by the root layout with strategy="afterInteractive", so
// components that want to fire a conversion may mount before window.gtag
// exists. Polling beats installing our own dataLayer stub because gtag.js's
// loader is picky about what's already on window.gtag — a custom stub can
// prevent the real library from taking over cleanly.

export const GTAG_POLL_INTERVAL_MS = 50;
export const GTAG_MAX_WAIT_MS = 4000;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

function gtagReady(): boolean {
  return typeof window !== "undefined" && typeof window.gtag === "function";
}

// Run `onReady` as soon as window.gtag is available (immediately if it
// already is); call `onTimeout` if it never shows up within GTAG_MAX_WAIT_MS
// (ad blocker, script error). Returns a cancel function for effect cleanup.
export function whenGtagReady(
  onReady: () => void,
  onTimeout?: () => void,
): () => void {
  if (gtagReady()) {
    onReady();
    return () => {};
  }
  const start = Date.now();
  const interval = setInterval(() => {
    if (gtagReady()) {
      clearInterval(interval);
      onReady();
    } else if (Date.now() - start >= GTAG_MAX_WAIT_MS) {
      clearInterval(interval);
      onTimeout?.();
    }
  }, GTAG_POLL_INTERVAL_MS);
  return () => clearInterval(interval);
}
