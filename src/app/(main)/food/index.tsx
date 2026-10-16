import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { C, Space } from '@/constants/theme';
import { Badge, Button, Card, EmptyState, Expandable, Field, IconButton, Menu, Muted, PageHeader, Row, Screen, Sheet, Stack, Text, Columns } from '@/components/ui';
import { CaloriesRing, MacroBars, PhotoThumb, sourceBadge } from '@/components/nutrition';
import { LogMealSheet } from '@/components/LogMealSheet';
import { useStore } from '@/store/AppStore';
import { useAct, useToast } from '@/components/Toast';
import { addDays, formatDateLabel, formatTime, nowISO } from '@/lib/dates';
import { foodForDay, remainingForDay } from '@/lib/selectors';
import { sumItems } from '@/lib/nutrition/lookup';
import { discardLocalPhoto } from '@/lib/photo';
import { defaultMealForTime, manualEntry } from '@/lib/nutrition/estimate';
import { dishFromEntry, draftProblems, itemFromSaved, logAgain, recentMeals, restaurantsVisited, savedFoodFromDraft } from '@/lib/nutrition/savedFoods';
import type { FoodEntry, MealType, SavedFood } from '@/lib/types';

const ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const fullName = (e: FoodEntry) => e.items.map((i) => i.name).join(', ');
const shortName = (e: FoodEntry) => (e.items.length > 1 ? `${e.items[0].name} +${e.items.length - 1} item${e.items.length > 2 ? 's' : ''}` : fullName(e));
const LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };

export default function FoodLog() {
  const { state, today } = useStore();
  const doAct = useAct();
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [toSave, setToSave] = useState<FoodEntry | null>(null);
  const [toDelete, setToDelete] = useState<FoodEntry | null>(null);
  const [mealOpen, setMealOpen] = useState(false);
  // last deleted meal, so Undo can restore it; its local photo is discarded only when a newer delete replaces it
  const [undo, setUndo] = useState<FoodEntry | null>(null);
  const relog = (e: FoodEntry, to: string) => doAct({ type: 'LOG_FOOD', entry: logAgain(e, to, nowISO()) }, `Logged again for ${formatDateLabel(to, today).toLowerCase()}`);
  const logDish = (f: SavedFood) => {
    const item = itemFromSaved(f);
    if (item) doAct({ type: 'LOG_FOOD', entry: manualEntry({ items: [item], meal: defaultMealForTime(), date }) }, `Logged ${item.name}`);
  };
  const entries = foodForDay(state, date);
  // filter before the cap: otherwise this day's meals use up the slots and hide older ones
  const recent = recentMeals(state.foodLog.filter((e) => e.date !== date));
  const restaurants = restaurantsVisited(state.savedFoods);
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
        right={<Button title="Add meal" icon="add" onPress={() => setMealOpen(true)} />}
      />
      <Row>
        <IconButton icon="chevron-back" label="Previous day" onPress={() => setDate(addDays(date, -1))} />
        <Text variant="h3" style={{ flex: 1, textAlign: 'center' }}>{formatDateLabel(date, today)}</Text>
        <IconButton icon="chevron-forward" label="Next day" onPress={() => setDate(addDays(date, 1))} disabled={date >= today} color={date >= today ? C.borderStrong : C.text} />
      </Row>

      <Columns ratio={[2, 3]}>
        {[
          <Stack key="sum" gap={Space.lg}>
            {summary}
            {recent.length ? (
              <Card style={{ gap: Space.sm }}>
                <Text variant="h3">Recent meals</Text>
                {recent.map((e) => (
                  <Row key={e.id} gap={Space.sm}>
                    <Stack gap={0} style={{ flex: 1 }}>
                      <Text variant="smallStrong" numberOfLines={2}>{shortName(e)}</Text>
                      <Muted variant="small">{Math.round(sumItems(e.items).calories)} kcal · {formatDateLabel(e.date, today)}</Muted>
                    </Stack>
                    <Button title="Log again" kind="secondary" size="sm" icon="copy-outline" accessibilityLabel={`Log ${fullName(e)} again`} onPress={() => relog(e, date)} />
                  </Row>
                ))}
              </Card>
            ) : null}
            {restaurants.length ? (
              <Card style={{ gap: Space.sm }}>
                <Text variant="h3">Restaurants visited</Text>
                {restaurants.map((r) => (
                  <Stack key={r.restaurant} gap={4}>
                    <Text variant="smallStrong">{r.restaurant}</Text>
                    {r.dishes.map((f) => (
                      <Row key={f.id} gap={Space.sm}>
                        <Muted variant="small" style={{ flex: 1 }}>{f.name} · {f.nutrients.calories ?? '—'} kcal</Muted>
                        <Button title="Log" kind="secondary" size="sm" icon="add" accessibilityLabel={`Log ${f.name} from ${r.restaurant}`} onPress={() => logDish(f)} />
                      </Row>
                    ))}
                  </Stack>
                ))}
              </Card>
            ) : null}
          </Stack>,
          <Stack key="meals" gap={Space.lg}>
            {entries.length === 0 ? (
              <EmptyState
                icon="restaurant-outline"
                title={date === today ? 'Nothing logged yet today' : 'Nothing logged this day'}
                body="Add a meal with a photo, a short description or manual entry. You'll review any estimate before it's saved."
                action={<Button title="Add meal" icon="add" onPress={() => setMealOpen(true)} />}
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
                      <EntryCard key={e.id} entry={e} onRelog={e.date !== today ? () => relog(e, today) : undefined} onSave={() => setToSave(e)} onDelete={() => setToDelete(e)} onEdit={() => router.push({ pathname: '/food/manual', params: { id: e.id } })} />
                    ))}
                  </Stack>
                );
              })
            )}
          </Stack>,
        ]}
      </Columns>

      <LogMealSheet visible={mealOpen} onClose={() => setMealOpen(false)} date={date} />
      {toSave ? <SaveDishSheet key={toSave.id} entry={toSave} onClose={() => setToSave(null)} onSave={(food) => doAct({ type: 'SAVE_FOOD', food }, `Saved ${food.name} to ${food.restaurant}`) && setToSave(null)} /> : null}

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
                const gone = toDelete;
                if (gone && doAct({ type: 'DELETE_FOOD', id: gone.id, now: nowISO() })) {
                  if (undo) void discardLocalPhoto(undo.photoUri);
                  setUndo(gone);
                  // a toast instead of a banner, so the page doesn't jump
                  toast('Meal deleted', 'info', { label: 'Undo', onPress: () => { if (doAct({ type: 'LOG_FOOD', entry: { ...gone, deleted: false, updatedAt: nowISO() } }, 'Meal restored')) setUndo(null); } });
                }
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

/** Save a logged meal as a dish at a restaurant (personal food database). Saved only on confirm. */
function SaveDishSheet({ entry, onClose, onSave }: { entry: FoodEntry; onClose: () => void; onSave: (f: SavedFood) => void }) {
  const [restaurant, setRestaurant] = useState('');
  const [name, setName] = useState(entry.items.map((i) => i.name).join(', '));
  const draft = dishFromEntry(entry, restaurant, name);
  const blocked = !restaurant.trim() || draftProblems(draft).length > 0;
  return (
    <Sheet visible onClose={onClose} title="Save as restaurant dish" footer={<Button title="Save dish" icon="checkmark" full disabled={blocked} onPress={() => onSave(savedFoodFromDraft(draft, 'restaurant', nowISO()))} />}>
      <Field label="Restaurant" value={restaurant} onChangeText={setRestaurant} placeholder="e.g. Tim Hortons" />
      <Field label="Dish name" value={name} onChangeText={setName} />
      <Muted variant="small">
        {draft.nutrients.calories ?? '—'} kcal · P {draft.nutrients.proteinG ?? '—'} · C {draft.nutrients.carbsG ?? '—'} · F {draft.nutrients.fatG ?? '—'} per order, from this logged meal.
      </Muted>
    </Sheet>
  );
}

function EntryCard({ entry, onDelete, onEdit, onRelog, onSave }: { entry: FoodEntry; onDelete: () => void; onEdit: () => void; onRelog?: () => void; onSave: () => void }) {
  const tot = sumItems(entry.items);
  const kinds = [...new Set(entry.items.map((i) => i.source.kind))];
  return (
    <Card style={{ padding: Space.md }}>
      <Row align="flex-start" gap={Space.md}>
        {entry.origin === 'photo' ? <PhotoThumb uri={entry.photoUri} /> : null}
        <View style={{ flex: 1, gap: 4 }}>
          <Pressable style={{ gap: 4 }} onPress={() => router.push({ pathname: '/food/manual', params: { id: entry.id } })} accessibilityRole="button" accessibilityLabel={`Edit ${entry.items.map((i) => i.name).join(', ')}`}>
            <Text variant="bodyStrong" numberOfLines={2}>{entry.items.map((i) => i.name).join(', ')}</Text>
            <Muted variant="small">
              {Math.round(tot.calories)} kcal · P {Math.round(tot.proteinG)} · C {Math.round(tot.carbsG)} · F {Math.round(tot.fatG)}{entry.items.some((i) => i.missing?.length) ? ' (some unknown)' : ''} · {formatTime(entry.createdAt)}
            </Muted>
          </Pressable>
          {/* Outside the Pressable: on web a nested button is invalid HTML. */}
          <Expandable title="Details">
            <Row wrap gap={4}>
              {entry.origin === 'photo' ? <Badge kind="saved" label="Confirmed photo estimate" /> : null}
              {kinds.slice(0, 2).map((k) => (
                <React.Fragment key={k}>{sourceBadge(entry.items.find((i) => i.source.kind === k)!.source)}</React.Fragment>
              ))}
            </Row>
          </Expandable>
        </View>
        <Menu title="Meal options" label="Meal options" items={[{ label: 'Edit', icon: 'create-outline', onPress: onEdit }, ...(onRelog ? [{ label: 'Log again today', icon: 'copy-outline' as const, onPress: onRelog }] : []), { label: 'Save as restaurant dish', icon: 'bookmark-outline' as const, onPress: onSave }, { label: 'Delete', icon: 'trash-outline', danger: true, onPress: onDelete }]} />
      </Row>
    </Card>
  );
}
