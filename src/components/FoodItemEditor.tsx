import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { FoodItem } from '@/lib/types';
import { C, Space } from '@/constants/theme';
import { Badge, Button, Card, Expandable, Field, IconButton, Muted, NumberField, Row, Sheet, Stack, Text, Ionicons } from './ui';
import { MacroLine, SourceLine } from './nutrition';
import { itemFromFdc, itemFromRef, scaleItem, searchFdcForAccount, searchFoods, type FdcResult } from '@/lib/nutrition/lookup';
import { markEdited } from '@/lib/nutrition/estimate';
import type { RefFood } from '@/lib/nutrition/foodDb';

/** Editable row for one food item. Portion edits rescale; macro edits mark the item "edited by you". */
export function FoodItemEditor({ item, onChange, onRemove, extra }: { item: FoodItem; onChange: (next: FoodItem) => void; onRemove: () => void; extra?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item);
  const open = () => {
    setDraft(item);
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
            disabled={!draft.name.trim() || !Number.isFinite(draft.calories)}
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
            onChange={(g) => g && g > 0 && setDraft({ ...scaleItem({ ...item, name: draft.name, portionLabel: draft.portionLabel }, g) })}
            hint="Changing the amount rescales calories and macros from the same nutrition source."
          />
        ) : null}
        <Row gap={Space.sm}>
          <NumberField label="Calories" suffix="kcal" value={draft.calories} onChange={(v) => setDraft({ ...draft, calories: Math.round(v ?? 0) })} style={{ flex: 1 }} />
          <NumberField label="Protein" suffix="g" value={draft.proteinG} onChange={(v) => setDraft({ ...draft, proteinG: v ?? 0 })} style={{ flex: 1 }} />
        </Row>
        <Row gap={Space.sm}>
          <NumberField label="Carbs" suffix="g" value={draft.carbsG} onChange={(v) => setDraft({ ...draft, carbsG: v ?? 0 })} style={{ flex: 1 }} />
          <NumberField label="Fat" suffix="g" value={draft.fatG} onChange={(v) => setDraft({ ...draft, fatG: v ?? 0 })} style={{ flex: 1 }} />
        </Row>
        <Muted variant="small">Editing calories or macros directly marks this item as &quot;entered by you&quot;.</Muted>
      </Sheet>
    </Card>
  );
}

/** Search the built-in reference foods and (optionally) USDA FoodData Central. */
export function FoodSearch({ onPick }: { onPick: (item: FoodItem) => void }) {
  const [q, setQ] = useState('');
  const local = useMemo(() => searchFoods(q), [q]);
  const [remote, setRemote] = useState<FdcResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [custom, setCustom] = useState<FoodItem>({ name: '', portionLabel: '1 serving', calories: 0, proteinG: 0, carbsG: 0, fatG: 0, source: { kind: 'user_entered', sourced: false, label: 'Entered by you' } });

  const searchUsda = async () => {
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
      <Field placeholder="Search foods, e.g. chicken, rice, latte" value={q} onChangeText={(t) => { setQ(t); setRemote(null); }} accessibilityLabel="Search foods" returnKeyType="search" />
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
          {!local.length ? <Muted variant="small">No matches in the built-in list.</Muted> : null}
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
        <View style={{ gap: Space.sm }}>
          <Field label="Name" value={custom.name} onChangeText={(name) => setCustom({ ...custom, name })} placeholder="e.g. Mom's lasagna" />
          <Field label="Portion" value={custom.portionLabel} onChangeText={(portionLabel) => setCustom({ ...custom, portionLabel })} />
          <Row gap={Space.sm}>
            <NumberField label="Calories" suffix="kcal" value={custom.calories || undefined} onChange={(v) => setCustom({ ...custom, calories: Math.round(v ?? 0) })} style={{ flex: 1 }} />
            <NumberField label="Protein" suffix="g" value={custom.proteinG || undefined} onChange={(v) => setCustom({ ...custom, proteinG: v ?? 0 })} style={{ flex: 1 }} />
          </Row>
          <Row gap={Space.sm}>
            <NumberField label="Carbs" suffix="g" value={custom.carbsG || undefined} onChange={(v) => setCustom({ ...custom, carbsG: v ?? 0 })} style={{ flex: 1 }} />
            <NumberField label="Fat" suffix="g" value={custom.fatG || undefined} onChange={(v) => setCustom({ ...custom, fatG: v ?? 0 })} style={{ flex: 1 }} />
          </Row>
          <Button
            title="Add custom item"
            kind="secondary"
            icon="add"
            disabled={!custom.name.trim() || custom.calories <= 0}
            onPress={() => {
              onPick({ ...custom, name: custom.name.trim() });
              setCustom({ ...custom, name: '', calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
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
