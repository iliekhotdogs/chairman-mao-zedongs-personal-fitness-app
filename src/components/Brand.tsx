import React from 'react';
import { View } from 'react-native';
import { Blob, C } from '@/constants/theme';
import { Ionicons, Row, Text } from './ui';

/** Mint blob mark used in the sidebar, landing nav, splash and onboarding. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, ...(size >= 28 ? Blob.sm : {}), borderRadius: size >= 28 ? undefined : 8, backgroundColor: C.primary, borderWidth: 2, borderColor: C.text, transform: [{ rotate: '-4deg' }], alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
      <Ionicons name="pulse" size={Math.round(size * 0.58)} color={C.glyph} />
    </View>
  );
}

export function Logo({ size = 32, showWord = true }: { size?: number; showWord?: boolean }) {
  return (
    <Row gap={10} accessibilityLabel="FitCoach">
      <LogoMark size={size} />
      {showWord ? (
        <Text variant="h2" style={{ fontSize: Math.round(size * 0.75), lineHeight: Math.round(size * 0.85), letterSpacing: 1.2 }}>
          FitCoach
        </Text>
      ) : null}
    </Row>
  );
}
