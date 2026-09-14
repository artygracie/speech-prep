// The curated occasion list — the one question every speech answers.
//
// Stored verbatim in `speeches.occasion`. Wedding roles lead because that
// is where search demand and our paying users are (ART-807); "Work or
// pitch" keeps the professional path open without diluting the list.
// Keep this to eight: it renders as chips, not a dropdown.
//
// Isomorphic on purpose — the picker, server actions, and analytics
// queries all read from here.

export const OCCASIONS = [
  "Best man",
  "Maid of honor",
  "Father of the bride",
  "Mother of the groom",
  "Vows",
  "Rehearsal dinner",
  "Work or pitch",
  "Something else",
] as const;

export type Occasion = (typeof OCCASIONS)[number];

export const WEDDING_OCCASIONS: readonly Occasion[] = [
  "Best man",
  "Maid of honor",
  "Father of the bride",
  "Mother of the groom",
  "Vows",
  "Rehearsal dinner",
];

export function isOccasion(value: unknown): value is Occasion {
  return typeof value === "string" && (OCCASIONS as readonly string[]).includes(value);
}

export function isWeddingOccasion(value: string | null | undefined): boolean {
  return isOccasion(value) && WEDDING_OCCASIONS.includes(value);
}

// Normalise a form/query value to a stored occasion. Anything off-list
// (older free-text values, the writer's custom field) is kept as-is so we
// never destroy information, but empty strings become null.
export function sanitizeOccasion(value: FormDataEntryValue | string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
