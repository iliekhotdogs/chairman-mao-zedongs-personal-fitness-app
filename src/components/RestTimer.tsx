import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { C, Radius, Space } from '@/constants/theme';
import { Button, Card, ProgressBar, Row, Text } from './ui';
import { formatRest, REST_STEP_SEC } from '@/lib/workouts/restTimer';
import type { RestTimerControls } from '@/hooks/useRestTimer';

/** Big countdown between sets: ±15 s, skip, and a pulse (plus haptics on native) when rest is over. */
export function RestTimerCard({ rest, label }: { rest: RestTimerControls; label?: string }) {
  const reduce = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!rest.done || reduce) {
      pulse.set(1);
      return;
    }
    pulse.set(withRepeat(withSequence(withTiming(1.06, { duration: 260 }), withTiming(1, { duration: 260 })), 4, false));
  }, [rest.done, reduce, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }] }));

  if (!rest.timer) return null;
  const done = rest.done;

  return (
    <Card tone="accent" style={{ gap: Space.sm, borderColor: done ? C.accent : C.primaryBorder }} accessibilityLiveRegion="polite">
      <Row>
        <Text variant="eyebrow" color={C.accent} style={{ flex: 1 }}>
          {done ? 'Rest over' : 'Rest'}
          {label ? ` · ${label}` : ''}
        </Text>
        <Text variant="caption" color={C.textSecondary}>{formatRest(rest.total)} total</Text>
      </Row>
      <Row align="flex-end" gap={Space.md} wrap>
        <Animated.View style={pulseStyle}>
          <Text variant="hero" color={done ? C.accent : C.text} accessibilityRole="timer" accessibilityLabel={done ? 'Rest is over' : `${rest.remaining} seconds of rest left`}>
            {done ? 'GO' : formatRest(rest.remaining)}
          </Text>
        </Animated.View>
        <Text variant="small" color={C.textSecondary} style={{ flex: 1, minWidth: 120, marginBottom: Space.sm }}>
          {done ? 'Next set when you are ready.' : 'Breathe. Next set starts when the clock hits zero.'}
        </Text>
      </Row>
      <View style={{ borderRadius: Radius.pill, overflow: 'hidden' }}>
        <ProgressBar value={rest.progress * rest.total} max={rest.total} height={6} color={C.accent} label="Rest time elapsed" />
      </View>
      <Row gap={Space.sm}>
        <Button title={`−${REST_STEP_SEC}s`} kind="secondary" size="sm" onPress={() => rest.adjust(-REST_STEP_SEC)} disabled={done} accessibilityLabel={`Remove ${REST_STEP_SEC} seconds`} style={{ flex: 1 }} />
        <Button title={`+${REST_STEP_SEC}s`} kind="secondary" size="sm" onPress={() => rest.adjust(REST_STEP_SEC)} accessibilityLabel={`Add ${REST_STEP_SEC} seconds`} style={{ flex: 1 }} />
        <Button title={done ? 'Dismiss' : 'Skip'} kind={done ? 'primary' : 'ghost'} size="sm" icon={done ? 'checkmark' : 'play-skip-forward'} onPress={rest.skip} style={{ flex: 1 }} />
      </Row>
    </Card>
  );
}
