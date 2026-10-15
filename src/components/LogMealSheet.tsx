import React from 'react';
import { router } from 'expo-router';

import { Button, Sheet } from './ui';

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
