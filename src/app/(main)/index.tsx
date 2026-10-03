import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Badge, Banner, Button, Card, Columns, IconButton, Muted, PageHeader, Row, SectionTitle, Screen, Stack, Text, Ionicons, ProgressBar } from '@/components/ui';
import { CaloriesRing, MacroBars } from '@/components/nutrition';
import { InsightCard, ProposalCard } from '@/components/coaching';
import { WeightSheet } from '@/components/WeightSheet';
import { useStore } from '@/store/AppStore';
import { useLayout } from '@/hooks/useLayout';
import { activeSession, activityForDay, latestWeight, pendingProposals, remainingForDay, sessionForDay, workoutForDay } from '@/lib/selectors';
import { exerciseName } from '@/lib/workouts/exercises';
import { dayMinutes } from '@/lib/workouts/generator';
import { displayWeight } from '@/lib/units';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const { state, today, storageError } = useStore();
  const { isPhone, isDesktop } = useLayout();
  const [weightOpen, setWeightOpen] = useState(false);
  const rem = remainingForDay(state, today)!;
  const pending = pendingProposals(state);
  const insight = state.insights[0];
  const name = state.profile?.name && state.profile.name !== 'there' ? `, ${state.profile.name}` : '';
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const nutrition = (
    <Card style={{ gap: Space.lg }}>
      <Row>
        <Text variant="h3" style={{ flex: 1 }}>Nutrition today</Text>
        {rem.target.adjustment ? <Badge kind="saved" label={`+${rem.target.adjustment.calorieDelta} kcal today`} /> : null}
      </Row>
      <Row wrap gap={Space.xl} align="center">
        <CaloriesRing eaten={rem.eaten.calories} target={rem.target.calories} size={isPhone ? 140 : 156} />
        <MacroBars eaten={rem.eaten} target={rem.target} />
      </Row>
      <Muted variant="small">
        {Math.round(rem.eaten.calories).toLocaleString()} eaten of {rem.target.calories.toLocaleString()} kcal
        {rem.target.adjustment ? ` (includes today's approved +${rem.target.adjustment.calorieDelta} kcal)` : ''}
      </Muted>
      <Row wrap gap={Space.sm}>
        <Button title="Snap a meal" icon="camera" onPress={() => router.push('/food/capture')} />
        <Button title="Add manually" kind="secondary" icon="add" onPress={() => router.push('/food/manual')} />
      </Row>
    </Card>
  );

  const coach = (
    <Stack gap={Space.md}>
      <SectionTitle right={pending.length > 1 ? <Button title={`All ${pending.length}`} kind="ghost" size="sm" onPress={() => router.push('/coach')} /> : undefined}>Coach</SectionTitle>
      {pending.slice(0, isDesktop ? 2 : 1).map((p) => (
        <ProposalCard key={p.id} proposal={p} compact />
      ))}
      {insight ? <InsightCard insight={insight} /> : null}
      {!pending.length && !insight ? (
        <Card tone="muted">
          <Row>
            <Ionicons name="checkmark-done" size={18} color={C.success} />
            <Text variant="small" style={{ flex: 1 }}>Nothing needs your attention. Keep logging and the coach will speak up when something is worth changing.</Text>
          </Row>
        </Card>
      ) : null}
      <Button title="Ask the coach" kind="secondary" icon="chatbubbles-outline" onPress={() => router.push('/coach')} />
    </Stack>
  );

  return (
    <Screen>
      <PageHeader
        title={`${greeting()}${name}`}
        subtitle={dateLabel}
        right={isPhone ? <IconButton icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} /> : undefined}
      />
      {storageError ? <Banner kind="danger" title="Storage problem">{storageError}</Banner> : null}
      {isDesktop ? (
        <Row align="flex-start" gap={Space.lg}>
          <Stack gap={Space.lg} style={{ flex: 1.35 }}>
            {nutrition}
            <Row align="flex-start" gap={Space.lg}>
              <View style={{ flex: 1 }}><WorkoutCard /></View>
              <View style={{ flex: 1 }}><ActivityCard onLogWeight={() => setWeightOpen(true)} /></View>
            </Row>
          </Stack>
          <View style={{ flex: 1 }}>{coach}</View>
        </Row>
      ) : (
        <Columns>
          {[
            <Stack key="a" gap={Space.lg}>
              {nutrition}
              <WorkoutCard />
            </Stack>,
            <Stack key="b" gap={Space.lg}>
              <ActivityCard onLogWeight={() => setWeightOpen(true)} />
              {coach}
            </Stack>,
          ]}
        </Columns>
      )}
      <WeightSheet visible={weightOpen} onClose={() => setWeightOpen(false)} />
    </Screen>
  );
}

function WorkoutCard() {
  const { state, today } = useStore();
  const { day, overridden } = workoutForDay(state, today);
  const done = sessionForDay(state, today);
  const active = activeSession(state);

  if (!state.plan && !overridden) {
    return (
      <Card style={{ gap: Space.sm }}>
        <Text variant="h3">Today&apos;s workout</Text>
        <Muted>No training plan yet.</Muted>
        <Button title="Set up a plan" kind="secondary" icon="barbell-outline" onPress={() => router.push('/workouts')} />
      </Card>
    );
  }
  if (!day) {
    return (
      <Card style={{ gap: Space.sm }}>
        <Row>
          <Text variant="h3" style={{ flex: 1 }}>Today&apos;s workout</Text>
          <Badge kind="neutral" label="Rest day" icon="moon-outline" />
        </Row>
        <Muted>Recovery is when you get stronger. A walk is a great way to stay active.</Muted>
        <Button title="Log a workout anyway" kind="ghost" size="sm" onPress={() => router.push('/workouts/session')} />
      </Card>
    );
  }
  return (
    <Card style={{ gap: Space.sm }}>
      <Row wrap>
        <Text variant="h3" style={{ flex: 1 }}>Today&apos;s workout</Text>
        {overridden ? <Badge kind="saved" label="Adjusted for today" /> : null}
        {done?.finishedAt ? <Badge kind="saved" label="Done" /> : null}
      </Row>
      <Text variant="bodyStrong">{day.name}</Text>
      <Muted variant="small">{day.focus} · ~{dayMinutes(day)} min</Muted>
      <Stack gap={2}>
        {day.exercises.slice(0, 5).map((e, i) => (
          <Muted key={i} variant="small">
            {exerciseName(e.exerciseId)} · {e.sets}×{e.repMin}–{e.repMax}
          </Muted>
        ))}
        {day.exercises.length > 5 ? <Muted variant="small">+{day.exercises.length - 5} more</Muted> : null}
      </Stack>
      {done?.finishedAt ? (
        <Button title="View session" kind="secondary" size="sm" onPress={() => router.push({ pathname: '/workouts/session', params: { id: done.id } })} />
      ) : (
        <Button title={active ? 'Continue workout' : 'Start workout'} icon="play" onPress={() => router.push('/workouts/session')} />
      )}
    </Card>
  );
}

function ActivityCard({ onLogWeight }: { onLogWeight: () => void }) {
  const { state, today } = useStore();
  const a = activityForDay(state, today);
  const hc = state.integrations.find((i) => i.id === 'health_connect');
  const w = latestWeight(state);
  const baseline = state.targets?.baselineSteps ?? 7000;
  return (
    <Card style={{ gap: Space.md }}>
      <Row>
        <Text variant="h3" style={{ flex: 1 }}>Daily activity</Text>
        {hc?.status === 'connected' && hc.message?.includes('Simulated') ? <Badge kind="simulated" label="Simulated sync" /> : null}
      </Row>
      {a.missing ? (
        <Stack gap={Space.sm}>
          <Muted variant="small">{hc?.status === 'connected' ? 'No activity has synced for today yet.' : 'Connect a health app or add steps manually to see activity here.'}</Muted>
          <Button title={hc?.status === 'connected' ? 'Review activity' : 'Connect activity'} kind="secondary" size="sm" icon="footsteps-outline" onPress={() => router.push('/activity')} />
        </Stack>
      ) : (
        <Pressable onPress={() => router.push('/activity')} accessibilityRole="button" accessibilityLabel="Open activity details" style={{ gap: Space.sm }}>
          <Row align="flex-end" gap={6}>
            <Text variant="number">{(a.steps ?? 0).toLocaleString()}</Text>
            <Muted style={{ marginBottom: 4 }}>steps</Muted>
          </Row>
          <ProgressBar value={a.steps ?? 0} max={baseline} color={C.info} />
          <Muted variant="small">
            Your target assumes ~{baseline.toLocaleString()} steps. {a.activeKcal ? `~${a.activeKcal} active kcal (device estimate)` : ''}
          </Muted>
          {a.otherSources.length ? <Muted variant="small">Counted from {a.chosen?.origin}; {a.otherSources.length} other source{a.otherSources.length > 1 ? 's' : ''} ignored to avoid double counting.</Muted> : null}
        </Pressable>
      )}
      <View style={{ height: 1, backgroundColor: C.border }} />
      <Row>
        <Stack gap={0} style={{ flex: 1 }}>
          <Muted variant="caption">BODY WEIGHT</Muted>
          <Text variant="bodyStrong">{w ? displayWeight(w.weightKg, state.settings.units) : 'Not logged'}</Text>
          {w ? <Muted variant="small">{w.date === today ? 'Today' : `Last: ${w.date}`}</Muted> : null}
        </Stack>
        <Button title={w?.date === today ? 'Update' : 'Log weight'} kind="secondary" size="sm" icon="scale-outline" onPress={onLogWeight} />
      </Row>
    </Card>
  );
}
