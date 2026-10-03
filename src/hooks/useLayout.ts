import { useWindowDimensions } from 'react-native';
import { Breakpoints } from '@/constants/theme';

export type LayoutKind = 'phone' | 'tablet' | 'desktop';

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const kind: LayoutKind = width >= Breakpoints.desktop ? 'desktop' : width >= Breakpoints.tablet ? 'tablet' : 'phone';
  return { width, height, kind, isPhone: kind === 'phone', isWide: kind !== 'phone', isDesktop: kind === 'desktop' };
}
