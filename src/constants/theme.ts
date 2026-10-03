import '@/global.css';

import { Platform } from 'react-native';

/**
 * Light, minimal palette. Text colours meet WCAG AA (≥4.5:1) on the surfaces they use.
 * Status colours make the three coaching states visually distinct:
 *   suggestion (violet) → pending approval (amber) → saved (green); simulated = slate, dashed.
 */
export const C = {
  bg: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F3F6',
  border: '#E3E6EB',
  borderStrong: '#C9CED6',
  text: '#101828',
  textSecondary: '#535D6D',
  textMuted: '#6B7280',
  primary: '#0B7A5E',
  primaryPressed: '#09654E',
  primarySoft: '#E6F4EF',
  onPrimary: '#FFFFFF',
  danger: '#B42318',
  dangerSoft: '#FEF3F2',
  warning: '#B54708',
  warningSoft: '#FFF6E5',
  success: '#027A48',
  successSoft: '#ECFDF3',
  suggestion: '#6941C6',
  suggestionSoft: '#F4F0FF',
  simulated: '#475467',
  simulatedSoft: '#F2F4F7',
  info: '#175CD3',
  infoSoft: '#EFF6FF',
  protein: '#2E6BD9',
  carbs: '#C2700A',
  fat: '#8E44C9',
  calories: '#0B7A5E',
  focus: '#2E6BD9',
} as const;

export const Space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const Radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const Font = Platform.select({
  web: { family: 'var(--font-display)' as string | undefined },
  default: { family: undefined as string | undefined },
});

export const Type = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700' as const, letterSpacing: -0.5 },
  h1: { fontSize: 24, lineHeight: 30, fontWeight: '700' as const, letterSpacing: -0.3 },
  h2: { fontSize: 19, lineHeight: 25, fontWeight: '600' as const },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' as const },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  smallStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const, letterSpacing: 0.2 },
  number: { fontSize: 28, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.5 },
};

export const Breakpoints = { tablet: 768, desktop: 1080 } as const;
export const MaxContentWidth = 1200;
