// Shared constant for the paywall error prefix. Lives outside the
// "use server" module because Next requires every export from a
// server-actions file to be an async function.
//
// The createSession server action throws an Error whose message starts
// with `[paywall]code:human-readable text`. Any client that catches
// can split on the prefix to detect a paywall and show the right CTA.

export const PAYWALL_PREFIX = "[paywall]";
