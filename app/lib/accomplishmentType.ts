// Sub-classification within stance='accomplishment' only -- see
// schema.sql's claims.accomplishment_type comment. 'accomplishment' the
// stance value was doing double duty as both "whose side is this claim
// on" and "what kind of win is this"; this is the honest subtype.
export const ACCOMPLISHMENT_TYPES = [
  'Accomplishment',
  'Policy Decision',
  'Strategic Decision',
  'Ongoing Initiative',
] as const;

export type AccomplishmentType = (typeof ACCOMPLISHMENT_TYPES)[number];

// Legacy/unclassified rows (approved before this field existed, or not
// yet reached by the backfill) fall back to the original blanket label
// rather than showing a blank tag.
export function accomplishmentTypeLabel(t: string | null | undefined): string {
  return t && (ACCOMPLISHMENT_TYPES as readonly string[]).includes(t) ? t : 'Accomplishment';
}
