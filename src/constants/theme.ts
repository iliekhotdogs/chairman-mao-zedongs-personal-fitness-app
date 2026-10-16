import '@/global.css';

import { Platform } from 'react-native';

/**
 * Dark, playful streetwear palette (FC88-inspired). One accent (mint green) used sparingly for primary actions, the active
 * nav item and hero numbers. Status colours are desaturated so they read as calm semantics
 * rather than competing brand colours. Text colours meet WCAG AA (>=4.5:1) on bg/surface.
 *
 * Coaching states stay distinct: suggestion (lavender) -> pending approval (amber) -> saved (sage);
 * simulated = slate, dashed.
 *
 * Token names are stable (other modules import `C`); new tokens are additive.
 */
export const C = {
  // surfaces (warm near-black, FC88-style)
  bg: '#181818',
  bgDeep: '#121211',
  surface: '#1F1F1D',
  surfaceAlt: '#272724',
  surfaceRaised: '#2F2F2B',
  surfaceHover: '#252522',
  border: '#3A413A',
  borderStrong: '#73836F', // sage
  // text
  text: '#F4F1E8',
  textSecondary: '#C4CCBF',
  textMuted: '#8FB79B', // mint
  // accent (kelly mint green)
  primary: '#5BEB94',
  primaryPressed: '#43CF7B',
  primaryHover: '#8CF5B3',
  primarySoft: '#14281D',
  primaryBorder: '#2F6B49',
  onPrimary: '#181818',
  accent: '#5BEB94',
  glyph: '#00554B', // deep green glyph colour for use on mint fills
  // status (muted)
  danger: '#FF8F85',
  dangerSoft: '#2A1715',
  dangerBorder: '#6A302B',
  warning: '#EBBE6E',
  warningSoft: '#262013',
  warningBorder: '#5E4A22',
  success: '#7FD6A0',
  successSoft: '#13241A',
  successBorder: '#2F5A40',
  suggestion: '#C3B5F5',
  suggestionSoft: '#1F1B2B',
  suggestionBorder: '#453D6B',
  simulated: '#A9B3A6',
  simulatedSoft: '#1C1D1B',
  info: '#9CC0EE',
  infoSoft: '#14202C',
  infoBorder: '#2F4663',
  // macros: distinguishable hues at matched, calm saturation
  protein: '#86B1EC',
  carbs: '#E6BA78',
  fat: '#D3A9E6',
  calories: '#5BEB94',
  // misc
  focus: '#5BEB94',
  overlay: 'rgba(0,0,0,0.7)',
  glass: 'rgba(24,24,24,0.94)',
  toast: '#2F2F2B',
  white: '#FFFFFF',
  chartBar: '#8FB79B',
} as const;

export const Space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, huge: 72 } as const;
export const Radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const;

/** Irregular "hand-cut" corners (per-corner radii work on web and native). Use via spread. */
export const Blob = {
  a: { borderTopLeftRadius: 28, borderTopRightRadius: 22, borderBottomRightRadius: 30, borderBottomLeftRadius: 20 },
  b: { borderTopLeftRadius: 20, borderTopRightRadius: 30, borderBottomRightRadius: 22, borderBottomLeftRadius: 28 },
  sm: { borderTopLeftRadius: 16, borderTopRightRadius: 12, borderBottomRightRadius: 18, borderBottomLeftRadius: 11 },
  chip: { borderTopLeftRadius: 22, borderTopRightRadius: 17, borderBottomRightRadius: 23, borderBottomLeftRadius: 16 },
} as const;

/** Shared easing from the FC88 site. */
export const Ease = 'cubic-bezier(0.62,0.05,0.01,0.99)';

/** Body font (system / Inter on web). */
export const Font = Platform.select({
  web: { family: 'var(--font-body)' as string | undefined },
  default: { family: undefined as string | undefined },
});

/**
 * Condensed heavy display face (Barlow Condensed, loaded in the root layout via expo-font).
 * On web a fallback stack keeps headings condensed before/without the font file.
 */
const displayFamily = (weight: '700Bold' | '800ExtraBold') =>
  Platform.OS === 'web' ? `BarlowCondensed_${weight}, 'Barlow Condensed', 'Arial Narrow', 'Roboto Condensed', sans-serif-condensed, sans-serif` : `BarlowCondensed_${weight}`;

export const DisplayFont = { bold: displayFamily('700Bold'), heavy: displayFamily('800ExtraBold') } as const;
export const DisplayFontAssets = ['BarlowCondensed_700Bold', 'BarlowCondensed_800ExtraBold'] as const;

// Custom font files carry their own weight, so display variants use fontWeight 'normal' to avoid faux bold.
export const Type = {
  hero: { fontSize: 76, lineHeight: 68, fontFamily: DisplayFont.heavy, fontWeight: 'normal' as const, letterSpacing: -0.5, textTransform: 'uppercase' as const },
  display: { fontSize: 48, lineHeight: 44, fontFamily: DisplayFont.heavy, fontWeight: 'normal' as const, letterSpacing: -0.2, textTransform: 'uppercase' as const },
  h1: { fontSize: 46, lineHeight: 42, fontFamily: DisplayFont.heavy, fontWeight: 'normal' as const, letterSpacing: 0, textTransform: 'uppercase' as const },
  h2: { fontSize: 26, lineHeight: 26, fontFamily: DisplayFont.heavy, fontWeight: 'normal' as const, letterSpacing: 0.3, textTransform: 'uppercase' as const },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' as const },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  smallStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const, letterSpacing: 0.2 },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '800' as const, letterSpacing: 1.6, textTransform: 'uppercase' as const },
  number: { fontSize: 44, lineHeight: 46, fontFamily: DisplayFont.heavy, fontWeight: 'normal' as const, letterSpacing: 0 },
  numberXL: { fontSize: 56, lineHeight: 56, fontFamily: DisplayFont.heavy, fontWeight: 'normal' as const, letterSpacing: 0 },
  numberSm: { fontSize: 28, lineHeight: 30, fontFamily: DisplayFont.heavy, fontWeight: 'normal' as const, letterSpacing: 0 },
};

export const Breakpoints = { tablet: 768, desktop: 1080 } as const;

/** Standard page widths. Screens pick one via `<Screen size=…>`. */
export const MaxWidths = { narrow: 720, medium: 1040, wide: 1200 } as const;
export const MaxContentWidth = MaxWidths.wide;

/** Durations (ms) for entrance motion; all motion respects the OS reduced-motion setting. */
export const Motion = { enter: 320, countUp: 900, stagger: 60 } as const;
