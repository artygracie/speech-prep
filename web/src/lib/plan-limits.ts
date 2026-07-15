// Per-plan recording limits — single source of truth for how long a
// take may run. Marketing states these limits, so the recorder
// enforces them as a hard stop (warning a minute out, graceful
// auto-stop at the cap).
//
// NOTE (WS-A ↔ WS-B seam): this module's contract — MAX_DURATION_MS +
// maxDurationMs(plan), free 5 min / paid 60 min — is owned by the
// entitlements workstream (WS-B). This copy exists so WS-A builds
// standalone; at merge, keep WS-B's version if the two diverge.

export const MAX_DURATION_MS: Record<string, number> = {
  free: 5 * 60_000,
  practiced: 60 * 60_000,
  single_speech: 60 * 60_000,
};

// Unknown/missing plans get the free-tier cap — the most conservative
// read, and what a logged-out or unprovisioned profile effectively is.
export function maxDurationMs(plan: string | null | undefined): number {
  return MAX_DURATION_MS[plan ?? "free"] ?? MAX_DURATION_MS.free;
}
