import React, { useState } from 'react';
import { Button, Muted, NumberField, Sheet } from './ui';
import { useStore } from '@/store/AppStore';
import { useAct } from './Toast';
import { latestWeight } from '@/lib/selectors';
import { toKg, weightUnit, weightValue } from '@/lib/units';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/dates';

export function WeightSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { state, today } = useStore();
  const doAct = useAct();
  const units = state.settings.units;
  const last = latestWeight(state);
  const [v, setV] = useState<number | undefined>(last ? weightValue(last.weightKg, units) : undefined);
  const save = () => {
    if (!v) return;
    if (doAct({ type: 'LOG_WEIGHT', entry: { id: newId(), date: today, weightKg: toKg(v, units), updatedAt: nowISO() } }, 'Weight saved')) onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Log today's weight" footer={<Button title="Save weight" icon="checkmark" onPress={save} disabled={!v} full />}>
      <NumberField label="Body weight" value={v} onChange={setV} suffix={weightUnit(units)} autoFocus />
      <Muted variant="small">Tip: weigh in the morning after the bathroom, before eating. Daily numbers swing 1–2 {weightUnit(units)}; the coach uses the trend, not single days.</Muted>
    </Sheet>
  );
}
