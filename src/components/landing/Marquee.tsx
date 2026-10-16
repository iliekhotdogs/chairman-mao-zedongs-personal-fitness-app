import React from 'react';
import { Platform, Text, View } from 'react-native';
import { C, DisplayFont } from '@/constants/theme';

const WORDS = ['Invite-only', 'Snap your plate', 'Lift heavier', 'Coach asks first', 'Prove it'];

/** Looping banner (CSS marquee on web, a static strip on native). Decorative, hidden from assistive tech. */
export function Marquee() {
  const strip = { backgroundColor: C.primary, borderTopWidth: 3, borderBottomWidth: 3, borderColor: C.text, overflow: 'hidden' as const, paddingVertical: 8, transform: [{ rotate: '-1deg' }], marginVertical: 16 };
  if (Platform.OS !== 'web') {
    return (
      <View style={strip} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text numberOfLines={1} style={{ fontFamily: DisplayFont.heavy, fontSize: 26, color: C.glyph, textTransform: 'uppercase' }}>{WORDS.join(' ✦ ')}</Text>
      </View>
    );
  }
  const item = { fontFamily: DisplayFont.heavy, fontSize: 30, lineHeight: '34px', textTransform: 'uppercase', color: C.glyph, whiteSpace: 'nowrap', paddingRight: 28 } as const;
  const half = WORDS.map((w) => React.createElement('span', { key: w, style: item }, `${w} ✦`));
  return (
    <View style={strip} aria-hidden>
      {React.createElement('div', { className: 'fc-marquee' }, React.createElement('div', { style: { display: 'flex' } }, half), React.createElement('div', { style: { display: 'flex' } }, half))}
    </View>
  );
}
