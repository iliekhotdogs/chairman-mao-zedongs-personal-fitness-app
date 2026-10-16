import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { FoodItem, MacroKey } from '@/lib/types';
import { C, Space } from '@/constants/theme';
import { Badge, Button, Card, Expandable, Field, IconButton, Muted, NumberField, Row, Sheet, Stack, Text, Ionicons } from './ui';
import { MacroLine, SourceLine } from './nutrition';
import { itemFromFdc, itemFromRef, scaleItem, searchFdcForAccount, searchFoods, type FdcResult } from '@/lib/nutrition/lookup';
import { markEdited } from '@/lib/nutrition/estimate';
import type { RefFood } from '@/lib/nutrition/foodDb';
import { FOOD_LIMITS, macroValue, setMacro } from '@/lib/nutrition/savedFoods';

/** Tracks which NumberFields currently show an error, so Save/Add can stay disabled. */
export function useFieldErrors() {
  const [errs, setErrs] = useState<Record<string, boolean>>({});
  const track = (key: string) => (_v: number | undefined, err?: string) => setErrs((e) => (e[key] === !!err ? e : { ...e, [key]: !!err }));
  return { hasError: Object.values(errs).some(Boolean), track, reset: () => setErrs({}) };
}

const MACRO_FIELDS: { key: MacroKey; label: string }[] = [
  { key: 'proteinG', label: 'Protein' }, { key: 'carbsG', label: 'Carbs' }, { key: 'fatG', label: 'Fat' },
];

/** Calories + protein/carbs/fat inputs. Empty macros are kept as unknown ("—"), not 0. */
export function NutrientFields({ item, onChange, track }: { item: FoodItem; onChange: (next: FoodItem) => void; track: (key: string) => (v: number | undefined, err?: string) => void }) {
  const macro = (key: MacroKey, label: string) => (
    <NumberField
      key={key}
      label={label}
      suffix="g"
      value={macroValue(item, key)}
      min={0}
      max={FOOD_LIMITS.macroG}
      placeholder="—"
      onChange={(v, err) => {
        track(key)(v, err);
        if (!err) onChange(setMacro(item, key, v));
      }}
      style={{ flex: 1 }}
    />
  );
  return (
    <>
      <Row gap={Space.sm} align="flex-start">
        <NumberField
          label="Calories"
          suffix="kcal"
          value={item.calories || undefined}
          min={0}
          max={FOOD_LIMITS.kcal}
          exclusiveMin
          onChange={(v, err) => {
            track('calories')(v, err);
            if (!err) onChange({ ...item, calories: Math.round(v ?? 0) });
          }}
          style={{ flex: 1 }}
        />
        {macro(MACRO_FIELDS[0].key, MACRO_FIELDS[0].label)}
      </Row>
      <Row gap={Space.sm} align="flex-start">
        {MACRO_FIELDS.slice(1).map((m) => macro(m.key, m.label))}
      </Row>
    </>
  );
}

/** Editable row for one food item. Portion edits rescale; macro edits mark the item "edited by you". */
export function FoodItemEditor({ item, onChange, onRemove, extra }: { item: FoodItem; onChange: (next: FoodItem) => void; onRemove: () => void; extra?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item);
  const [amountError, setAmountError] = useState<string>();
  const errors = useFieldErrors();
  const open = () => {
    setDraft(item);
    setAmountError(undefined);
    errors.reset();
    setEditing(true);
  };
  return (
    <Card style={{ gap: Space.sm, padding: Space.md }}>
      <Row align="flex-start">
        <Stack gap={2} style={{ flex: 1 }}>
          <Text variant="bodyStrong">{item.name}</Text>
          <Muted variant="small">
            {item.portionLabel}
            {item.grams ? ` · ${Math.round(item.grams)} g` : ''}
          </Muted>
        </Stack>
        <Text variant="bodyStrong">{Math.round(item.calories)} kcal</Text>
      </Row>
      <MacroLine item={item} />
      {extra}
      <Row wrap gap={Space.sm}>
        <Button title="Edit" kind="secondary" size="sm" icon="create-outline" onPress={open} />
        <Button title="Remove" kind="danger" size="sm" icon="trash-outline" onPress={onRemove} />
      </Row>
      <Sheet
        visible={editing}
        onClose={() => setEditing(false)}
        title="Edit item"
        footer={
          <Button
            title="Save changes"
            icon="checkmark"
            full
            disabled={!draft.name.trim() || !(draft.calories > 0) || draft.calories > FOOD_LIMITS.kcal || errors.hasError || !!amountError}
            onPress={() => {
              onChange(markEdited(item, draft));
              setEditing(false);
            }}
          />
        }>
        <Field label="Name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
        <Field label="Portion description" value={draft.portionLabel} onChangeText={(portionLabel) => setDraft({ ...draft, portionLabel })} />
        {item.grams ? (
          <NumberField
            label="Amount"
            suffix="g"
            value={draft.grams}
            min={0}
            max={FOOD_LIMITS.amount}
            exclusiveMin
            error={amountError}
            onChange={(g, err) => {
              errors.track('amount')(g, err);
              if (!g) return;
              const next = scaleItem({ ...item, name: draft.name, portionLabel: draft.portionLabel }, g);
              // Never clamp silently: a scaled portion over the calorie limit is almost always a typo.
              setAmountError(next.calories > FOOD_LIMITS.kcal ? `That is ${next.calories.toLocaleString()} kcal. Check the amount (max ${FOOD_LIMITS.kcal} kcal per item).` : undefined);
              setDraft(next.calories > FOOD_LIMITS.kcal ? { ...next, calories: FOOD_LIMITS.kcal } : next);
            }}
            hint="Changing the amount rescales calories and macros from the same nutrition source."
          />
        ) : null}
        <NutrientFields item={draft} onChange={setDraft} track={errors.track} />
        <Muted variant="small">Editing calories or macros directly marks this item as &quot;entered by you&quot;.</Muted>
      </Sheet>
    </Card>
  );
}

const BLANK_CUSTOM: FoodItem = { name: '', portionLabel: '1 serving', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, missing: ['proteinG', 'carbsG', 'fatG'], source: { kind: 'user_entered', sourced: false, label: 'Entered by you' } };

/** Search the built-in reference foods and (optionally) USDA FoodData Central. */
export function FoodSearch({ onPick }: { onPick: (item: FoodItem) => void }) {
  const [q, setQ] = useState('');
  const local = useMemo(() => searchFoods(q), [q]);
  const [remote, setRemote] = useState<FdcResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [custom, setCustom] = useState<FoodItem>(BLANK_CUSTOM);
  // bumped after each add so the custom form's number fields remount empty (no stale "-4")
  const [customKey, setCustomKey] = useState(0);
  const customErrors = useFieldErrors();

  const searchUsda = async () => {
    if (q.trim().length < 2 || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      setRemote(await searchFdcForAccount(q));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed');
      setRemote(null);
    } finally {
      setLoading(false);
    }
  };

  const pickRef = (f: RefFood) => {
    const p = f.portions[0];
    onPick(itemFromRef(f, p.grams, p.label));
  };

  return (
    <Stack gap={Space.sm}>
      <Field placeholder="Search foods, e.g. chicken, rice, latte" value={q} onChangeText={(t) => { setQ(t); setRemote(null); }} accessibilityLabel="Search foods" returnKeyType="search" onSubmitEditing={() => void searchUsda()} />
      {q.trim().length > 1 ? (
        <Stack gap={4}>
          {local.map((f) => (
            <Pressable key={f.id} onPress={() => pickRef(f)} accessibilityRole="button" style={({ pressed }) => [{ padding: Space.sm, borderRadius: 10, backgroundColor: pressed ? C.surfaceAlt : 'transparent' }]}>
              <Row>
                <Stack gap={0} style={{ flex: 1 }}>
                  <Text variant="smallStrong">{f.name}</Text>
                  <Muted variant="small">{f.portions[0].label} · {Math.round((f.kcal * f.portions[0].grams) / 100)} kcal · built-in reference</Muted>
                </Stack>
                <Ionicons name="add-circle" size={22} color={C.primary} />
              </Row>
            </Pressable>
          ))}
          {!local.length ? <Muted variant="small">No matches in the built-in list. Try Search USDA database below (or press Enter).</Muted> : null}
          <Row wrap gap={Space.sm}>
            <Button title="Search USDA database" kind="secondary" size="sm" icon="globe-outline" loading={loading} onPress={searchUsda} />
            <Badge kind="info" label="Live lookup" />
          </Row>
          {error ? <Text variant="small" color={C.danger}>{error}</Text> : null}
          {remote?.length === 0 ? <Muted variant="small">USDA returned no results.</Muted> : null}
          {remote?.map((r) => (
            <Pressable key={r.fdcId} onPress={() => onPick(itemFromFdc(r, 100, '100 g'))} accessibilityRole="button" style={({ pressed }) => [{ padding: Space.sm, borderRadius: 10, backgroundColor: pressed ? C.surfaceAlt : 'transparent' }]}>
              <Row>
                <Stack gap={0} style={{ flex: 1 }}>
                  <Text variant="smallStrong">{r.description}{r.brandOwner ? ` (${r.brandOwner})` : ''}</Text>
                  <Muted variant="small">per 100 g · {Math.round(r.per100g.kcal)} kcal · USDA {r.dataType}</Muted>
                </Stack>
                <Ionicons name="add-circle" size={22} color={C.primary} />
              </Row>
            </Pressable>
          ))}
        </Stack>
      ) : null}
      <Expandable title="Add a custom item" icon="create-outline">
        <View key={customKey} style={{ gap: Space.sm }}>
          <Field label="Name" value={custom.name} onChangeText={(name) => setCustom({ ...custom, name })} placeholder="e.g. Mom's lasagna" />
          <Field label="Portion" value={custom.portionLabel} onChangeText={(portionLabel) => setCustom({ ...custom, portionLabel })} />
          <NutrientFields item={custom} onChange={setCustom} track={customErrors.track} />
          <Muted variant="small">Leave a macro empty if you don&apos;t know it; it shows as &quot;—&quot;.</Muted>
          <Button
            title="Add custom item"
            kind="secondary"
            icon="add"
            disabled={!custom.name.trim() || !(custom.calories > 0) || custom.calories > FOOD_LIMITS.kcal || customErrors.hasError}
            onPress={() => {
              onPick({ ...custom, name: custom.name.trim() });
              setCustom({ ...BLANK_CUSTOM, portionLabel: custom.portionLabel });
              customErrors.reset();
              setCustomKey((k) => k + 1);
            }}
          />
        </View>
      </Expandable>
    </Stack>
  );
}

export function ItemSourceDetails({ item }: { item: FoodItem & { portionAssumption?: string; confidence?: string } }) {
  return (
    <Stack gap={4}>
      <SourceLine source={item.source} />
      {item.portionAssumption ? <Muted variant="small">Portion: {item.portionAssumption}</Muted> : null}
    </Stack>
  );
}

export function RemoveButton({ onPress, label }: { onPress: () => void; label: string }) {
  return <IconButton icon="trash-outline" label={label} onPress={onPress} color={C.danger} size={18} />;
}
