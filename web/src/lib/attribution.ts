// First-touch acquisition attribution.
//
// A dependency-free inline snippet (rendered from the root layout, so it runs
// on the landing page and every other entry point) writes the visitor's first
// touch — utm_* params, gclid, external referrer, landing path — into a
// 30-day `sp_attr` cookie. First-touch means the snippet never overwrites an
// existing cookie.
//
// The cookie is read back server-side in the auth callback and persisted to
// profiles.attribution (only while that column is null — profile rows are
// created by the DB trigger handle_new_user, so this is the earliest place
// the app can attach it). See migration 20260714000100_events_and_attribution.

export const ATTRIBUTION_COOKIE = "sp_attr";

const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
const MAX_VALUE_LENGTH = 500;

const CAPTURED_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
] as const;

// Inline <script> body. Vanilla JS, no dependencies, fails silently — a
// broken analytics snippet must never break the page.
export const ATTRIBUTION_SNIPPET = `(function () {
  try {
    if (document.cookie.indexOf("${ATTRIBUTION_COOKIE}=") !== -1) return;
    var params = new URLSearchParams(location.search);
    var attr = {};
    ${JSON.stringify(CAPTURED_PARAMS)}.forEach(function (key) {
      var value = params.get(key);
      if (value) attr[key] = value.slice(0, 200);
    });
    var referrer = document.referrer;
    if (referrer && referrer.indexOf(location.origin) !== 0) {
      attr.referrer = referrer.slice(0, ${MAX_VALUE_LENGTH});
    }
    attr.landing_page = location.pathname;
    attr.first_seen_at = new Date().toISOString();
    document.cookie =
      "${ATTRIBUTION_COOKIE}=" + encodeURIComponent(JSON.stringify(attr)) +
      ";max-age=${MAX_AGE_SECONDS};path=/;SameSite=Lax" +
      (location.protocol === "https:" ? ";Secure" : "");
  } catch (e) {}
})();`;

export type Attribution = Record<string, string>;

// Parse the cookie value server-side. Defensive: the cookie is
// client-writable, so anything malformed or non-string is dropped and
// oversized values are clipped.
export function parseAttributionCookie(
  value: string | undefined,
): Attribution | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const attribution: Attribution = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val === "string") {
        attribution[key.slice(0, 50)] = val.slice(0, MAX_VALUE_LENGTH);
      }
    }
    return Object.keys(attribution).length > 0 ? attribution : null;
  } catch {
    return null;
  }
}
