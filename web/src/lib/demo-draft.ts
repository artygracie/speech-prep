// The handoff from the anonymous demo into a real account.
//
// The demo persists nothing server-side, so the only way a new user's
// speech survives signing up is a sessionStorage stash written when their
// report renders and read by the onboarding form. Session-scoped on
// purpose: it should not outlive the tab.
//
// Exposed as a useSyncExternalStore source rather than something an effect
// reads into state. sessionStorage doesn't exist during SSR, so the server
// snapshot is always null and the client fills it in on hydration — which
// is exactly the case useSyncExternalStore is built for, and it avoids both
// a hydration mismatch and a setState-in-effect.
//
// Every access is wrapped because Safari private mode throws on the
// accessor itself. Losing the draft means a blank form, never a crash.

export const DEMO_DRAFT_KEY = "sp_demo_draft";

export type DemoDraft = {
  script: string;
  occasion: string;
  title: string;
};

function readRaw(): string | null {
  try {
    return sessionStorage.getItem(DEMO_DRAFT_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): DemoDraft | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<DemoDraft>;
    if (typeof p?.script !== "string" || !p.script.trim()) return null;
    return {
      script: p.script,
      occasion: typeof p.occasion === "string" ? p.occasion : "",
      title: typeof p.title === "string" ? p.title : "",
    };
  } catch {
    return null;
  }
}

// getSnapshot must return a referentially stable value or React re-renders
// forever, so the parsed object is memoised against the raw string.
let cachedRaw: string | null = null;
let cachedDraft: DemoDraft | null = null;

export function getDemoDraftSnapshot(): DemoDraft | null {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedDraft = parse(raw);
  }
  return cachedDraft;
}

/** Server render has no sessionStorage; null is the only honest answer. */
export function getDemoDraftServerSnapshot(): DemoDraft | null {
  return null;
}

/**
 * No-op subscribe. The draft is written on a different page (the demo) and
 * read on this one, so it never changes while onboarding is mounted — and
 * a storage event would only fire for *other* tabs anyway.
 */
export function subscribeDemoDraft(): () => void {
  return () => {};
}

export function saveDemoDraft(draft: DemoDraft): void {
  try {
    sessionStorage.setItem(DEMO_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* private mode — the CTA still works, the form just starts empty */
  }
}

/** Called once the speech has been created, so a second one starts clean. */
export function clearDemoDraft(): void {
  try {
    sessionStorage.removeItem(DEMO_DRAFT_KEY);
  } catch {
    /* nothing to clean up */
  }
}
