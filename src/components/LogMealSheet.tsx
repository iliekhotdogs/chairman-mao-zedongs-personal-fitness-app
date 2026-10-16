import React from 'react';
import { Linking } from 'react-native';
import { router } from 'expo-router';

import { Space } from '@/constants/theme';
import type { RestaurantMatch } from '@/lib/ai/provider';
import { Badge, Button, Card, Muted, Row, Sheet, Text } from './ui';

/** One "Log meal" entry point: Photo / Describe / Manual / Scan. */
export function LogMealSheet({ visible, onClose, date }: { visible: boolean; onClose: () => void; date?: string }) {
  const go = (pathname: '/food/capture' | '/food/manual' | '/food/barcode', mode?: 'photo' | 'describe') => {
    onClose();
    router.push({ pathname, params: { ...(date ? { date } : {}), ...(mode ? { mode } : {}) } });
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Log a meal">
      <Button title="Photo" icon="camera" full onPress={() => go('/food/capture', 'photo')} />
      <Button title="Describe" kind="secondary" icon="chatbox-ellipses-outline" full onPress={() => go('/food/capture', 'describe')} />
      <Button title="Scan barcode" kind="secondary" icon="barcode-outline" full onPress={() => go('/food/barcode')} />
      <Button title="Manual" kind="secondary" icon="create-outline" full onPress={() => go('/food/manual')} />
    </Sheet>
  );
}

/** Official restaurant values next to the photo/describe estimate. Picking one replaces the
 * items being reviewed (still editable); nothing is logged until the existing Accept. */
export function RestaurantCandidates({ match, selected, onSelect }: { match: RestaurantMatch; selected: number | null; onSelect: (index: number | null) => void }) {
  return (
    <Card tone="info" style={{ gap: Space.sm }}>
      <Text variant="h3">{match.supported ? `Official ${match.name} nutrition` : match.name}</Text>
      {match.note ? <Muted variant="small">{match.note}</Muted> : null}
      {match.candidates.length ? <Muted variant="small">Pick the dish you had, or keep the photo estimate. You can still edit it before accepting.</Muted> : null}
      {match.candidates.map((c, i) => (
        <Card key={`${c.item.name}-${i}`} tone={selected === i ? 'saved' : 'default'} style={{ gap: 4 }}>
          <Row wrap gap={6}>
            <Text variant="bodyStrong">{c.item.name}</Text>
            <Badge kind="sourced" label="Official values" />
            {c.stale ? <Badge kind="pending" label="May be out of date" /> : null}
          </Row>
          <Muted variant="small">{`${c.item.portionLabel} · ${c.item.calories} kcal · P ${Math.round(c.item.proteinG)} g · C ${Math.round(c.item.carbsG)} g · F ${Math.round(c.item.fatG)} g`}</Muted>
          <Muted variant="small">
            {`Source checked ${c.checkedAt}. `}
            {c.item.source.url ? <Text variant="small" accessibilityRole="link" style={{ textDecorationLine: 'underline' }} onPress={() => Linking.openURL(c.item.source.url!)}>View source</Text> : null}
          </Muted>
          {c.disagreement ? <Muted variant="small">{c.disagreement}</Muted> : null}
          <Button title={selected === i ? 'Selected' : 'Use this'} kind={selected === i ? 'accept' : 'secondary'} size="sm" icon={selected === i ? 'checkmark' : undefined} disabled={selected === i} onPress={() => onSelect(i)} />
        </Card>
      ))}
      {match.candidates.length ? <Button title="Keep photo estimate" kind={selected === null ? 'accept' : 'ghost'} size="sm" disabled={selected === null} onPress={() => onSelect(null)} /> : null}
    </Card>
  );
}
