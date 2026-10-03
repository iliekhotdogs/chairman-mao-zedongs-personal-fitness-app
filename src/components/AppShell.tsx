import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C, Radius, Space } from '@/constants/theme';
import { useLayout } from '@/hooks/useLayout';
import { Badge, Ionicons, Muted, Row, Stack, Text, type IconName } from './ui';
import { useStore } from '@/store/AppStore';
import { pendingProposals } from '@/lib/selectors';

const NAV: { href: string; label: string; icon: IconName; iconActive: IconName; match: (p: string) => boolean }[] = [
  { href: '/', label: 'Today', icon: 'home-outline', iconActive: 'home', match: (p) => p === '/' },
  { href: '/food', label: 'Food', icon: 'restaurant-outline', iconActive: 'restaurant', match: (p) => p.startsWith('/food') },
  { href: '/workouts', label: 'Train', icon: 'barbell-outline', iconActive: 'barbell', match: (p) => p.startsWith('/workouts') },
  { href: '/coach', label: 'Coach', icon: 'chatbubbles-outline', iconActive: 'chatbubbles', match: (p) => p.startsWith('/coach') },
  { href: '/progress', label: 'Progress', icon: 'trending-up-outline', iconActive: 'trending-up', match: (p) => p.startsWith('/progress') || p.startsWith('/activity') },
];

const SETTINGS = { href: '/settings', label: 'Settings', icon: 'settings-outline' as IconName, iconActive: 'settings' as IconName, match: (p: string) => p.startsWith('/settings') || p.startsWith('/states') };

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isWide } = useLayout();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const { state, sync } = useStore();
  const pending = pendingProposals(state).length;

  if (isWide) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
        <View style={styles.sidebar}>
          <Row style={{ paddingHorizontal: Space.sm, marginBottom: Space.xl }} gap={10}>
            <View style={styles.logo}>
              <Ionicons name="pulse" size={18} color="#fff" />
            </View>
            <Text variant="h3">FitCoach</Text>
          </Row>
          <Stack gap={2}>
            {NAV.map((n) => (
              <SideItem key={n.href} item={n} active={n.match(path)} badge={n.href === '/coach' && pending ? pending : undefined} />
            ))}
          </Stack>
          <View style={{ flex: 1 }} />
          <SideItem item={SETTINGS} active={SETTINGS.match(path)} />
          <View style={{ paddingHorizontal: Space.sm, paddingTop: Space.md }}>
            <Muted variant="caption">{sync.configured ? (sync.session ? `Synced account · ${sync.status === 'syncing' ? 'syncing…' : sync.status === 'error' ? 'sync error' : 'up to date'}` : 'Not signed in · this device only') : 'Local mode · this device only'}</Muted>
          </View>
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1 }}>{children}</View>
      <View style={[styles.tabbar, { paddingBottom: Math.max(insets.bottom, 8) }]} accessibilityRole="tablist">
        {NAV.map((n) => {
          const active = n.match(path);
          return (
            <Pressable key={n.href} onPress={() => router.navigate(n.href as never)} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={n.label}>
              <View>
                <Ionicons name={active ? n.iconActive : n.icon} size={22} color={active ? C.primary : C.textSecondary} />
                {n.href === '/coach' && pending ? <View style={styles.dot} /> : null}
              </View>
              <Text variant="caption" color={active ? C.primary : C.textSecondary}>
                {n.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SideItem({ item, active, badge }: { item: (typeof NAV)[number]; active: boolean; badge?: number }) {
  return (
    <Pressable
      onPress={() => router.navigate(item.href as never)}
      accessibilityRole="link"
      accessibilityLabel={badge ? `${item.label}, ${badge} pending` : item.label}
      accessibilityState={{ selected: active }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.sideItem, active ? { backgroundColor: C.primarySoft } : hovered ? { backgroundColor: C.surfaceAlt } : null, pressed ? { opacity: 0.8 } : null]}>
      <Ionicons name={active ? item.iconActive : item.icon} size={20} color={active ? C.primary : C.textSecondary} />
      <Text variant="bodyStrong" color={active ? C.primary : C.text} style={{ flex: 1 }}>
        {item.label}
      </Text>
      {badge ? <Badge kind="pending" label={String(badge)} icon={null} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sidebar: { width: 240, backgroundColor: C.surface, borderRightWidth: 1, borderRightColor: C.border, paddingHorizontal: Space.md, paddingVertical: Space.xl },
  logo: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  sideItem: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.md, paddingVertical: 10, borderRadius: Radius.md },
  tabbar: { flexDirection: 'row', backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 3, minHeight: 48, justifyContent: 'center' },
  dot: { position: 'absolute', top: -2, right: -4, width: 9, height: 9, borderRadius: 5, backgroundColor: C.warning, borderWidth: 1.5, borderColor: C.surface },
});
