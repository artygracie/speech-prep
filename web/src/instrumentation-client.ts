import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  sendDefaultPii: true,
  enableLogs: true,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Session replay stays off in development. rrweb records every DOM
  // mutation, and the demo's live transcript mutates text several times a
  // second: at a 1.0 sample rate that blocked the main thread for ~20s and
  // starved MediaRecorder into producing a header-only recording.
  replaysSessionSampleRate: process.env.NODE_ENV === "development" ? 0 : 0.1,
  replaysOnErrorSampleRate: process.env.NODE_ENV === "development" ? 0 : 1.0,

  integrations: [
    // The demo frame is excluded from replay for the same reason, and
    // because a recording of someone rehearsing is theirs, not ours.
    Sentry.replayIntegration({ block: [".frame"] }),
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
