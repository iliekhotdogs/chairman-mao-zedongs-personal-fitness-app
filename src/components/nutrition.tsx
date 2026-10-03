import React, { useEffect, useState } from 'react';
import { Image, Linking, Pressable, View } from 'react-native';
import type { FoodItem, MacroTargets, NutritionSource } from '@/lib/types';
import { C, Radius, Space } from '@/constants/theme';
import { Badge, Muted, ProgressBar, Row, Stack, Text, Ionicons } from './ui';
import { Ring } from './charts';
import { signedPhotoUrl } from '@/lib/sync/sync';

export function sourceBadge(s: NutritionSource) {
  if (s.kind === 'official_restaurant') return <Badge kind="sourced" label="Official restaurant data" />;
  if (s.kind === 'visual_estimate') return <Badge kind="estimate" label="Visual estimate" />;
  if (s.kind === 'user_entered') return <Badge kind="neutral" label="Entered by you" icon="create-outline" />;
  if (s.kind === 'label') return <Badge kind="sourced" label="Product label data" />;
  return <Badge kind="sourced" label="Nutrition database" />;
}

export function SourceLine({ source }: { source: NutritionSource }) {
  return (
    <Stack gap={2}>
      <Row wrap gap={6}>{sourceBadge(source)}</Row>
      <Muted variant="small">{source.label}</Muted>
      {source.url ? (
        <Pressable onPress={() => Linking.openURL(source.url!)} accessibilityRole="link">
          <Text variant="small" color={C.info} style={{ textDecorationLine: 'underline' }}>
            View source
          </Text>
        </Pressable>
      ) : null}
    </Stack>
  );
}

export function MacroLine({ item }: { item: Pick<FoodItem, 'calories' | 'proteinG' | 'carbsG' | 'fatG'> }) {
  return (
    <Muted variant="small">
      {Math.round(item.calories)} kcal · P {Math.round(item.proteinG)} g · C {Math.round(item.carbsG)} g · F {Math.round(item.fatG)} g
    </Muted>
  );
}

export function CaloriesRing({ eaten, target, size = 156 }: { eaten: number; target: number; size?: number }) {
  const remaining = Math.round(target - eaten);
  return (
    <Ring value={eaten} max={target} size={size} stroke={size > 140 ? 13 : 10}>
      <Text variant={size > 140 ? 'number' : 'h2'}>{Math.abs(remaining).toLocaleString()}</Text>
      <Muted variant="small">{remaining >= 0 ? 'kcal left' : 'kcal over'}</Muted>
    </Ring>
  );
}

export function MacroBars({ eaten, target }: { eaten: MacroTargets; target: MacroTargets }) {
  const rows = [
    { k: 'Protein', e: eaten.proteinG, t: target.proteinG, color: C.protein },
    { k: 'Carbs', e: eaten.carbsG, t: target.carbsG, color: C.carbs },
    { k: 'Fat', e: eaten.fatG, t: target.fatG, color: C.fat },
  ];
  return (
    <Stack gap={Space.md} style={{ flex: 1, minWidth: 160 }}>
      {rows.map((r) => {
        const left = Math.round(r.t - r.e);
        return (
          <Stack key={r.k} gap={5}>
            <Row>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: r.color }} />
              <Text variant="smallStrong" style={{ flex: 1 }}>{r.k}</Text>
              <Muted variant="small">
                {left >= 0 ? `${left} g left` : `${-left} g over`} · {Math.round(r.e)}/{r.t} g
              </Muted>
            </Row>
            <ProgressBar value={r.e} max={r.t} color={r.color} over={r.e > r.t * 1.1} />
          </Stack>
        );
      })}
    </Stack>
  );
}

/** Shows a food photo; resolves private cloud photos to a short-lived signed URL. */
export function PhotoThumb({ uri, size = 56 }: { uri?: string; size?: number }) {
  const [src, setSrc] = useState<string | undefined>(uri && !uri.startsWith('storage:') ? uri : undefined);
  useEffect(() => {
    let alive = true;
    if (uri?.startsWith('storage:')) signedPhotoUrl(uri).then((u) => alive && setSrc(u));
    else setSrc(uri);
    return () => {
      alive = false;
    };
  }, [uri]);
  if (!src) {
    return (
      <View style={{ width: size, height: size, borderRadius: Radius.md, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="restaurant-outline" size={size * 0.4} color={C.textMuted} />
      </View>
    );
  }
  return <Image source={{ uri: src }} style={{ width: size, height: size, borderRadius: Radius.md, backgroundColor: C.surfaceAlt }} accessibilityLabel="Food photo" />;
}
