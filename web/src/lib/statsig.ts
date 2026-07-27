// Statsig client — session replay + autocapture.
//
// Browser-only. Boots from `instrumentation-client.ts` so the recorder is
// running before the first paint, which is the whole point: a replay that
// starts after hydration misses the load experience we most want to watch.
//
// Env-gated the same way the Google Ads conversion labels are: with
// NEXT_PUBLIC_STATSIG_CLIENT_KEY unset, every export here is a clean no-op,
// so local dev and preview deploys record nothing until a key is set.
//
// Identity: Statsig assigns its own stableID to anonymous visitors, so
// marketing-page sessions are recorded without us doing anything. Once a
// user is authenticated, `identifyStatsig()` re-keys the session to their
// Supabase user id — see components/statsig-identify.tsx.

import { StatsigClient } from "@statsig/js-client";
import { runStatsigSessionReplay } from "@statsig/session-replay";
import { runStatsigAutoCapture } from "@statsig/web-analytics";

const CLIENT_KEY = process.env.NEXT_PUBLIC_STATSIG_CLIENT_KEY;

// Vercel sets NEXT_PUBLIC_VERCEL_ENV to production | preview | development.
// Statsig only recognises the tiers below, so preview folds into staging.
function environmentTier(): string {
  switch (process.env.NEXT_PUBLIC_VERCEL_ENV) {
    case "production":
      return "production";
    case "preview":
      return "staging";
    default:
      return "development";
  }
}

let client: StatsigClient | null = null;

export function initStatsig(): void {
  if (!CLIENT_KEY || typeof window === "undefined" || client) return;

  const instance = new StatsigClient(
    CLIENT_KEY,
    {},
    { environment: { tier: environmentTier() } },
  );

  // Recorder options are rrweb's, and nest under `rrwebConfig` — the flat
  // shape shown in Statsig's docs does not type-check against the SDK.
  runStatsigSessionReplay(instance, {
    rrwebConfig: {
      // Statsig's baseline masks password fields only. Everything a
      // SpeechPrep user types is personal — the speech itself, the
      // occasion, their name — so mask every input rather than enumerate.
      maskAllInputs: true,
      // Escape hatches for rendered (non-input) content. Nothing carries
      // these classes yet; add `sp-replay-mask` to redact an element's
      // text or `sp-replay-block` to cut it from the replay entirely.
      maskTextSelector: ".sp-replay-mask",
      blockSelector: ".sp-replay-block",
    },
  });
  runStatsigAutoCapture(instance);

  // Fire-and-forget: a failed init must never surface to the user, and
  // there is nothing to fall back to.
  void instance.initializeAsync().catch(() => {});

  client = instance;
}

// Re-key the session from the anonymous stableID to the signed-in user.
// Safe to call repeatedly — bails when the id is already current.
export function identifyStatsig(userID: string): void {
  if (!client || client.getContext().user.userID === userID) return;
  void client.updateUserAsync({ userID }).catch(() => {});
}
