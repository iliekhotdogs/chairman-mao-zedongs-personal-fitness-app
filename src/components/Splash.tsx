import React from 'react';
import { View } from 'react-native';
import { C, Space } from '@/constants/theme';
import { Logo } from './Brand';
import { Muted, Reveal, Skeleton, Stack } from './ui';

/** Branded loader shown while the store hydrates (instead of a blank page). */
export function Splash({ label = 'Loading your data…' }: { label?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="progressbar" accessibilityLabel={label}>
      <Reveal>
        <Stack gap={Space.lg} style={{ alignItems: 'center' }}>
          <Logo size={40} />
          <Skeleton width={160} height={3} radius={2} />
          <Muted variant="small">{label}</Muted>
        </Stack>
      </Reveal>
    </View>
  );
}
