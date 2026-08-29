// One color per claim category, shared across every surface that renders a
// category (Dashboard filter pills, card tags, and eventually the claim
// detail view once it exists) so a color always means the same sector.
//
// Palette derived per the dataviz skill's method, not eyeballed: 8 hues are
// the skill's own validated categorical defaults (references/palette.md);
// 3 more (healthcare, agriculture, economy) were added and the full
// 11-hue set re-validated together with
// scripts/validate_palette.js "<hexes>" --mode light --surface "#FFFFFF"
// — passes lightness band, chroma floor, CVD separation (worst adjacent
// ΔE 9.1), and the normal-vision floor (19.2, well clear of the 15 gate).
// "Other" deliberately gets no hue — it folds into the site's existing
// neutral/muted treatment, per the skill's rule that an overflow category
// is never a casually-generated color.
//
// Each entry is a {tint, ink} pair, not a single color: tint is the ~14%
// alpha wash used as a tag/pill background (matching the existing
// --gold-tint/--red-tint/--green-tint convention in globals.css), ink is a
// darkened, WCAG-checked (>=4.5:1 vs white) version of the same hue used
// for the text — derived and verified with validate_palette.js's own
// exported contrast() function, not guessed.
export interface CategoryColor {
  tint: string;
  ink: string;
}

export const CATEGORY_COLORS: Record<string, CategoryColor> = {
  Water: { tint: 'rgba(42,120,214,0.14)', ink: '#194880' },
  Energy: { tint: 'rgba(235,104,52,0.14)', ink: '#8d3e1f' },
  Environment: { tint: 'rgba(27,175,122,0.14)', ink: '#106949' },
  Education: { tint: 'rgba(237,161,0,0.14)', ink: '#8e6100' },
  Housing: { tint: 'rgba(232,123,164,0.14)', ink: '#8b4a62' },
  'Social Protection': { tint: 'rgba(0,131,0,0.14)', ink: '#004f00' },
  Governance: { tint: 'rgba(74,58,167,0.14)', ink: '#2c2364' },
  Security: { tint: 'rgba(227,73,72,0.14)', ink: '#882c2b' },
  Healthcare: { tint: 'rgba(14,143,158,0.14)', ink: '#08565f' },
  Agriculture: { tint: 'rgba(166,116,44,0.14)', ink: '#64461a' },
  Economy: { tint: 'rgba(91,110,225,0.14)', ink: '#374287' }
};

const FALLBACK_COLOR: CategoryColor = { tint: 'var(--paper-2)', ink: 'var(--muted)' };

export function getCategoryColor(category: string | null | undefined): CategoryColor {
  if (!category) return FALLBACK_COLOR;
  return CATEGORY_COLORS[category] ?? FALLBACK_COLOR;
}
