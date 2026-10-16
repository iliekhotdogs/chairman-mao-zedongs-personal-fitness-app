import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { Blob, C, MaxWidths, Radius, Space } from '@/constants/theme';
import { useLayout } from '@/hooks/useLayout';
import { useStore } from '@/store/AppStore';
import { AccountCard } from '@/components/AccountCard';
import { Logo } from '@/components/Brand';
import { AccentRule, Badge, Button, Card, CountUp, IconButton, Ionicons, Muted, ProgressBar, Reveal, Row, SkipLink, Stack, Text, type IconName } from '@/components/ui';
import { HeroBackdrop } from './HeroBackdrop';
import { Marquee } from './Marquee';

type SectionId = 'features' | 'how' | 'join';
type PState = { pressed: boolean; hovered?: boolean };

const LINKS: { id: SectionId; label: string }[] = [
  { id: 'features', label: 'Features' },
  { id: 'how', label: 'How it works' },
  { id: 'join', label: 'Join' },
];

const STATS: { value: number; suffix?: string; label: string; body: string }[] = [
  { value: 1, label: 'Photo', body: 'is all it takes to log a meal with full macros.' },
  { value: 3, label: 'Macros', body: 'tracked against targets that adapt to your real trend.' },
  { value: 0, label: 'Surprises', body: 'every coaching change waits for your OK before it applies.' },
  { value: 7, label: 'Day trend', body: 'of weigh-ins smooths out the noise before anything changes.' },
];

const FEATURES: { icon: IconName; eyebrow: string; title: string; body: string; visual: 'food' | 'train' | 'coach' | 'progress' }[] = [
  { icon: 'camera-outline', eyebrow: 'Food', title: 'Snap a photo. We do the counting.', body: 'A photo of your plate becomes an estimate of calories and macros. You review it, adjust a portion if needed, and only then does it go in your log.', visual: 'food' },
  { icon: 'barbell-outline', eyebrow: 'Training', title: 'A plan that fits your week.', body: 'Workouts fit your schedule, your equipment and your limits. Log sets with a tap or your voice, and the weights go up when you are ready.', visual: 'train' },
  { icon: 'chatbubbles-outline', eyebrow: 'Coach', title: 'A coach that checks with you first.', body: 'It looks at your food, training and weight trend and suggests changes, with the reasons. You accept or decline. Nothing changes without you.', visual: 'coach' },
  { icon: 'trending-up-outline', eyebrow: 'Progress', title: 'See your progress.', body: 'Weight trend, estimated 1-rep maxes, streaks and milestones, on your phone and on the web, always in sync.', visual: 'progress' },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'Get your invite', body: 'FitCoach is invite-only while in beta. Your code unlocks an account.' },
  { title: 'Tell us about you', body: 'Two minutes: goal, schedule, equipment, any injuries. We build your targets and your plan.' },
  { title: 'Log, train, adjust', body: 'You log meals and sets. Each week the coach checks your trend and suggests what to change.' },
];

/** Public landing page for logged-out visitors (also reachable at /welcome). */
export function Landing() {
  const { isPhone, isDesktop, height } = useLayout();
  const insets = useSafeAreaInsets();
  const { sync } = useStore();
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Partial<Record<SectionId | 'stats', number>>>({});
  const scrollY = useRef(0);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [seen, setSeen] = useState<Partial<Record<SectionId | 'stats', boolean>>>({});

  const gutter = isPhone ? Space.lg + 4 : isDesktop ? Space.huge : Space.xxxl;
  const navH = 64 + insets.top;

  const reveal = (y: number) => {
    const next = { ...seen };
    let changed = false;
    for (const [k, top] of Object.entries(offsets.current) as [SectionId | 'stats', number][]) {
      if (!next[k] && top < y + height * 0.88) {
        next[k] = true;
        changed = true;
      }
    }
    if (changed) setSeen(next);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    scrollY.current = y;
    if (y > 24 !== scrolled) setScrolled(y > 24);
    reveal(y);
  };

  const onSectionLayout = (id: SectionId | 'stats', e: LayoutChangeEvent) => {
    offsets.current[id] = e.nativeEvent.layout.y;
    reveal(scrollY.current);
  };

  const goTo = (id: SectionId) => {
    setMenuOpen(false);
    scrollRef.current?.scrollTo({ y: Math.max(0, (offsets.current[id] ?? 0) - navH + 8), animated: true });
  };

  const heroH = isPhone ? Math.max(560, Math.min(height * 0.9, 760)) : Math.max(640, Math.min(height, 980));
  const heroSize = isDesktop ? 176 : isPhone ? 72 : 128;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SkipLink />
      <ScrollView ref={scrollRef} id="main-content" role="main" tabIndex={-1} onScroll={onScroll} scrollEventThrottle={32} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
        {/* ---------- Hero ---------- */}
        <View style={{ minHeight: heroH, justifyContent: 'flex-end', overflow: 'hidden' }} accessibilityRole="summary">
          <HeroBackdrop />
          <View style={[styles.inner, { paddingHorizontal: gutter, paddingTop: navH + Space.xxxl, paddingBottom: isPhone ? Space.xxxl : Space.huge }]}>
            <Stack gap={isPhone ? Space.lg : Space.xl} style={{ maxWidth: 1100 }}>
              <Reveal>
                <Row gap={Space.sm}>
                  <View style={styles.liveDot} />
                  <Text variant="eyebrow" color={C.textSecondary}>Invite-only · Personal AI coaching</Text>
                </Row>
              </Reveal>
              <Reveal index={1}>
                <Text variant="hero" accessibilityRole="header" style={{ fontSize: heroSize, lineHeight: heroSize * 0.88 }}>
                  Train.{'\n'}Eat.{'\n'}
                  <Text variant="hero" color={C.accent} style={{ fontSize: heroSize, lineHeight: heroSize * 0.88 }}>Feel better.</Text>
                </Text>
              </Reveal>
              <Reveal index={2}>
                <AccentRule width={64} />
              </Reveal>
              <Reveal index={3}>
                <Text color={C.textSecondary} style={{ fontSize: isPhone ? 17 : 20, lineHeight: isPhone ? 26 : 30, maxWidth: 620 }}>
                  Photograph your meals, follow a plan built around your week, and let your coach adjust the numbers as your body changes. Nothing changes without your OK.
                </Text>
              </Reveal>
              <Reveal index={4}>
                <Stack gap={Space.sm}>
                <Row wrap gap={Space.md}>
                  <Button title="Get started" icon="arrow-forward" size="lg" onPress={() => goTo('join')} />
                  <Button title="How it works" kind="secondary" size="lg" onPress={() => goTo('how')} />
                </Row>
                <Muted variant="small" style={{ maxWidth: 520 }}>
                  Meal photo analysis needs an account. Without one you can explore with sample data: made-up meals and workouts so you can try every screen.
                </Muted>
                </Stack>
              </Reveal>
            </Stack>
          </View>
        </View>

        <Marquee />

        {/* ---------- Stat strip ---------- */}
        <View onLayout={(e) => onSectionLayout('stats', e)} style={[styles.inner, { paddingHorizontal: gutter }]}>
          <FadeIn shown={!!seen.stats}>
            <View style={[styles.statStrip, isPhone ? { flexWrap: 'wrap' } : null]}>
              {STATS.map((s, i) => (
                <View key={s.label} style={[styles.statCell, isPhone ? { width: '50%', borderLeftWidth: i % 2 ? 1 : 0, borderTopWidth: i > 1 ? 1 : 0 } : { flex: 1, borderLeftWidth: i ? 1 : 0 }]}>
                  <Row align="flex-end" gap={4}>
                    {seen.stats ? <CountUp value={s.value} variant="numberXL" format={(v) => `${Math.round(v)}${s.suffix ?? ''}`} style={isPhone ? { fontSize: 48, lineHeight: 50 } : { fontSize: 72, lineHeight: 72 }} /> : <Text variant="numberXL" style={isPhone ? { fontSize: 48, lineHeight: 50 } : { fontSize: 72, lineHeight: 72 }}>{`0${s.suffix ?? ''}`}</Text>}
                  </Row>
                  <Text variant="eyebrow" color={C.accent}>{s.label}</Text>
                  <Muted variant="small">{s.body}</Muted>
                </View>
              ))}
            </View>
          </FadeIn>
        </View>

        {/* ---------- Features ---------- */}
        <View onLayout={(e) => onSectionLayout('features', e)} style={[styles.inner, { paddingHorizontal: gutter, paddingTop: isPhone ? Space.huge : 120 }]}>
          <FadeIn shown={!!seen.features}>
            <SectionHeading eyebrow="What you get" title="Built for the way you actually train." />
            <Stack gap={isPhone ? Space.xxxl : Space.huge} style={{ marginTop: isPhone ? Space.xxl : Space.huge }}>
              {FEATURES.map((f, i) => (
                <View key={f.title} style={{ flexDirection: isPhone ? 'column' : i % 2 ? 'row-reverse' : 'row', gap: isPhone ? Space.xl : Space.huge, alignItems: isPhone ? 'stretch' : 'center' }}>
                  <Stack gap={Space.md} style={isPhone ? undefined : { flex: 1 }}>
                    <Row gap={Space.md}>
                      <Text variant="numberSm" color={C.textMuted}>{String(i + 1).padStart(2, '0')}</Text>
                      <View style={{ width: 28, height: 1, backgroundColor: C.borderStrong }} />
                      <Text variant="eyebrow" color={C.accent}>{f.eyebrow}</Text>
                    </Row>
                    <Text variant="display" style={isPhone ? { fontSize: 34, lineHeight: 36 } : undefined}>{f.title}</Text>
                    <Muted style={{ fontSize: 17, lineHeight: 26, maxWidth: 520 }}>{f.body}</Muted>
                  </Stack>
                  <View style={isPhone ? undefined : { flex: 1 }}>
                    <FeatureVisual kind={f.visual} />
                  </View>
                </View>
              ))}
            </Stack>
          </FadeIn>
        </View>

        {/* ---------- How it works ---------- */}
        <View onLayout={(e) => onSectionLayout('how', e)} style={[styles.inner, { paddingHorizontal: gutter, paddingTop: isPhone ? Space.huge : 140 }]}>
          <FadeIn shown={!!seen.how}>
            <SectionHeading eyebrow="How it works" title="Three steps. Then just show up." />
            <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: Space.lg, marginTop: Space.xxl }}>
              {STEPS.map((s, i) => (
                <View key={s.title} style={[styles.step, { flex: isPhone ? undefined : 1 }]}>
                  <Text variant="numberXL" color={i === 0 ? C.accent : C.text} style={{ fontSize: 80, lineHeight: 80 }}>{String(i + 1).padStart(2, '0')}</Text>
                  <Text variant="h2">{s.title}</Text>
                  <Muted>{s.body}</Muted>
                </View>
              ))}
            </View>
          </FadeIn>
        </View>

        {/* ---------- Join / sign in ---------- */}
        <View onLayout={(e) => onSectionLayout('join', e)} style={[styles.inner, { paddingHorizontal: gutter, paddingTop: isPhone ? Space.huge : 140, paddingBottom: Space.huge }]}>
          <FadeIn shown={!!seen.join}>
            <View style={[styles.joinPanel, { flexDirection: isPhone ? 'column' : 'row', padding: isPhone ? Space.xl : Space.xxxl, gap: isPhone ? Space.xl : Space.xxxl }]}>
              <Stack gap={Space.lg} style={isPhone ? undefined : { flex: 1 }}>
                <Text variant="eyebrow" color={C.accent}>Join</Text>
                <Text variant="display" style={isPhone ? { fontSize: 38, lineHeight: 40 } : { fontSize: 56, lineHeight: 56 }}>Ready when{'\n'}you are.</Text>
                <AccentRule width={48} />
                <Stack gap={Space.md}>
                  {[
                    ['key-outline', 'Invite-only while in beta. Got a code? Use it to create your account.'],
                    ['sync-outline', 'Your data syncs between your phone and the web.'],
                    ['lock-closed-outline', 'Your log is private to you, and you can export or delete it any time.'],
                  ].map(([icon, t]) => (
                    <Row key={t} gap={Space.md} align="flex-start">
                      <Ionicons name={icon as IconName} size={18} color={C.textSecondary} style={{ marginTop: 2 }} />
                      <Text color={C.textSecondary} style={{ flex: 1 }}>{t}</Text>
                    </Row>
                  ))}
                </Stack>
              </Stack>
              <View style={isPhone ? undefined : { flex: 1, maxWidth: 460 }}>
                {sync.configured && !sync.session ? (
                  <AccountCard intro="Sign in, or create an account with your invite code." />
                ) : (
                  <Card style={{ gap: Space.md }}>
                    <Text variant="h3">{sync.session ? 'You are signed in' : 'Running on this device'}</Text>
                    <Muted variant="small">{sync.session ? sync.session.user.email ?? '' : 'Cloud accounts are not configured here, so FitCoach saves everything in this browser.'}</Muted>
                    <Button title="Open FitCoach" icon="arrow-forward" onPress={() => router.replace('/')} />
                  </Card>
                )}
              </View>
            </View>
          </FadeIn>
        </View>

        {/* ---------- Footer ---------- */}
        <View style={{ borderTopWidth: 1, borderTopColor: C.border }}>
          <Row wrap gap={Space.lg} style={[styles.inner, { paddingHorizontal: gutter, paddingVertical: Space.xl, justifyContent: 'space-between' }]}>
            <Logo size={24} />
            <Muted variant="small">© {new Date().getFullYear()} FitCoach · Food, training and coaching in one place.</Muted>
          </Row>
        </View>
      </ScrollView>

      {/* ---------- Anchored top nav ---------- */}
      <View style={[styles.nav, { paddingTop: insets.top, backgroundColor: scrolled || menuOpen ? C.glass : 'transparent', borderBottomColor: scrolled || menuOpen ? C.border : 'transparent' }]} role="navigation">
        <Row style={[styles.inner, { height: 64, paddingHorizontal: gutter }]}>
          <Pressable onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })} accessibilityRole="link" accessibilityLabel="FitCoach, back to top">
            <Logo size={28} />
          </Pressable>
          <View style={{ flex: 1 }} />
          {isPhone ? (
            <IconButton icon={menuOpen ? 'close' : 'menu'} label={menuOpen ? 'Close menu' : 'Open menu'} onPress={() => setMenuOpen((o) => !o)} />
          ) : (
            <Row gap={Space.xs}>
              {LINKS.slice(0, 2).map((l) => (
                <NavLink key={l.id} label={l.label} onPress={() => goTo(l.id)} />
              ))}
              <Button title="Sign in" size="sm" onPress={() => goTo('join')} style={{ marginLeft: Space.md }} />
            </Row>
          )}
        </Row>
        {isPhone && menuOpen ? (
          <Stack gap={0} style={{ paddingHorizontal: gutter, paddingBottom: Space.lg }}>
            {LINKS.map((l) => (
              <Pressable key={l.id} onPress={() => goTo(l.id)} accessibilityRole="link" style={({ pressed }) => [styles.menuItem, pressed ? { opacity: 0.7 } : null]}>
                <Text variant="h2">{l.label}</Text>
                <Ionicons name="arrow-forward" size={18} color={C.textSecondary} />
              </Pressable>
            ))}
            <Button title="Sign in" full size="lg" onPress={() => goTo('join')} style={{ marginTop: Space.lg }} />
          </Stack>
        ) : null}
      </View>
    </View>
  );
}

function NavLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={({ hovered }: PState) => [{ paddingHorizontal: Space.md, paddingVertical: Space.sm, borderRadius: Radius.sm }, hovered ? { backgroundColor: C.surfaceAlt } : null]}>
      {({ hovered }: PState) => (
        <Text variant="smallStrong" color={hovered ? C.text : C.textSecondary} style={{ letterSpacing: 0.4 }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  const { isPhone } = useLayout();
  return (
    <Stack gap={Space.md} style={{ maxWidth: 760 }}>
      <Text variant="eyebrow" color={C.accent}>{eyebrow}</Text>
      <Text variant="display" accessibilityRole="header" style={isPhone ? { fontSize: 40, lineHeight: 42 } : { fontSize: 64, lineHeight: 62 }}>
        {title}
      </Text>
      <AccentRule width={48} />
    </Stack>
  );
}

/** Fades/slides a section in once it scrolls into view. */
function FadeIn({ shown, children }: { shown: boolean; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (shown) p.set(withTiming(1, { duration: reduce ? 0 : 650, easing: Easing.out(Easing.cubic) }));
  }, [shown, reduce, p]);
  const style = useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ translateY: (1 - p.get()) * 28 }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** Small UI vignettes that echo the real app screens (built from the same primitives). */
function FeatureVisual({ kind }: { kind: 'food' | 'train' | 'coach' | 'progress' }) {
  if (kind === 'food') {
    return (
      <Card style={styles.visual}>
        <Row>
          <Text variant="eyebrow" color={C.textSecondary} style={{ flex: 1 }}>Lunch · photo</Text>
          <Badge kind="estimate" label="Visual estimate" />
        </Row>
        <Row align="flex-end" gap={6}>
          <Text variant="numberXL">642</Text>
          <Muted style={{ marginBottom: 8 }}>kcal</Muted>
        </Row>
        {[
          ['Protein', 48, 160, C.protein],
          ['Carbs', 61, 230, C.carbs],
          ['Fat', 22, 70, C.fat],
        ].map(([k, v, t, color]) => (
          <Stack key={k as string} gap={6}>
            <Row>
              <Text variant="smallStrong" style={{ flex: 1 }}>{k}</Text>
              <Muted variant="small">{v} g</Muted>
            </Row>
            <ProgressBar value={v as number} max={t as number} color={color as string} height={6} label={`${k} progress`} />
          </Stack>
        ))}
      </Card>
    );
  }
  if (kind === 'train') {
    return (
      <Card style={styles.visual}>
        <Row>
          <Text variant="eyebrow" color={C.textSecondary} style={{ flex: 1 }}>Upper A · 52 min</Text>
          <Badge kind="saved" label="Weight up" icon="arrow-up" />
        </Row>
        {[
          ['Bench Press', '4 × 6', '82.5 kg'],
          ['Barbell Row', '4 × 8', '70 kg'],
          ['Overhead Press', '3 × 8', '45 kg'],
        ].map(([n, sets, w], i) => (
          <Row key={n} style={{ paddingVertical: Space.sm, borderTopWidth: i ? 1 : 0, borderTopColor: C.border }}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>{n}</Text>
            <Muted variant="small" style={{ width: 56 }}>{sets}</Muted>
            <Text variant="numberSm" style={{ fontSize: 22, lineHeight: 24 }}>{w}</Text>
          </Row>
        ))}
        <Row gap={Space.sm}>
          <Ionicons name="mic-outline" size={16} color={C.textSecondary} />
          <Muted variant="small">&quot;Bench, eighty-two and a half, six reps&quot;</Muted>
        </Row>
      </Card>
    );
  }
  if (kind === 'coach') {
    return (
      <Stack gap={Space.md}>
        <View style={[styles.bubble, { alignSelf: 'flex-end', backgroundColor: C.surfaceRaised }]}>
          <Text>Weight&apos;s flat for 3 weeks. What should I change?</Text>
        </View>
        <Card tone="suggestion" style={styles.visual}>
          <Badge kind="suggestion" label="Suggestion" />
          <Text variant="bodyStrong">Lower daily target by 150 kcal</Text>
          <Muted variant="small">Your 21-day trend is +0.0 kg/wk against a −0.4 kg/wk goal. Training volume is steady, so food is the lever.</Muted>
          <Row gap={Space.sm}>
            <View style={[styles.fakeBtn, { backgroundColor: C.primary }]}><Text variant="smallStrong" color={C.onPrimary}>Accept</Text></View>
            <View style={[styles.fakeBtn, { borderWidth: 1, borderColor: C.borderStrong }]}><Text variant="smallStrong">Not now</Text></View>
          </Row>
        </Card>
      </Stack>
    );
  }
  const bars = [0.42, 0.55, 0.5, 0.63, 0.6, 0.72, 0.7, 0.81, 0.78, 0.9];
  return (
    <Card style={styles.visual}>
      <Row>
        <Text variant="eyebrow" color={C.textSecondary} style={{ flex: 1 }}>Squat · estimated 1RM</Text>
        <Badge kind="accent" label="PR" icon="trophy-outline" />
      </Row>
      <Row align="flex-end" gap={6}>
        <Text variant="numberXL" color={C.accent}>+17.5</Text>
        <Muted style={{ marginBottom: 8 }}>kg in 10 weeks</Muted>
      </Row>
      <Row align="flex-end" gap={6} style={{ height: 96 }}>
        {bars.map((b, i) => (
          <View key={i} style={{ flex: 1, height: `${b * 100}%`, borderRadius: 3, backgroundColor: i === bars.length - 1 ? C.accent : C.surfaceRaised }} />
        ))}
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  inner: { width: '100%', maxWidth: MaxWidths.wide + 160, alignSelf: 'center' },
  nav: { position: 'absolute', top: 0, left: 0, right: 0, borderBottomWidth: 1 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent },
  statStrip: { flexDirection: 'row', borderTopWidth: 2, borderBottomWidth: 2, borderColor: C.borderStrong },
  statCell: { paddingVertical: Space.xl, paddingHorizontal: Space.lg, gap: Space.sm, borderColor: C.borderStrong },
  step: { borderTopWidth: 4, borderTopColor: C.primary, paddingTop: Space.lg, gap: Space.sm },
  joinPanel: { ...Blob.a, borderWidth: 3, borderColor: C.borderStrong, backgroundColor: C.surface },
  menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Space.md, borderBottomWidth: 1, borderBottomColor: C.border },
  visual: { padding: Space.xl, gap: Space.md },
  bubble: { maxWidth: '85%', paddingHorizontal: 14, paddingVertical: 10, ...Blob.a },
  fakeBtn: { paddingHorizontal: 14, paddingVertical: 8, ...Blob.sm },
});
