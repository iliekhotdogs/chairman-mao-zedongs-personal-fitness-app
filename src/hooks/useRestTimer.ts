import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { adjustRest, isRestDone, remainingSec, restProgress, startRest, totalSec, type RestTimer } from '@/lib/workouts/restTimer';
import { log } from '@/lib/log';

async function buzz() {
  if (Platform.OS === 'web') return;
  try {
    const Haptics = await import('expo-haptics');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    log.warn('rest-timer', 'Haptic feedback unavailable.', e);
  }
}

/**
 * Drives a rest countdown between sets. All timing math lives in lib/workouts/restTimer;
 * this hook only ticks the clock and fires haptics once when the rest ends.
 */
export function useRestTimer() {
  const [timer, setTimer] = useState<RestTimer | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const notified = useRef<RestTimer | null>(null);

  const running = timer !== null && !isRestDone(timer, now);

  // Tick only while counting down; a finished timer stays on screen without re-rendering.
  useEffect(() => {
    if (!timer || !running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [timer, running]);

  useEffect(() => {
    if (timer && isRestDone(timer, now) && notified.current !== timer) {
      notified.current = timer;
      buzz();
    }
  }, [timer, now]);

  const start = useCallback((sec: number, exerciseId?: string) => {
    const t = Date.now();
    setNow(t);
    setTimer(startRest(sec, t, exerciseId));
  }, []);

  const adjust = useCallback((deltaSec: number) => {
    const t = Date.now();
    setNow(t);
    setTimer((cur) => (cur ? adjustRest(cur, deltaSec, t) : cur));
  }, []);

  const skip = useCallback(() => setTimer(null), []);

  return {
    timer,
    running,
    done: timer !== null && !running,
    remaining: timer ? remainingSec(timer, now) : 0,
    total: timer ? totalSec(timer) : 0,
    progress: timer ? restProgress(timer, now) : 0,
    start,
    adjust,
    skip,
  };
}

export type RestTimerControls = ReturnType<typeof useRestTimer>;
