import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Button, Card, Chip, Field, IconButton, Muted, NumberField, PageHeader, Row, Screen, Sheet, Stack, Text } from '@/components/ui';
import { useStore } from '@/store/AppStore';
import { useAct } from '@/components/Toast';
import { EXERCISES, exerciseName } from '@/lib/workouts/exercises';
import { live } from '@/lib/selectors';
import { newId } from '@/lib/id';
import { nowISO, WEEKDAY_SHORT } from '@/lib/dates';
import type { WorkoutDay, WorkoutPlan } from '@/lib/types';

function blankDay(n: number): WorkoutDay {
  return { id: newId(), name: `Day ${n}`, focus: 'Custom', exercises: [] };
}

export default function RoutineEditor() {
  const { state } = useStore();
  const doAct = useAct();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = id ? live(state.routines).find((r) => r.id === id) : undefined;
  const [name, setName] = useState(existing?.name ?? 'My routine');
  const [days, setDays] = useState<WorkoutDay[]>(existing?.days ?? [blankDay(1)]);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const updateDay = (dayId: string, fn: (d: WorkoutDay) => WorkoutDay) => setDays(days.map((d) => (d.id === dayId ? fn(d) : d)));
  const valid = name.trim() && days.length && days.every((d) => d.exercises.length && d.name.trim());

  const save = (makeActive: boolean) => {
    const now = nowISO();
    const routine: WorkoutPlan = {
      id: existing?.id ?? newId(),
      name: name.trim(),
      source: 'user_created',
      days,
      rationale: ['Built by you.'],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (!doAct({ type: 'SAVE_ROUTINE', routine }, 'Routine saved')) return;
    if (makeActive || state.plan?.id === routine.id) doAct({ type: 'SET_PLAN', plan: routine, confirmed: true }, makeActive ? 'Routine saved and set as your plan' : undefined);
    router.replace('/workouts');
  };

  return (
    <Screen maxWidth={860}>
      <PageHeader title={existing ? 'Edit routine' : 'New routine'} right={<Button title="Cancel" kind="ghost" onPress={() => router.back()} />} />
      <Field label="Routine name" value={name} onChangeText={setName} />
      {days.map((d, di) => (
        <Card key={d.id} style={{ gap: Space.sm }}>
          <Row>
            <Field value={d.name} onChangeText={(v) => updateDay(d.id, (x) => ({ ...x, name: v }))} style={{ flex: 1 }} accessibilityLabel={`Day ${di + 1} name`} />
            <IconButton icon="trash-outline" label={`Remove ${d.name}`} color={C.textSecondary} onPress={() => setDays(days.filter((x) => x.id !== d.id))} />
          </Row>
          <Text variant="smallStrong">Day of week (optional)</Text>
          <Row wrap gap={6}>
            {WEEKDAY_SHORT.map((w, i) => (
              <Chip key={w} label={w} selected={d.weekday === i} onPress={() => updateDay(d.id, (x) => ({ ...x, weekday: x.weekday === i ? undefined : i }))} />
            ))}
          </Row>
          {d.exercises.map((e, ei) => (
            <Card key={`${e.exerciseId}-${ei}`} tone="muted" style={{ padding: Space.md, gap: Space.sm }}>
              <Row>
                <Text variant="bodyStrong" style={{ flex: 1 }}>{exerciseName(e.exerciseId)}</Text>
                <IconButton icon="close" label={`Remove ${exerciseName(e.exerciseId)}`} size={18} color={C.textSecondary} onPress={() => updateDay(d.id, (x) => ({ ...x, exercises: x.exercises.filter((_, j) => j !== ei) }))} />
              </Row>
              <Row wrap gap={Space.sm}>
                {(
                  [
                    ['Sets', 'sets'],
                    ['Min reps', 'repMin'],
                    ['Max reps', 'repMax'],
                    ['Rest (sec)', 'restSec'],
                  ] as const
                ).map(([label, key]) => (
                  <NumberField
                    key={key}
                    label={label}
                    value={e[key]}
                    onChange={(v) => updateDay(d.id, (x) => ({ ...x, exercises: x.exercises.map((y, j) => (j === ei ? { ...y, [key]: Math.max(key === 'restSec' ? 0 : 1, Math.round(v ?? 0)) } : y)) }))}
                    style={{ width: 96 }}
                  />
                ))}
              </Row>
              {e.repMin > e.repMax ? <Text variant="small" color={C.danger}>Min reps should be ≤ max reps.</Text> : null}
            </Card>
          ))}
          <Button title="Add exercise" kind="secondary" size="sm" icon="add" onPress={() => setPickFor(d.id)} />
        </Card>
      ))}
      <Button title="Add a day" kind="ghost" icon="add" onPress={() => setDays([...days, blankDay(days.length + 1)])} />
      {!valid ? <Muted variant="small">Each day needs a name and at least one exercise.</Muted> : null}
      <Row wrap gap={Space.sm}>
        <Button title="Save routine" icon="checkmark" onPress={() => save(false)} disabled={!valid || days.some((d) => d.exercises.some((e) => e.repMin > e.repMax))} />
        {state.plan?.id !== existing?.id ? <Button title="Save & use as my plan" kind="secondary" onPress={() => save(true)} disabled={!valid} /> : null}
      </Row>

      <Sheet visible={!!pickFor} onClose={() => setPickFor(null)} title="Add exercise">
        <Field placeholder="Search exercises" value={q} onChangeText={setQ} accessibilityLabel="Search exercises" />
        <Stack gap={4}>
          {EXERCISES.filter((e) => !q.trim() || `${e.name} ${e.aliases.join(' ')}`.toLowerCase().includes(q.toLowerCase())).map((e) => (
            <Row key={e.id} style={{ paddingVertical: 4 }}>
              <Stack gap={0} style={{ flex: 1 }}>
                <Text variant="smallStrong">{e.name}</Text>
                <Muted variant="small">{e.primary.replace('_', ' ')} · {e.equipment.includes('bodyweight') ? 'no equipment needed' : e.loadType}</Muted>
              </Stack>
              <Button
                title="Add"
                kind="secondary"
                size="sm"
                onPress={() => {
                  if (pickFor) updateDay(pickFor, (x) => ({ ...x, exercises: [...x.exercises, { exerciseId: e.id, sets: 3, repMin: 8, repMax: 12, restSec: 90 }] }));
                  setPickFor(null);
                  setQ('');
                }}
              />
            </Row>
          ))}
        </Stack>
      </Sheet>
    </Screen>
  );
}
