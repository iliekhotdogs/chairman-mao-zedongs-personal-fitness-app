import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { Space } from '@/constants/theme';
import { Button, Card, Columns, EmptyState, Muted, PageHeader, Row, Screen, Segmented, Stack, Text } from '@/components/ui';
import { FoodItemEditor, FoodSearch } from '@/components/FoodItemEditor';
import { useStore } from '@/store/AppStore';
import { useAct } from '@/components/Toast';
import { defaultMealForTime, manualEntry } from '@/lib/nutrition/estimate';
import { sumItems } from '@/lib/nutrition/lookup';
import { nowISO, formatDateLabel } from '@/lib/dates';
import type { FoodItem, MealType } from '@/lib/types';
import { live } from '@/lib/selectors';

const MEALS: { value: MealType; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' }, { value: 'lunch', label: 'Lunch' }, { value: 'dinner', label: 'Dinner' }, { value: 'snack', label: 'Snack' },
];

export default function ManualEntry() {
  const { state, today } = useStore();
  const doAct = useAct();
  const { id, date: dateParam } = useLocalSearchParams<{ id?: string; date?: string }>();
  const existing = id ? live(state.foodLog).find((e) => e.id === id) : undefined;
  const date = existing?.date ?? dateParam ?? today;
  const [items, setItems] = useState<FoodItem[]>(existing?.items ?? []);
  const [meal, setMeal] = useState<MealType>(existing?.meal ?? defaultMealForTime());
  const total = sumItems(items);

  if (id && !existing) {
    return (
      <Screen maxWidth={720}>
        <EmptyState icon="search-outline" title="Entry not found" body="It may have been deleted on another device." action={<Button title="Back to food log" onPress={() => router.replace('/food')} />} />
      </Screen>
    );
  }

  const save = () => {
    if (existing) {
      const ok = doAct({ type: 'UPDATE_FOOD', entry: { ...existing, items, meal, confirmedAt: nowISO(), updatedAt: nowISO() } }, 'Meal updated');
      if (ok) router.back();
      return;
    }
    try {
      const entry = manualEntry({ items, meal, date });
      if (doAct({ type: 'LOG_FOOD', entry }, `Logged ${Math.round(total.calories)} kcal`)) router.replace('/food');
    } catch {
      /* button is disabled when there are no items */
    }
  };

  return (
    <Screen maxWidth={980}>
      <PageHeader title={existing ? 'Edit meal' : 'Add food'} subtitle={formatDateLabel(date, today)} right={<Button title="Cancel" kind="ghost" onPress={() => router.back()} />} />
      <Columns ratio={[1, 1]}>
        {[
          <Stack key="search" gap={Space.md}>
            <Text variant="h3">Find a food</Text>
            <FoodSearch onPick={(item) => setItems([...items, item])} />
          </Stack>,
          <Stack key="items" gap={Space.md}>
            <Text variant="h3">This meal</Text>
            <Segmented label="Meal" value={meal} onChange={setMeal} options={MEALS} />
            {items.length === 0 ? (
              <Card tone="muted">
                <Muted>Search for a food or add a custom item. It will appear here.</Muted>
              </Card>
            ) : (
              items.map((it, i) => (
                <FoodItemEditor key={`${it.name}-${i}`} item={it} onChange={(next) => setItems(items.map((x, j) => (j === i ? next : x)))} onRemove={() => setItems(items.filter((_, j) => j !== i))} />
              ))
            )}
            <Card>
              <Row>
                <Text variant="bodyStrong" style={{ flex: 1 }}>Total</Text>
                <Text variant="bodyStrong">{Math.round(total.calories)} kcal</Text>
              </Row>
              <Muted variant="small">P {Math.round(total.proteinG)} g · C {Math.round(total.carbsG)} g · F {Math.round(total.fatG)} g</Muted>
            </Card>
            <Button title={existing ? 'Save changes' : 'Log meal'} icon="checkmark" size="lg" onPress={save} disabled={!items.length} full />
          </Stack>,
        ]}
      </Columns>
    </Screen>
  );
}
