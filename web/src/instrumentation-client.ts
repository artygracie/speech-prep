import * as Sentry from "@sentry/nextjs";
import { initStatsig } from "@/lib/statsig";

// Session replay + autocapture. No-op unless NEXT_PUBLIC_STATSIG_CLIENT_KEY
// is set (see lib/statsig.ts).
initStatsig();

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  sendDefaultPii: true,
  enableLogs: true,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // No replayIntegration here on purpose: session replay is Statsig's job
  // (see lib/statsig.ts). Sentry keeps errors and tracing. Two DOM
  // recorders on every page bought nothing but overhead, and dropping the
  // integration is also what tree-shakes the replay code out of the
  // client bundle — the excludeReplay* flags in next.config.ts are no-ops
  // unless replayIntegration is actually registered.
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
