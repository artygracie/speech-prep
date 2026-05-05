// Single source of truth for session-mode display labels.
//
// The recorder toggle and the session report badge must use the SAME
// strings — never inline "Script visible" or "From memory" anywhere
// else, always import from here. If we want to rename a mode, this is
// the one file to change.

export type SessionMode = "with-script" | "freestyle";

export const MODE_LABEL: Record<SessionMode, string> = {
  "with-script": "Script visible",
  freestyle: "From memory",
};

// Hero question shown above the report. Each mode has a different job:
//   with-script → does this writing land out loud?
//   freestyle   → do I have this memorized?
export const MODE_HERO_QUESTION: Record<SessionMode, string> = {
  "with-script": "Does this work when you say it out loud?",
  freestyle: "How well do you have this memorized?",
};

// Primary CTA on the coach card footer.
export const MODE_PRIMARY_CTA: Record<SessionMode, string> = {
  "with-script": "Apply & record again →",
  freestyle: "Drill again →",
};

// Default fallback when a session row is missing `mode`.
// Pre-existing sessions render as Script-visible — the more common
// case and a generous framing for either intent.
export const DEFAULT_MODE: SessionMode = "with-script";

export function resolveMode(raw: string | null | undefined): SessionMode {
  if (raw === "with-script" || raw === "freestyle") return raw;
  return DEFAULT_MODE;
}
