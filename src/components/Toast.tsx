import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, Radius, Space } from '@/constants/theme';
import { Ionicons, Text } from './ui';
import { RuleViolation } from '@/lib/reducer';
import { useStore } from '@/store/AppStore';
import type { Action } from '@/lib/reducer';

type Kind = 'success' | 'error' | 'info';
const Ctx = createContext<(msg: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: Kind } | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const insets = useSafeAreaInsets();

  const show = useCallback(
    (msg: string, kind: Kind = 'success') => {
      setToast({ msg, kind });
      clearTimeout(timer.current);
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setToast(null));
      }, 2800);
    },
    [opacity],
  );

  const color = toast?.kind === 'error' ? C.danger : toast?.kind === 'info' ? C.info : C.success;
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast ? (
        <View pointerEvents="none" style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) + 76 }]}>
          <Animated.View style={[styles.toast, { opacity }]} accessibilityLiveRegion="polite" accessibilityRole={toast.kind === 'error' ? 'alert' : undefined}>
            <Ionicons name={toast.kind === 'error' ? 'alert-circle' : toast.kind === 'info' ? 'information-circle' : 'checkmark-circle'} size={18} color={color} />
            <Text variant="smallStrong" color="#fff" style={{ flexShrink: 1 }}>
              {toast.msg}
            </Text>
          </Animated.View>
        </View>
      ) : null}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

/** Dispatch an action; show rule violations as an error toast. Returns true on success. */
export function useAct() {
  const { act } = useStore();
  const toast = useToast();
  return useCallback(
    (action: Action, success?: string) => {
      try {
        act(action);
        if (success) toast(success);
        return true;
      } catch (e) {
        toast(e instanceof RuleViolation ? e.message : 'Something went wrong. Please try again.', 'error');
        return false;
      }
    },
    [act, toast],
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: Space.lg },
  toast: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, backgroundColor: '#1D2939', paddingHorizontal: Space.lg, paddingVertical: Space.md, borderRadius: Radius.md, maxWidth: 520 },
});
