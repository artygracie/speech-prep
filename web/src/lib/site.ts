export const SITE_URL = "https://speechprep.ai";

export const IS_INDEXABLE = process.env.NEXT_PUBLIC_INDEXABLE?.toLowerCase() === "true";

// Hosts that are "this site in production". speechprep.ai 301s to the www
// host, so a visitor's origin is whichever one they happened to land on.
const PRODUCTION_HOSTS = new Set(["speechprep.ai", "www.speechprep.ai"]);

/**
 * Where Supabase should send the browser after authenticating.
 *
 * Deliberately NOT `window.location.origin`. Supabase only redirects to
 * origins on its allow list, and production serves on the www host while
 * the allow list is keyed to the canonical apex — so building the URL from
 * whatever host the visitor typed produced a redirect Supabase rejected,
 * silently falling back to the Site URL. The code then never reached
 * /auth/callback to be exchanged and the user looked signed-out.
 *
 * Canonicalising here means the allow list only ever needs the small fixed
 * set of origins below, instead of one entry per host a visitor might use.
 * Localhost and preview deployments keep their own origin, since those are
 * allow-listed individually.
 */
export function authCallbackUrl(next = "/app"): string {
  const path = `/auth/callback?next=${encodeURIComponent(next)}`;
  if (typeof window === "undefined") return `${SITE_URL}${path}`;
  return PRODUCTION_HOSTS.has(window.location.hostname)
    ? `${SITE_URL}${path}`
    : `${window.location.origin}${path}`;
}
