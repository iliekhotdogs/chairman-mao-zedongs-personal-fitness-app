import React, { useMemo, useState } from 'react';
import { router } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Button, Card, Chip, EmptyState, IconButton, Muted, PageHeader, Row, Screen, Segmented, Stack, Stat, Text, Columns } from '@/components/ui';
import { BarChart, LineChart } from '@/components/charts';
import { WeightSheet } from '@/components/WeightSheet';
import { useStore } from '@/store/AppStore';
import { useAct } from '@/components/Toast';
import { dayTargets, live, totalsForDay } from '@/lib/selectors';
import { addDays, lastNDates, nowISO, parseISODate } from '@/lib/dates';
import { displayWeight, weightValue, weightUnit } from '@/lib/units';
import { weightSlopePerDay } from '@/lib/coaching/adaptive';
import { progressionSeries } from '@/lib/workouts/progression';
import { exerciseName } from '@/lib/workouts/exercises';

type Tab = 'calories' | 'weight' | 'strength';
const shortDate = (d: string) => parseISODate(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function Progress() {
  const [tab, setTab] = useState<Tab>('calories');
  return (
    <Screen>
      <PageHeader title="Progress" subtitle="Calories, body weight and strength" right={<Button title="Activity" kind="secondary" icon="footsteps-outline" onPress={() => router.push('/activity')} />} />
      <Segmented label="Progress view" value={tab} onChange={setTab} options={[{ value: 'calories', label: 'Calories' }, { value: 'weight', label: 'Weight' }, { value: 'strength', label: 'Strength' }]} />
      {tab === 'calories' && <Calories />}
      {tab === 'weight' && <Weight />}
      {tab === 'strength' && <Strength />}
    </Screen>
  );
}

function Calories() {
  const { state, today } = useStore();
  const [range, setRange] = useState<'14' | '30'>('14');
  const dates = lastNDates(parseInt(range, 10), today);
  const rows = dates.map((d) => ({ d, eaten: totalsForDay(state, d), target: dayTargets(state, d)! }));
  const logged = rows.filter((r) => r.eaten.calories > 0 && r.d !== today);
  const avg = logged.length ? Math.round(logged.reduce((s, r) => s + r.eaten.calories, 0) / logged.length) : 0;
  const avgP = logged.length ? Math.round(logged.reduce((s, r) => s + r.eaten.proteinG, 0) / logged.length) : 0;
  const within = logged.filter((r) => Math.abs(r.eaten.calories - r.target.calories) <= r.target.calories * 0.1).length;
  const target = state.targets!.calories;
  return (
    <Stack gap={Space.lg}>
      <Card style={{ gap: Space.md }}>
        <Row>
          <Text variant="h3" style={{ flex: 1 }}>Daily calories</Text>
          <Segmented label="Range" value={range} onChange={setRange} options={[{ value: '14', label: '14 days' }, { value: '30', label: '30 days' }]} />
        </Row>
        {logged.length === 0 ? (
          <EmptyState icon="bar-chart-outline" title="No data yet" body="Log meals for a few days to see your trend." />
        ) : (
          <>
            <BarChart
              label={`Daily calories for the last ${range} days compared with a ${target} kcal target`}
              bars={rows.map((r) => ({ x: shortDate(r.d), y: r.eaten.calories > 0 ? r.eaten.calories : null, highlight: r.eaten.calories > r.target.calories * 1.1 }))}
              target={target}
              format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))}
            />
            <Muted variant="small">Dashed line = your ongoing target ({target.toLocaleString()} kcal). Orange bars are more than 10% over that day&apos;s target. Grey ticks are days with nothing logged.</Muted>
          </>
        )}
      </Card>
      <Columns>
        {[
          <Card key="a"><Stat label="Average intake" value={avg ? avg.toLocaleString() : '—'} unit="kcal" sub={`${logged.length} logged days (today excluded)`} /></Card>,
          <Card key="b"><Stat label="Within ±10% of target" value={logged.length ? `${within}/${logged.length}` : '—'} sub="days" /></Card>,
          <Card key="c"><Stat label="Average protein" value={avgP || '—'} unit="g" sub={`Goal ${state.targets!.proteinG} g`} color={C.protein} /></Card>,
        ]}
      </Columns>
    </Stack>
  );
}

function Weight() {
  const { state, today } = useStore();
  const doAct = useAct();
  const [open, setOpen] = useState(false);
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
          <Text variant="h3" style={{ flex: 1 }}>Body weight</Text>
          <Button title="Log weight" size="sm" icon="add" onPress={() => setOpen(true)} />
        </Row>
        {points.length < 2 ? (
          <EmptyState icon="scale-outline" title="Not enough weigh-ins yet" body="Weigh in a few mornings a week. The trend matters more than any single day." action={<Button title="Log weight" icon="add" onPress={() => setOpen(true)} />} />
        ) : (
          <>
            <LineChart label="Body weight over time with 7-day average" points={points} trend={trend} format={(v) => v.toFixed(0)} />
            <Muted variant="small">Solid line = daily weigh-ins. Dashed line = 7-day average, which smooths out water and food swings.</Muted>
          </>
        )}
      </Card>
      <Columns>
        {[
          <Card key="a"><Stat label="Latest" value={last ? weightValue(last.weightKg, units) : '—'} unit={weightUnit(units)} sub={last?.date} /></Card>,
          <Card key="b"><Stat label="3-week trend" value={perWeek !== undefined ? `${perWeek >= 0 ? '+' : ''}${weightValue(perWeek, units, 2)}` : '—'} unit={`${weightUnit(units)}/wk`} sub={perWeek === undefined ? 'Needs 4+ weigh-ins' : undefined} /></Card>,
          <Card key="c"><Stat label="Change (60 days)" value={first && last ? `${last.weightKg - first.weightKg >= 0 ? '+' : ''}${weightValue(last.weightKg - first.weightKg, units)}` : '—'} unit={weightUnit(units)} /></Card>,
        ]}
      </Columns>
      {weights.length ? (
        <Card style={{ gap: 4 }}>
          <Text variant="h3">Recent weigh-ins</Text>
          {[...weights].reverse().slice(0, 10).map((w) => (
            <Row key={w.id}>
              <Muted variant="small" style={{ flex: 1 }}>{shortDate(w.date)}</Muted>
              <Text variant="smallStrong">{displayWeight(w.weightKg, units)}</Text>
              <IconButton icon="trash-outline" label={`Delete weigh-in on ${w.date}`} size={16} color={C.textSecondary} onPress={() => doAct({ type: 'DELETE_WEIGHT', id: w.id, now: nowISO() }, 'Weigh-in deleted')} />
            </Row>
          ))}
        </Card>
      ) : null}
      <WeightSheet visible={open} onClose={() => setOpen(false)} />
    </Stack>
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
  if (!exId) return <EmptyState icon="barbell-outline" title="No lifts logged yet" body="Finish a workout and your strength progression shows here." action={<Button title="Start a workout" icon="play" onPress={() => router.push('/workouts/session')} />} />;
  const series = progressionSeries(exId, sessions);
  const best = series.reduce((m, s) => Math.max(m, s.e1rm), 0);
  const firstE = series[0]?.e1rm ?? 0;
  return (
    <Stack gap={Space.lg}>
      <Row wrap gap={6}>
        {exIds.slice(0, 10).map((id) => (
          <Chip key={id} label={exerciseName(id)} selected={id === exId} onPress={() => setSel(id)} />
        ))}
      </Row>
      <Card style={{ gap: Space.md }}>
        <Text variant="h3">{exerciseName(exId)}: estimated 1-rep max</Text>
        {series.length < 2 ? <Muted>Log this lift in at least two sessions to see a trend.</Muted> : <LineChart label={`Estimated one rep max for ${exerciseName(exId)}`} points={series.map((s) => ({ x: shortDate(s.date), y: weightValue(s.e1rm, units) }))} format={(v) => v.toFixed(0)} color={C.protein} />}
        <Muted variant="small">Estimated from your best set each session (Epley formula). It&apos;s a progress indicator, not a max you need to test.</Muted>
      </Card>
      <Columns>
        {[
          <Card key="a"><Stat label="Best estimated 1RM" value={weightValue(best, units, 0)} unit={weightUnit(units)} /></Card>,
          <Card key="b"><Stat label="Change since first session" value={`${best - firstE >= 0 ? '+' : ''}${weightValue(best - firstE, units, 0)}`} unit={weightUnit(units)} sub={`${series.length} sessions`} /></Card>,
        ]}
      </Columns>
      <Card style={{ gap: 4 }}>
        <Text variant="h3">Session history</Text>
        {[...series].reverse().slice(0, 8).map((s, i) => (
          <Row key={i}>
            <Muted variant="small" style={{ flex: 1 }}>{shortDate(s.date)}</Muted>
            <Text variant="small">Top set {displayWeight(s.topWeightKg, units)}</Text>
            <Muted variant="small" style={{ width: 110, textAlign: 'right' }}>e1RM {weightValue(s.e1rm, units, 0)}</Muted>
          </Row>
        ))}
      </Card>
    </Stack>
  );
}
