import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C, Radius, Space } from '@/constants/theme';
import { useLayout } from '@/hooks/useLayout';
import { Badge, Button, IconButton, Ionicons, Muted, Row, Stack, Text, type IconName } from './ui';
import { Logo, LogoMark } from './Brand';
import { useStore } from '@/store/AppStore';
import { pendingProposals } from '@/lib/selectors';

type NavItem = { href: string; label: string; icon: IconName; iconActive: IconName; match: (p: string) => boolean };
type PState = { pressed: boolean; hovered?: boolean };

const NAV: NavItem[] = [
  { href: '/', label: 'Today', icon: 'home-outline', iconActive: 'home', match: (p) => p === '/' },
  { href: '/food', label: 'Food', icon: 'restaurant-outline', iconActive: 'restaurant', match: (p) => p.startsWith('/food') },
  { href: '/workouts', label: 'Train', icon: 'barbell-outline', iconActive: 'barbell', match: (p) => p.startsWith('/workouts') },
  { href: '/coach', label: 'Coach', icon: 'chatbubbles-outline', iconActive: 'chatbubbles', match: (p) => p.startsWith('/coach') },
  { href: '/progress', label: 'Progress', icon: 'trending-up-outline', iconActive: 'trending-up', match: (p) => p.startsWith('/progress') || p.startsWith('/activity') },
];

const SETTINGS: NavItem = { href: '/settings', label: 'Settings', icon: 'settings-outline', iconActive: 'settings', match: (p) => p.startsWith('/settings') || p.startsWith('/states') };

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isWide, isDesktop } = useLayout();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const { state, sync } = useStore();
  const pending = pendingProposals(state).length;
  // Tablet widths collapse to an icon rail; desktop can collapse it manually.
  const [collapsedPref, setCollapsedPref] = useState(false);
  const collapsed = !isDesktop || collapsedPref;

  if (isWide) {
    const syncLabel = sync.configured ? (sync.session ? `Synced · ${sync.status === 'syncing' ? 'syncing…' : sync.status === 'error' ? 'sync error' : 'up to date'}` : 'Not signed in · this device only') : 'Local mode · this device only';
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
        <View style={[styles.sidebar, collapsed ? styles.sidebarCollapsed : null]} role="navigation">
          <View style={{ paddingHorizontal: collapsed ? 0 : Space.sm, marginBottom: Space.xxl, alignItems: collapsed ? 'center' : 'flex-start' }}>
            {collapsed ? <LogoMark size={34} /> : <Logo size={30} />}
          </View>
          <Stack gap={4}>
            {NAV.map((n) => (
              <SideItem key={n.href} item={n} active={n.match(path)} collapsed={collapsed} badge={n.href === '/coach' && pending ? pending : undefined} />
            ))}
          </Stack>
          <View style={{ flex: 1 }} />
          <SideItem item={{ ...SETTINGS, label: 'Account & settings', icon: 'person-circle-outline', iconActive: 'person-circle' }} active={SETTINGS.match(path)} collapsed={collapsed} />
          {isDesktop ? (
            <Pressable
              onPress={() => setCollapsedPref((c) => !c)}
              accessibilityRole="button"
              accessibilityLabel={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              style={({ hovered }: PState) => [styles.sideItem, collapsed ? styles.sideItemCollapsed : null, hovered ? { backgroundColor: C.surfaceAlt } : null]}>
              <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-back'} size={18} color={C.textMuted} />
              {collapsed ? null : <Muted variant="small">Collapse</Muted>}
            </Pressable>
          ) : null}
          <View style={{ paddingHorizontal: Space.sm, paddingTop: Space.md, alignItems: collapsed ? 'center' : 'flex-start' }}>
            {collapsed ? (
              <View accessibilityLabel={syncLabel} style={[styles.syncDot, { backgroundColor: sync.status === 'error' ? C.danger : sync.session ? C.success : C.textMuted }]} />
            ) : (
              <Row gap={6}>
                <View style={[styles.syncDot, { backgroundColor: sync.status === 'error' ? C.danger : sync.session ? C.success : C.textMuted }]} />
                <Muted variant="caption" style={{ flex: 1 }}>{syncLabel}</Muted>
              </Row>
            )}
          </View>
        </View>
        <View style={{ flex: 1 }}>
      {state.sample ? (
        <Row gap={Space.sm} style={{ paddingHorizontal: Space.md, paddingVertical: Space.sm, backgroundColor: C.warningSoft }}>
          <Ionicons name="flask" size={16} color={C.warning} />
          <Muted variant="small" style={{ flex: 1 }}>Sample data: made-up entries for exploring the app. Not your real log.</Muted>
          <Button title="Replace" kind="ghost" size="sm" onPress={() => router.navigate('/settings' as never)} />
        </Row>
      ) : null}
          <View style={{ flex: 1 }}>{children}</View>
        </View>
      </View>
    );
  }

  const tabs = [...NAV, SETTINGS];
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[styles.topbar, { paddingTop: Math.max(insets.top, 4) }]}>
        <IconButton icon="person-circle-outline" label="Account and settings" onPress={() => router.navigate('/settings' as never)} />
      </View>
      {sync.session && (sync.status === 'error' || sync.status === 'offline') ? (
        <Row gap={Space.sm} style={{ paddingHorizontal: Space.md, paddingVertical: Space.sm, backgroundColor: C.warningSoft }} accessibilityRole="alert">
          <Muted variant="small" style={{ flex: 1 }}>{sync.status === 'offline' ? 'Offline. Changes will sync when connected.' : 'Sync failed. Your changes are saved here.'}</Muted>
          <Button title="Retry" kind="ghost" size="sm" onPress={() => void sync.syncNow()} />
        </Row>
      ) : null}
      {state.sample ? (
        <Row gap={Space.sm} style={{ paddingHorizontal: Space.md, paddingVertical: Space.sm, backgroundColor: C.warningSoft }}>
          <Ionicons name="flask" size={16} color={C.warning} />
          <Muted variant="small" style={{ flex: 1 }}>Sample data: made-up entries for exploring the app. Not your real log.</Muted>
          <Button title="Replace" kind="ghost" size="sm" onPress={() => router.navigate('/settings' as never)} />
        </Row>
      ) : null}
      <View style={{ flex: 1 }}>{children}</View>
      <View style={[styles.tabbar, { paddingBottom: Math.max(insets.bottom, 8) }]} accessibilityRole="tablist">
        {tabs.map((n) => {
          const active = n.match(path);
          return (
            <Pressable key={n.href} onPress={() => router.navigate(n.href as never)} style={({ pressed }) => [styles.tab, pressed ? { opacity: 0.7 } : null]} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={n.label}>
              <View style={[styles.tabIndicator, active ? { backgroundColor: C.primary } : null]} />
              <View>
                <Ionicons name={active ? n.iconActive : n.icon} size={22} color={active ? C.primary : C.textSecondary} />
                {n.href === '/coach' && pending ? <View style={styles.dot} /> : null}
              </View>
              <Text variant="caption" color={active ? C.text : C.textSecondary} numberOfLines={1} style={{ fontSize: 12 }}>
                {n.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SideItem({ item, active, badge, collapsed }: { item: NavItem; active: boolean; badge?: number; collapsed: boolean }) {
  return (
    <Pressable
      onPress={() => router.navigate(item.href as never)}
      accessibilityRole="link"
      accessibilityLabel={badge ? `${item.label}, ${badge} pending` : item.label}
      accessibilityState={{ selected: active }}
      style={({ pressed, hovered }: PState) => [styles.sideItem, collapsed ? styles.sideItemCollapsed : null, active ? { backgroundColor: C.surfaceAlt } : hovered ? { backgroundColor: C.surface } : null, pressed ? { opacity: 0.8 } : null]}>
      {active ? <View style={styles.activeBar} /> : null}
      <View>
        <Ionicons name={active ? item.iconActive : item.icon} size={20} color={active ? C.primary : C.textSecondary} />
        {collapsed && badge ? <View style={[styles.dot, { borderColor: C.bgDeep }]} /> : null}
      </View>
      {collapsed ? null : (
        <>
          <Text variant="bodyStrong" color={active ? C.text : C.textSecondary} style={{ flex: 1 }}>
            {item.label}
          </Text>
          {badge ? <Badge kind="pending" label={String(badge)} icon={null} /> : null}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sidebar: { width: 248, backgroundColor: C.bgDeep, borderRightWidth: 1, borderRightColor: C.border, paddingHorizontal: Space.md, paddingVertical: Space.xl },
  sidebarCollapsed: { width: 76, paddingHorizontal: Space.sm },
  sideItem: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.md, paddingVertical: 11, borderRadius: Radius.md, overflow: 'hidden' },
  sideItemCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  activeBar: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: C.primary },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
  topbar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: Space.sm, backgroundColor: C.bgDeep },
  tabbar: { flexDirection: 'row', backgroundColor: C.bgDeep, borderTopWidth: 1, borderTopColor: C.border },
  tab: { flex: 1, alignItems: 'center', gap: 3, minHeight: 54, justifyContent: 'center', paddingTop: 6 },
  tabIndicator: { position: 'absolute', top: 0, width: 24, height: 2, borderRadius: 1, backgroundColor: 'transparent' },
  dot: { position: 'absolute', top: -2, right: -4, width: 9, height: 9, borderRadius: 5, backgroundColor: C.warning, borderWidth: 1.5, borderColor: C.bgDeep },
});
