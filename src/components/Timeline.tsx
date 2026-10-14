import React from 'react';
import { StyleSheet, View } from 'react-native';
import { C, Radius, Space } from '@/constants/theme';
import { useLayout } from '@/hooks/useLayout';
import { Ionicons, Muted, Reveal, Stack, Text, type IconName } from './ui';
import type { Milestone, MilestoneKind } from '@/lib/streaks';
import { parseISODate } from '@/lib/dates';

const KIND: Record<MilestoneKind, { icon: IconName; highlight?: boolean }> = {
  start: { icon: 'flag-outline' },
  meal: { icon: 'restaurant-outline' },
  workout: { icon: 'barbell-outline' },
  count: { icon: 'medal-outline' },
  streak: { icon: 'flame-outline', highlight: true },
  weight: { icon: 'scale-outline' },
  pr: { icon: 'trophy-outline', highlight: true },
};

const fmtDate = (d: string) => parseISODate(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** Vertical milestone timeline: single rail on phones, alternating sides on wider screens. */
export function Timeline({ items }: { items: Milestone[] }) {
  const { isPhone } = useLayout();
  return (
    <View accessibilityRole="list">
      {items.map((m, i) => {
        const k = KIND[m.kind];
        const body = (
          <Stack gap={2} style={[styles.body, !isPhone && i % 2 === 0 ? { alignItems: 'flex-end' } : null]}>
            <Text variant="eyebrow" color={k.highlight ? C.accent : C.textSecondary}>{fmtDate(m.date)}</Text>
            <Text variant="h3" style={!isPhone && i % 2 === 0 ? { textAlign: 'right' } : undefined}>{m.title}</Text>
            {m.detail ? <Muted variant="small" style={!isPhone && i % 2 === 0 ? { textAlign: 'right' } : undefined}>{m.detail}</Muted> : null}
          </Stack>
        );
        const rail = (
          <View style={styles.railCol}>
            {items.length > 1 ? <View style={[styles.line, i === 0 ? { top: 18 } : null, i === items.length - 1 ? { bottom: undefined, height: 18 } : null]} /> : null}
            <View style={[styles.dot, k.highlight ? { backgroundColor: C.primarySoft, borderColor: C.primary } : null]}>
              <Ionicons name={k.icon} size={15} color={k.highlight ? C.primary : C.textSecondary} />
            </View>
          </View>
        );
        return (
          <Reveal key={m.id} index={Math.min(i, 8)}>
            <View style={styles.row} accessibilityRole="text" accessibilityLabel={`${fmtDate(m.date)}: ${m.title}${m.detail ? `. ${m.detail}` : ''}`}>
              {isPhone ? (
                <>
                  {rail}
                  {body}
                </>
              ) : (
                <>
                  <View style={{ flex: 1 }}>{i % 2 === 0 ? body : null}</View>
                  {rail}
                  <View style={{ flex: 1 }}>{i % 2 === 1 ? body : null}</View>
                </>
              )}
            </View>
          </Reveal>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', gap: Space.md },
  railCol: { width: 36, alignItems: 'center' },
  line: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: C.border },
  dot: { marginTop: 2, width: 32, height: 32, borderRadius: Radius.pill, borderWidth: 1, borderColor: C.borderStrong, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  body: { paddingBottom: Space.xl, paddingTop: 4 },
});
