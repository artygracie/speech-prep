// Brand tokens — kept in sync with src/app/globals.css.
// Email clients have weak CSS support, so we use plain hex literals here
// (no CSS variables) and inline styles in every component.

export const colors = {
  background: "#f4f3ef", // whisper-gray
  surface: "#ffffff", // canvas-white
  ink: "#111111", // midnight-ink
  charcoal: "#272625", // surface-charcoal
  muted: "#6d6c6b", // muted-ash
  border: "#ecebea", // light-taupe
  accent: "#e8400d", // phoenix-orange
  accentSoft: "#ffd7f0", // petal-pink
} as const;

export const fonts = {
  sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  serif: '"Instrument Serif", "Iowan Old Style", "Palatino", Georgia, serif',
} as const;

export const SITE_URL = "https://speechprep.ai";
export const LOGO_URL = `${SITE_URL}/assets/logo-wordmark-dark.png`;
