import React from 'react';
import { View } from 'react-native';
import { C, Radius } from '@/constants/theme';
import { Ionicons, Row, Text } from './ui';

/** Volt mark used in the sidebar, landing nav, splash and onboarding. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) || Radius.sm, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
      <Ionicons name="pulse" size={Math.round(size * 0.58)} color={C.onPrimary} />
    </View>
  );
}

export function Logo({ size = 32, showWord = true }: { size?: number; showWord?: boolean }) {
  return (
    <Row gap={10} accessibilityLabel="FitCoach">
      <LogoMark size={size} />
      {showWord ? (
        <Text variant="h2" style={{ fontSize: Math.round(size * 0.75), lineHeight: Math.round(size * 0.85), letterSpacing: 1 }}>
          FitCoach
        </Text>
      ) : null}
    </Row>
  );
}
