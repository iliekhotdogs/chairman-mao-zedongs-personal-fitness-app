import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { router } from 'expo-router';

import { C, Radius, Space } from '@/constants/theme';
import { useLayout } from '@/hooks/useLayout';
import { useStore } from '@/store/AppStore';
import { AccentRule, Button, CountUp, Muted, ProgressBar, Row, Stack, Text } from './ui';
import { activeSession, remainingForDay } from '@/lib/selectors';
import { formatCountdown, nextWorkout, streakForState, weekTraining } from '@/lib/streaks';
import { weightUnit, weightValue } from '@/lib/units';
import { WEEKDAY_SHORT, weekday } from '@/lib/dates';

/** Big-number band at the top of Today: streak, calories, this week's training and the next workout. */
export function TodayHero({ greeting, dateLabel }: { greeting: string; dateLabel: string }) {
  const { state, today } = useStore();
  const { isPhone, isDesktop } = useLayout();
  const rem = remainingForDay(state, today);
  const streak = streakForState(state, today);
  const week = weekTraining(state.sessions, today);
  const units = state.settings.units;
  const numVariant = isPhone ? 'number' : 'numberXL';

  const stats = (
    <View style={[styles.stats, isPhone ? { gap: Space.md } : { gap: Space.xl }]}>
      <StatCell label="Day streak" sub={streak.best > streak.current ? `Best ${streak.best}` : streak.activeToday ? 'Logged today' : streak.current ? 'Log today to keep it' : 'Log a meal to start'}>
        <CountUp value={streak.current} variant={numVariant} color={C.accent} />
      </StatCell>
      <StatCell label="Calories" sub={rem ? `of ${rem.target.calories.toLocaleString()} kcal` : undefined}>
        <CountUp value={Math.round(rem?.eaten.calories ?? 0)} variant={numVariant} />
        {rem ? <ProgressBar value={rem.eaten.calories} max={rem.target.calories} height={4} over={rem.eaten.calories > rem.target.calories * 1.1} label="Calories eaten today" /> : null}
      </StatCell>
      <StatCell label="This week" sub={week.volumeKg ? `${weightValue(week.volumeKg, units, 0).toLocaleString()} ${weightUnit(units)} lifted` : 'workouts done'}>
        <CountUp value={week.workouts} variant={numVariant} />
      </StatCell>
    </View>
  );

  return (
    <View style={[styles.band, { padding: isPhone ? Space.lg : Space.xxl }]}>
      <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
        <Svg width="100%" height="100%" viewBox="0 0 1000 400" preserveAspectRatio="xMaxYMid slice">
          <Defs>
            <RadialGradient id="todayGlow" cx="900" cy="40" r="520" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={C.accent} stopOpacity="0.13" />
              <Stop offset="1" stopColor={C.accent} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="1000" height="400" fill="url(#todayGlow)" />
        </Svg>
      </View>
      <View style={{ flexDirection: isDesktop ? 'row' : 'column', gap: isPhone ? Space.lg : Space.xl, alignItems: isDesktop ? 'flex-end' : 'stretch' }}>
        <Stack gap={Space.lg} style={isDesktop ? { flex: 1.5 } : undefined}>
          <Stack gap={Space.sm}>
            <Text variant="eyebrow" color={C.textSecondary}>{dateLabel}</Text>
            <Text variant="display" accessibilityRole="header" style={isPhone ? { fontSize: 36, lineHeight: 38 } : undefined}>
              {greeting}
            </Text>
            <AccentRule />
          </Stack>
          {stats}
        </Stack>
        <View style={isDesktop ? { flex: 1 } : undefined}>
          <NextWorkoutTile />
        </View>
      </View>
    </View>
  );
}

function StatCell({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
      <Text variant="eyebrow" color={C.textSecondary} numberOfLines={1}>{label}</Text>
      {children}
      {sub ? <Muted variant="small" numberOfLines={2}>{sub}</Muted> : null}
    </Stack>
  );
}

function NextWorkoutTile() {
  const { state, today } = useStore();
  const next = nextWorkout(state, today);
  const active = activeSession(state);
  const [now, setNow] = useState(() => Date.now());
  const countingDown = !!next && !next.isToday;
  useEffect(() => {
    if (!countingDown) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [countingDown]);

  if (!state.plan && !next) {
    return (
      <View style={styles.tile}>
        <Text variant="eyebrow" color={C.textSecondary}>Next workout</Text>
        <Text variant="h2">No plan yet</Text>
        <Muted variant="small">Set up a plan and your next session counts down here.</Muted>
        <Button title="Set up a plan" kind="secondary" size="sm" icon="barbell-outline" onPress={() => router.push('/workouts')} />
      </View>
    );
  }
  if (!next) {
    return (
      <View style={styles.tile}>
        <Text variant="eyebrow" color={C.textSecondary}>Next workout</Text>
        <Text variant="h2">Nothing scheduled</Text>
        <Muted variant="small">No plan days in the next week. Log a session any time.</Muted>
        <Button title="Log a workout" kind="secondary" size="sm" icon="add" onPress={() => router.push('/workouts/session')} />
      </View>
    );
  }
  return (
    <View style={[styles.tile, next.isToday ? { borderColor: C.primaryBorder } : null]}>
      <Row>
        <Text variant="eyebrow" color={next.isToday ? C.accent : C.textSecondary} style={{ flex: 1 }}>
          {next.isToday ? 'Today' : `Next · ${WEEKDAY_SHORT[weekday(next.date)]}`}
        </Text>
        <Muted variant="small">{next.day.exercises.length} exercises</Muted>
      </Row>
      <Text variant="h2" numberOfLines={1}>{next.day.name}</Text>
      {next.isToday ? (
        <Button title={active ? 'Resume workout' : 'Start workout'} icon="play" onPress={() => router.push('/workouts/session')} />
      ) : (
        <Stack gap={2}>
          <Text variant="numberSm" accessibilityLabel={`Starts in ${formatCountdown(next.startsAt.getTime() - now)}`} style={{ fontVariant: ['tabular-nums'] }}>
            {formatCountdown(next.startsAt.getTime() - now)}
          </Text>
          <Muted variant="small">until {next.day.focus.toLowerCase()} day</Muted>
        </Stack>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { borderRadius: Radius.xl, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, overflow: 'hidden' },
  stats: { flexDirection: 'row', alignItems: 'flex-start' },
  tile: { borderRadius: Radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.bgDeep, padding: Space.lg, gap: Space.sm },
});
