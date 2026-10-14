import '@/global.css';

import { Platform } from 'react-native';

/**
 * Dark, athletic palette. One accent (volt) used sparingly for primary actions, the active
 * nav item and hero numbers. Status colours are desaturated so they read as calm semantics
 * rather than competing brand colours. Text colours meet WCAG AA (>=4.5:1) on bg/surface.
 *
 * Coaching states stay distinct: suggestion (lavender) -> pending approval (amber) -> saved (sage);
 * simulated = slate, dashed.
 *
 * Token names are stable (other modules import `C`); new tokens are additive.
 */
export const C = {
  // surfaces
  bg: '#0A0B0D',
  bgDeep: '#060708',
  surface: '#121418',
  surfaceAlt: '#1A1D22',
  surfaceRaised: '#1F2329',
  surfaceHover: '#1C2026',
  border: '#24282F',
  borderStrong: '#3A3F48',
  // text
  text: '#F3F4F6',
  textSecondary: '#A8AEB8',
  textMuted: '#80868F',
  // accent (volt)
  primary: '#D4FF3A',
  primaryPressed: '#BCE62B',
  primaryHover: '#DEFF66',
  primarySoft: '#1E2510',
  primaryBorder: '#4A5A17',
  onPrimary: '#0A0B0D',
  accent: '#D4FF3A',
  // status (muted)
  danger: '#F08A80',
  dangerSoft: '#221413',
  dangerBorder: '#5A2A26',
  warning: '#E2B566',
  warningSoft: '#211A10',
  warningBorder: '#55421F',
  success: '#86C7A0',
  successSoft: '#111E17',
  successBorder: '#2C4A38',
  suggestion: '#B8A8EC',
  suggestionSoft: '#1A1726',
  suggestionBorder: '#3D3561',
  simulated: '#9AA3AF',
  simulatedSoft: '#16191D',
  info: '#93B6E2',
  infoSoft: '#111924',
  infoBorder: '#2A3D57',
  // macros: distinguishable hues at matched, calm saturation
  protein: '#7FA9E3',
  carbs: '#DDB373',
  fat: '#C79FDB',
  calories: '#D4FF3A',
  // misc
  focus: '#D4FF3A',
  overlay: 'rgba(0,0,0,0.65)',
  glass: 'rgba(10,11,13,0.92)',
  toast: '#23272E',
  white: '#FFFFFF',
  chartBar: '#4A515B',
} as const;

export const Space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, huge: 72 } as const;
export const Radius = { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;

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
  hero: { fontSize: 76, lineHeight: 72, fontFamily: DisplayFont.heavy, fontWeight: 'normal' as const, letterSpacing: -0.5, textTransform: 'uppercase' as const },
  display: { fontSize: 44, lineHeight: 46, fontFamily: DisplayFont.heavy, fontWeight: 'normal' as const, letterSpacing: -0.2, textTransform: 'uppercase' as const },
  h1: { fontSize: 34, lineHeight: 38, fontFamily: DisplayFont.heavy, fontWeight: 'normal' as const, letterSpacing: 0, textTransform: 'uppercase' as const },
  h2: { fontSize: 22, lineHeight: 26, fontFamily: DisplayFont.bold, fontWeight: 'normal' as const, letterSpacing: 0.2, textTransform: 'uppercase' as const },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' as const },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  smallStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const, letterSpacing: 0.2 },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '700' as const, letterSpacing: 1.6, textTransform: 'uppercase' as const },
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
