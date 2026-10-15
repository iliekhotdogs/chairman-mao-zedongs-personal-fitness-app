import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { C, Space } from '@/constants/theme';
import { Button, Ionicons, Muted, Row } from './ui';

const key = (kind: string) => `fitapp.privacy-notice.${kind}`;

/** One-line notice shown until dismissed once; dismissal persists on this device. `sentCount` > 0 means the first photo/message went out. */
export function PrivacyNotice({ kind, dismissSignal = 0 }: { kind: 'photo' | 'chat'; dismissSignal?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(key(kind)).then((v) => setShow(!v)).catch(() => setShow(true));
  }, [kind]);
  useEffect(() => {
    if (dismissSignal > 0) AsyncStorage.setItem(key(kind), '1').catch(() => {});
  }, [dismissSignal, kind]);
  const [closed, setClosed] = useState(false);
  if (!show || closed || dismissSignal > 0) return null;
  return (
    <Row gap={Space.sm}>
      <Ionicons name="lock-closed-outline" size={14} color={C.textSecondary} />
      <Muted variant="small" style={{ flex: 1 }}>Photos and messages are sent to our AI provider.</Muted>
      <Button
        title="Got it"
        kind="ghost"
        size="sm"
        onPress={() => {
          setClosed(true);
          AsyncStorage.setItem(key(kind), '1').catch(() => {});
        }}
      />
    </Row>
  );
}
