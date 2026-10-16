import React from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import { C } from '@/constants/theme';
import { HERO_IMAGE } from './heroImage';

/**
 * Full-bleed hero background. Without a photo it draws a dark, monochrome "track" composition:
 * a soft volt glow, diagonal racing stripes and a fade into the page background.
 * With HERO_IMAGE set, the photo is shown desaturated under the same gradients.
 */
export function HeroBackdrop() {
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      {HERO_IMAGE ? (
        <Image source={HERO_IMAGE} resizeMode="cover" style={[StyleSheet.absoluteFill, { opacity: 0.6 }, Platform.OS === 'web' ? ({ filter: 'grayscale(1) contrast(1.1)' } as object) : null]} />
      ) : null}
      <Svg width="100%" height="100%" viewBox="0 0 1440 900" preserveAspectRatio="xMaxYMid slice">
        <Defs>
          <LinearGradient id="base" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={C.surfaceRaised} stopOpacity={HERO_IMAGE ? 0.2 : 1} />
            <Stop offset="1" stopColor={C.bg} stopOpacity={HERO_IMAGE ? 0.5 : 1} />
          </LinearGradient>
          <RadialGradient id="glow" cx="1080" cy="300" r="560" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={C.accent} stopOpacity="0.16" />
            <Stop offset="0.55" stopColor={C.accent} stopOpacity="0.04" />
            <Stop offset="1" stopColor={C.accent} stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="left" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={C.bg} stopOpacity="0.85" />
            <Stop offset="0.6" stopColor={C.bg} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.55" stopColor={C.bg} stopOpacity="0" />
            <Stop offset="1" stopColor={C.bg} stopOpacity="1" />
          </LinearGradient>
          <LinearGradient id="stripe" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={C.accent} stopOpacity="0" />
            <Stop offset="0.5" stopColor={C.accent} stopOpacity="0.5" />
            <Stop offset="1" stopColor={C.accent} stopOpacity="0.9" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="1440" height="900" fill="url(#base)" />
        <Rect x="0" y="0" width="1440" height="900" fill="url(#glow)" />
        {/* racing stripes */}
        <Polygon points="860,900 940,900 1440,240 1440,134" fill="url(#stripe)" opacity={0.16} />
        <Polygon points="980,900 1012,900 1440,334 1440,292" fill="url(#stripe)" opacity={0.28} />
        <Polygon points="1060,900 1072,900 1440,414 1440,398" fill="url(#stripe)" opacity={0.4} />
        {/* track arc + lane marks */}
        <Path d="M -80 760 C 380 560, 900 520, 1520 610" stroke={C.textMuted} strokeOpacity={0.18} strokeWidth={1.5} fill="none" />
        <Path d="M -80 812 C 380 612, 900 572, 1520 662" stroke={C.textMuted} strokeOpacity={0.1} strokeWidth={1} fill="none" strokeDasharray="18 14" />
        <Rect x="0" y="0" width="1440" height="900" fill="url(#left)" />
        <Rect x="0" y="0" width="1440" height="900" fill="url(#fade)" />
      </Svg>
    </View>
  );
}
