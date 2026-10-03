import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { router } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Badge, Button, Card, EmptyState, IconButton, Muted, PageHeader, Row, Screen, Sheet, Stack, Text, Columns } from '@/components/ui';
import { CaloriesRing, MacroBars, PhotoThumb, sourceBadge } from '@/components/nutrition';
import { useStore } from '@/store/AppStore';
import { useAct } from '@/components/Toast';
import { addDays, formatDateLabel, formatTime, nowISO } from '@/lib/dates';
import { foodForDay, remainingForDay } from '@/lib/selectors';
import { sumItems } from '@/lib/nutrition/lookup';
import type { FoodEntry, MealType } from '@/lib/types';

const ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };

export default function FoodLog() {
  const { state, today } = useStore();
  const doAct = useAct();
  const [date, setDate] = useState(today);
  const [toDelete, setToDelete] = useState<FoodEntry | null>(null);
  const entries = foodForDay(state, date);
  const rem = remainingForDay(state, date)!;

  const summary = (
    <Card style={{ gap: Space.lg }}>
      <Row wrap gap={Space.xl}>
        <CaloriesRing eaten={rem.eaten.calories} target={rem.target.calories} size={132} />
        <MacroBars eaten={rem.eaten} target={rem.target} />
      </Row>
      {rem.target.adjustment ? <Badge kind="saved" label={`Includes approved +${rem.target.adjustment.calorieDelta} kcal for this day`} /> : null}
    </Card>
  );

  return (
    <Screen>
      <PageHeader
        title="Food"
        subtitle="Everything here was confirmed by you."
        right={
          <Row gap={Space.sm}>
            <Button title="Snap" icon="camera" onPress={() => router.push({ pathname: '/food/capture', params: { date } })} />
            <Button title="Add" kind="secondary" icon="add" onPress={() => router.push({ pathname: '/food/manual', params: { date } })} />
          </Row>
        }
      />
      <Row>
        <IconButton icon="chevron-back" label="Previous day" onPress={() => setDate(addDays(date, -1))} />
        <Text variant="h3" style={{ flex: 1, textAlign: 'center' }}>{formatDateLabel(date, today)}</Text>
        <IconButton icon="chevron-forward" label="Next day" onPress={() => date < today && setDate(addDays(date, 1))} color={date >= today ? C.borderStrong : C.text} style={date >= today ? { opacity: 0.4 } : undefined} />
      </Row>

      <Columns ratio={[2, 3]}>
        {[
          <Stack key="sum" gap={Space.lg}>{summary}</Stack>,
          <Stack key="meals" gap={Space.lg}>
            {entries.length === 0 ? (
              <EmptyState
                icon="restaurant-outline"
                title={date === today ? 'Nothing logged yet today' : 'Nothing logged this day'}
                body="Snap a photo of your meal with a short hint. You'll review the estimate before it's saved."
                action={<Button title="Snap a meal" icon="camera" onPress={() => router.push({ pathname: '/food/capture', params: { date } })} />}
              />
            ) : (
              ORDER.map((m) => {
                const list = entries.filter((e) => e.meal === m);
                if (!list.length) return null;
                const tot = sumItems(list.flatMap((e) => e.items));
                return (
                  <Stack key={m} gap={Space.sm}>
                    <Row>
                      <Text variant="h3" style={{ flex: 1 }}>{LABEL[m]}</Text>
                      <Muted variant="smallStrong">{Math.round(tot.calories)} kcal</Muted>
                    </Row>
                    {list.map((e) => (
                      <EntryCard key={e.id} entry={e} onDelete={() => setToDelete(e)} />
                    ))}
                  </Stack>
                );
              })
            )}
          </Stack>,
        ]}
      </Columns>

      <Sheet
        visible={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete this meal?"
        footer={
          <Row gap={Space.sm}>
            <Button title="Cancel" kind="secondary" onPress={() => setToDelete(null)} style={{ flex: 1 }} />
            <Button
              title="Delete"
              kind="danger"
              icon="trash-outline"
              style={{ flex: 1 }}
              onPress={() => {
                if (toDelete) doAct({ type: 'DELETE_FOOD', id: toDelete.id, now: nowISO() }, 'Meal deleted');
                setToDelete(null);
              }}
            />
          </Row>
        }>
        <Muted>{toDelete?.items.map((i) => i.name).join(', ')}: {Math.round(sumItems(toDelete?.items ?? []).calories)} kcal. This also removes it from your other devices.</Muted>
      </Sheet>
    </Screen>
  );
}

function EntryCard({ entry, onDelete }: { entry: FoodEntry; onDelete: () => void }) {
  const tot = sumItems(entry.items);
  const kinds = [...new Set(entry.items.map((i) => i.source.kind))];
  return (
    <Card style={{ padding: Space.md }}>
      <Row align="flex-start" gap={Space.md}>
        {entry.origin === 'photo' ? <PhotoThumb uri={entry.photoUri} /> : null}
        <Pressable style={{ flex: 1, gap: 4 }} onPress={() => router.push({ pathname: '/food/manual', params: { id: entry.id } })} accessibilityRole="button" accessibilityLabel={`Edit ${entry.items.map((i) => i.name).join(', ')}`}>
          <Text variant="bodyStrong" numberOfLines={2}>{entry.items.map((i) => i.name).join(', ')}</Text>
          <Muted variant="small">
            {Math.round(tot.calories)} kcal · P {Math.round(tot.proteinG)} · C {Math.round(tot.carbsG)} · F {Math.round(tot.fatG)} · {formatTime(entry.createdAt)}
          </Muted>
          <Row wrap gap={4}>
            {entry.origin === 'photo' ? <Badge kind="saved" label="Confirmed photo estimate" /> : null}
            {kinds.slice(0, 2).map((k) => (
              <React.Fragment key={k}>{sourceBadge(entry.items.find((i) => i.source.kind === k)!.source)}</React.Fragment>
            ))}
          </Row>
        </Pressable>
        <IconButton icon="trash-outline" label="Delete meal" color={C.textSecondary} size={18} onPress={onDelete} />
      </Row>
    </Card>
  );
}
