// Canonical claim-category taxonomy, mirrored from ingestion/extract_from_video.py's
// CATEGORIES constant (Python is the source of truth since claims are
// classified there at ingestion; this TS copy is what the live app needs
// for anything classified in-process, e.g. citizen suggestions — see
// citizenSuggestions.ts). Keep the two lists in sync by hand; there's no
// shared build step between the Python ingestion scripts and this Next
// app to enforce it automatically.
export const CATEGORIES = [
  'Economy',
  'Water',
  'Healthcare',
  'Education',
  'Housing',
  'Agriculture',
  'Security',
  'Tourism',
  'Energy',
  'Social Protection',
  'Governance',
  'Other'
] as const;

export type Category = (typeof CATEGORIES)[number];
