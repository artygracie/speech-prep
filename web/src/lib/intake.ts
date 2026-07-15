// Intake helpers — turn an uploaded speech document into smart defaults
// so the new-speech forms act like they understood the file.
//
// All pure functions; unit-tested in intake.test.ts.

/** Words-per-minute used across the product for time estimates. Matches
 *  estimateSeconds in app/actions.ts — keep in lockstep. */
export const SPOKEN_WPM = 145;

/** Filename → suggested speech title.
 *
 *  "Ally Wedding Toast - Final Draft.pdf" → "Ally Wedding Toast"
 *  "best_man_speech_v2.docx"              → "Best Man Speech"
 *
 *  Strips the extension, separator-noise, and trailing draft/version
 *  markers. If the remainder already has intentional casing, keep it;
 *  all-lowercase leftovers get title-cased.
 */
export function titleFromFilename(name: string): string {
  let base = name.replace(/\.[a-z0-9]+$/i, "");
  base = base.replace(/[_]+/g, " ");
  // Trailing draft/version markers, possibly repeated and separated by
  // spaces or dashes: "- Final Draft", "(v2)", "rev 3", "copy", "FINAL".
  const marker =
    /[\s\-–—]*(\(?\b(final(\s+draft)?|draft|rev(ision)?\s*\d*|v(er(sion)?)?\.?\s*\d+|copy(\s*\d+)?|edited|latest|new|updated)\b\)?)+\s*$/i;
  let prev = "";
  while (prev !== base) {
    prev = base;
    base = base.replace(marker, "");
  }
  base = base.replace(/\s{2,}/g, " ").replace(/[\s\-–—]+$/, "").trim();
  if (!base) return "";
  // Already human-cased (contains an uppercase letter)? Leave it alone.
  if (/[A-Z]/.test(base)) return base;
  return base
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/** Human-friendly spoken-duration estimate: "about 6½ minutes",
 *  "about 1 minute", "under a minute". */
export function spokenTimeLabel(text: string): string {
  const words = countWords(text);
  if (words === 0) return "";
  const minutes = words / SPOKEN_WPM;
  if (minutes < 0.75) return "under a minute";
  const halves = Math.round(minutes * 2) / 2;
  if (halves === 1) return "about 1 minute";
  const whole = Math.floor(halves);
  const half = halves % 1 !== 0;
  if (whole === 0) return "about ½ a minute";
  return `about ${whole}${half ? "½" : ""} minute${halves > 1 ? "s" : ""}`;
}

/** Occasion inference from the filename + opening lines. Keyword-based on
 *  purpose — instant, free, and only fires on strong signals. Returns one
 *  of the writer's occasion labels, or null when unsure. */
export function inferOccasion(fileName: string, text: string): string | null {
  const hay = `${fileName} ${text.slice(0, 500)}`.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/best\s*man/, "Best man"],
    [/(maid|matron)\s*of\s*honou?r|\bmoh\b/, "Maid of honor"],
    [/father\s*of\s*the\s*(bride|groom)|mother\s*of\s*the\s*(bride|groom)/, "Parent of the couple"],
    [/eulog|memorial|funeral|celebration\s*of\s*life/, "Eulogy"],
    [/wedding|toast|bride|groom|newlywed/, "Wedding toast"],
    [/retire/, "Retirement"],
    [/graduat|commencement/, "Graduation"],
    [/keynote|conference/, "Keynote"],
    [/birthday/, "Birthday"],
  ];
  for (const [re, label] of rules) {
    if (re.test(hay)) return label;
  }
  return null;
}
