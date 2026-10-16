import React, { useMemo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Button, Card, Chip, EmptyState, IconButton, InfoTip, Muted, PageHeader, Row, Screen, SectionTitle, Segmented, Stack, Stat, Text, Columns } from '@/components/ui';
import { Timeline } from '@/components/Timeline';
import { milestones } from '@/lib/streaks';
import { calorieStats, loggedDaysLabel, MIN_LOGGED_DAYS } from '@/lib/calorieStats';
import { BarChart, LineChart } from '@/components/charts';
import { WeightSheet } from '@/components/WeightSheet';
import { ProgressPhotosSection } from '@/components/ProgressPhotos';
import { useStore } from '@/store/AppStore';
import { useAct } from '@/components/Toast';
import { dayTargets, hasActivitySource, live, totalsForDay } from '@/lib/selectors';
import { addDays, formatDateLabel, lastNDates, nowISO, parseISODate } from '@/lib/dates';
import { displayWeight, weightValue, weightUnit } from '@/lib/units';
import { weightSlopePerDay } from '@/lib/coaching/adaptive';
import { progressionSeries } from '@/lib/workouts/progression';
import { exerciseName } from '@/lib/workouts/exercises';
import { weeklyMuscleVolume } from '@/lib/workouts/sessionStats';
import type { WeightEntry } from '@/lib/types';

type Tab = 'calories' | 'weight' | 'strength' | 'photos';
const TABS: Tab[] = ['calories', 'weight', 'strength', 'photos'];
const shortDate = (d: string) => parseISODate(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function Progress() {
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'calories');
  const { state } = useStore();
  const narrow = useWindowDimensions().width < 480;
  const tabOptions = [{ value: 'calories', label: 'Calories' }, { value: 'weight', label: 'Weight' }, { value: 'strength', label: 'Strength' }, { value: 'photos', label: 'Photos' }] as const;
  const pick = (t: Tab) => { setTab(t); router.setParams({ tab: t }); };
  return (
    <Screen>
      <PageHeader title="Progress" subtitle="Calories, body weight, strength and photos" right={hasActivitySource(state) ? <Button title="Activity" kind="secondary" icon="footsteps-outline" onPress={() => router.push('/activity')} /> : undefined} />
      {narrow ? (
        // four segments don't fit one line at 320px without wrapping mid-word
        <Row wrap gap={6}>
          {tabOptions.map((o) => <Chip key={o.value} label={o.label} selected={o.value === tab} onPress={() => pick(o.value)} />)}
        </Row>
      ) : (
        <Segmented label="Progress view" value={tab} onChange={pick} options={[...tabOptions]} />
      )}
      {tab === 'calories' && <Calories />}
      {tab === 'weight' && <Weight />}
      {tab === 'strength' && <Strength />}
      {tab === 'photos' && <ProgressPhotosSection />}
      <Milestones />
    </Screen>
  );
}

function Milestones() {
  const { state, today } = useStore();
  const units = state.settings.units;
  const items = useMemo(() => milestones(state, { today, formatWeight: (kg) => displayWeight(kg, units) }), [state, today, units]);
  return (
    <Stack gap={Space.lg} style={{ marginTop: Space.xl }}>
      <SectionTitle>Milestones</SectionTitle>
      {items.length ? (
        <Timeline items={items} />
      ) : (
        <EmptyState icon="flag-outline" title="Your story starts here" body="Log meals, finish workouts and weigh in. Firsts, streaks, weight changes and PRs show up on this timeline." />
      )}
    </Stack>
  );
}

function Calories() {
  const { state, today } = useStore();
  const [range, setRange] = useState<'14' | '30'>('14');
  const dates = lastNDates(parseInt(range, 10), today);
  const rows = dates.map((d) => ({ d, eaten: totalsForDay(state, d), target: dayTargets(state, d)! }));
  const stats = calorieStats(rows, today);
  const hasLogged = rows.some((r) => r.eaten.calories > 0 && r.d !== today);
  const target = state.targets!.calories;
  return (
    <Stack gap={Space.lg}>
      <Card style={{ gap: Space.md }}>
        <Row wrap>
          <Text variant="h3">Daily calories</Text>
          <InfoTip title="Reading this chart">{`Dashed line = your ongoing target (${target.toLocaleString()} kcal). Orange bars are more than 10% over that day's target. Grey ticks are days with nothing logged.`}</InfoTip>
          <View style={{ flexGrow: 1 }} />
          <View style={{ flexBasis: 190, flexGrow: 1, maxWidth: 240 }}>
            <Segmented label="Range" value={range} onChange={setRange} options={[{ value: '14', label: '14 days' }, { value: '30', label: '30 days' }]} />
          </View>
        </Row>
        {!hasLogged ? (
          <EmptyState icon="bar-chart-outline" title="No data yet" body="Log meals for a few days to see your trend." />
        ) : (
          <>
            <BarChart
              label={`Daily calories for the last ${range} days compared with a ${target} kcal target`}
              bars={rows.map((r) => ({ x: shortDate(r.d), y: r.eaten.calories > 0 ? r.eaten.calories : null, highlight: r.eaten.calories > r.target.calories * 1.1 }))}
              target={target}
              format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))}
            />
          </>
        )}
      </Card>
      <Columns>
        {[
          <Card key="a"><Stat label="Average intake" value={stats.avg ? stats.avg.toLocaleString() : '—'} unit="kcal" sub={stats.ready ? `${loggedDaysLabel(stats.count)} (today excluded)` : `${stats.count} of ${MIN_LOGGED_DAYS} logged days needed (today excluded)`} /></Card>,
          <Card key="b"><Stat label="Days near target" value={stats.ready ? `${stats.within}/${stats.count}` : '—'} sub={stats.ready ? 'within 10% either way' : `${stats.count} of ${MIN_LOGGED_DAYS} logged days needed`} /></Card>,
          <Card key="c"><Stat label="Average protein" value={stats.avgProtein || '—'} unit="g" sub={stats.ready ? `Goal ${state.targets!.proteinG} g` : `${stats.count} of ${MIN_LOGGED_DAYS} logged days needed`} color={C.protein} /></Card>,
        ]}
      </Columns>
    </Stack>
  );
}

function Weight() {
  const { state, today } = useStore();
  const doAct = useAct();
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState<WeightEntry | undefined>();
  const units = state.settings.units;
  const weights = live(state.weights).sort((a, b) => a.date.localeCompare(b.date)).filter((w) => w.date > addDays(today, -60));
  const points = weights.map((w) => ({ x: shortDate(w.date), y: weightValue(w.weightKg, units) }));
  // 7-day trailing average as the trend line
  const trend = weights.map((w) => {
    const win = weights.filter((x) => x.date <= w.date && x.date > addDays(w.date, -7));
    return { x: w.date, y: weightValue(win.reduce((s, x) => s + x.weightKg, 0) / win.length, units) };
  });
  const recent = weights.filter((w) => w.date > addDays(today, -21));
  const perWeek = recent.length >= 4 ? weightSlopePerDay(recent) * 7 : undefined;
  const first = weights[0];
  const last = weights[weights.length - 1];

  return (
    <Stack gap={Space.lg}>
      <Card style={{ gap: Space.md }}>
        <Row>
          <Text variant="h3">Body weight</Text>
          <InfoTip title="Reading this chart">Solid line = daily weigh-ins. Dashed line = 7-day average, which smooths out water and food swings.</InfoTip>
          <View style={{ flex: 1 }} />
          <Button title="Log weight" size="sm" icon="add" onPress={() => setOpen(true)} />
        </Row>
        {points.length < 2 ? (
          <EmptyState icon="scale-outline" title="Not enough weigh-ins yet" body="Weigh in a few mornings a week. The trend matters more than any single day." />
        ) : (
          <>
            <LineChart label="Body weight over time with 7-day average" points={points} trend={trend} format={(v) => v.toFixed(0)} />
          </>
        )}
      </Card>
      <Columns>
        {[
          <Card key="a"><Stat label="Latest" value={last ? weightValue(last.weightKg, units) : '—'} unit={weightUnit(units)} sub={last ? formatDateLabel(last.date, today) : undefined} /></Card>,
          <Card key="b"><Stat label="3-week trend" value={perWeek !== undefined ? `${perWeek >= 0 ? '+' : ''}${weightValue(perWeek, units, 2)}` : '—'} unit={`${weightUnit(units)}/wk`} sub={perWeek === undefined ? 'Needs 4+ weigh-ins' : undefined} /></Card>,
          <Card key="c"><Stat label="Change (60 days)" value={first && last && first !== last ? `${last.weightKg - first.weightKg >= 0 ? '+' : ''}${weightValue(last.weightKg - first.weightKg, units)}` : '—'} unit={weightUnit(units)} /></Card>,
        ]}
      </Columns>
      {weights.length ? (
        <Card style={{ gap: 4 }}>
          <Text variant="h3">Recent weigh-ins</Text>
          {[...weights].reverse().slice(0, 10).map((w) => (
            <Row key={w.id}>
              <Muted variant="small" style={{ flex: 1 }}>{shortDate(w.date)}</Muted>
              <Text variant="smallStrong">{displayWeight(w.weightKg, units)}</Text>
              <IconButton icon="trash-outline" label={`Delete weigh-in on ${w.date}`} size={16} color={C.textSecondary} onPress={() => { if (doAct({ type: 'DELETE_WEIGHT', id: w.id, now: nowISO() })) setRemoved(w); }} />
            </Row>
          ))}
        </Card>
      ) : null}
      {removed ? (
        <Card tone="muted" style={{ padding: Space.md }}>
          <Row gap={Space.sm}>
            <Muted variant="small" style={{ flex: 1 }}>Weigh-in on {shortDate(removed.date)} deleted.</Muted>
            <Button title="Undo" kind="secondary" size="sm" onPress={() => { if (doAct({ type: 'LOG_WEIGHT', entry: { ...removed, updatedAt: nowISO() } }, 'Weigh-in restored')) setRemoved(undefined); }} />
            <IconButton icon="close" label="Dismiss" size={16} color={C.textSecondary} onPress={() => setRemoved(undefined)} />
          </Row>
        </Card>
      ) : null}
      <WeightSheet visible={open} onClose={() => setOpen(false)} />
    </Stack>
  );
}

function WeeklyVolume() {
  const { state, today } = useStore();
  const rows = weeklyMuscleVolume(live(state.sessions), today);
  if (!rows.length) return null;
  return (
    <Card style={{ gap: 4 }}>
      <Row>
        <Text variant="h3" style={{ flex: 1 }}>Weekly volume</Text>
        <InfoTip title="Weekly volume">Working sets per muscle (warm-ups excluded) in the last 7 days, compared with the 7 days before.</InfoTip>
      </Row>
      {rows.map((r) => (
        <Row key={r.muscle}>
          <Text variant="small" style={{ flex: 1, textTransform: 'capitalize' }}>{r.muscle.replace('_', ' ')}</Text>
          <Text variant="smallStrong">{r.sets} sets</Text>
          <Muted variant="small" style={{ width: 90, textAlign: 'right' }}>prev {r.prevSets}</Muted>
        </Row>
      ))}
    </Card>
  );
}

function Strength() {
  const { state } = useStore();
  const units = state.settings.units;
  const sessions = live(state.sessions).filter((s) => s.finishedAt);
  const exIds = useMemo(() => {
    const count = new Map<string, number>();
    for (const s of sessions) for (const id of new Set(s.sets.filter((x) => x.weightKg > 0).map((x) => x.exerciseId))) count.set(id, (count.get(id) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [sessions]);
  const [sel, setSel] = useState<string | undefined>();
  const exId = sel ?? exIds[0];
  if (!exId) return <Stack gap={Space.lg}><WeeklyVolume /><EmptyState icon="barbell-outline" title="No lifts logged yet" body="Finish a workout and your strength progression shows here." action={<Button title="Start a workout" icon="play" onPress={() => router.push('/workouts/session')} />} /></Stack>;
  const series = progressionSeries(exId, sessions);
  const best = series.reduce((m, s) => Math.max(m, s.e1rm), 0);
  const firstE = series[0]?.e1rm ?? 0;
  return (
    <Stack gap={Space.lg}>
      <WeeklyVolume />
      <Row wrap gap={6}>
        {exIds.slice(0, 10).map((id) => (
          <Chip key={id} label={exerciseName(id)} selected={id === exId} onPress={() => setSel(id)} />
        ))}
      </Row>
      <Card style={{ gap: Space.md }}>
        <Row>
          <Text variant="h3" style={{ flex: 1 }}>{exerciseName(exId)}: estimated best lift</Text>
          <InfoTip title="Estimated best lift">Estimated from your best set each session (Epley formula) as the heaviest single rep you could probably lift. It&apos;s a progress indicator, not a max you need to test.</InfoTip>
        </Row>
        {series.length < 2 ? <Muted>Log this lift in at least two sessions to see a trend.</Muted> : <LineChart label={`Estimated best lift for ${exerciseName(exId)}`} points={series.map((s) => ({ x: shortDate(s.date), y: weightValue(s.e1rm, units) }))} format={(v) => v.toFixed(0)} color={C.protein} />}
      </Card>
      <Columns>
        {[
          <Card key="a"><Stat label="Best estimated lift" value={weightValue(best, units, 0)} unit={weightUnit(units)} /></Card>,
          <Card key="b"><Stat label="Change since first session" value={`${best - firstE >= 0 ? '+' : ''}${weightValue(best - firstE, units, 0)}`} unit={weightUnit(units)} sub={`${series.length} sessions`} /></Card>,
        ]}
      </Columns>
      <Card style={{ gap: 4 }}>
        <Text variant="h3">Session history</Text>
        {[...series].reverse().slice(0, 8).map((s, i) => (
          <Row key={i}>
            <Muted variant="small" style={{ flex: 1 }}>{shortDate(s.date)}</Muted>
            <Text variant="small">Top set {displayWeight(s.topWeightKg, units)}</Text>
            <Muted variant="small" style={{ width: 110, textAlign: 'right' }}>Est. best {weightValue(s.e1rm, units, 0)}</Muted>
          </Row>
        ))}
      </Card>
    </Stack>
  );
}
