import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState as RNAppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';

import { emptyState, STATE_VERSION, type AppState } from '@/lib/state';
import { checkAction, reducer, type Action } from '@/lib/reducer';
import { newId } from '@/lib/id';
import { nowISO, toISODate } from '@/lib/dates';
import { runEngine } from '@/lib/coaching/adaptive';
import { decide, type Candidate } from '@/lib/notifications/policy';
import { showSystemNotification } from '@/lib/notifications/deliver';
import { isSupabaseConfigured, supabase } from '@/lib/sync/supabase';
import { EMPTY_CURSOR, syncNow, type SyncCursor } from '@/lib/sync/sync';
import type { Proposal } from '@/lib/types';

const STORAGE_KEY = 'fitapp:state:v1';
const CURSOR_KEY = 'fitapp:sync-cursor:v1';

export type SyncStatus = 'local_only' | 'signed_out' | 'idle' | 'syncing' | 'error' | 'offline';

interface StoreValue {
  state: AppState;
  hydrated: boolean;
  today: string;
  /** Dispatch with business-rule checking; throws RuleViolation with a user-facing message. */
  act: (action: Action) => void;
  sync: {
    configured: boolean;
    session: Session | null;
    status: SyncStatus;
    lastSyncAt?: string;
    error?: string;
    syncNow: () => Promise<void>;
  };
  storageError?: string;
}

const Ctx = createContext<StoreValue | null>(null);

async function loadState(): Promise<AppState | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as AppState;
  if (parsed.version !== STATE_VERSION) return { ...emptyState(parsed.deviceId ?? newId(), nowISO()), ...parsed, version: STATE_VERSION };
  return { ...emptyState(parsed.deviceId, nowISO()), ...parsed };
}

function proposalCandidate(p: Proposal): Candidate {
  return {
    category: p.kind === 'day_calorie_adjustment' || p.kind === 'target_change' ? 'nutrition' : p.kind === 'plan_weight_update' ? 'workouts' : 'checkins',
    title: 'Coach suggestion',
    body: p.title,
    dedupeKey: `notify-${p.dedupeKey}`,
    priority: p.kind === 'target_change' ? 3 : 2,
  };
}

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => emptyState(newId(), nowISO()));
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState<string>();
  const [today, setToday] = useState(toISODate());
  const stateRef = useRef(state);
  stateRef.current = state;

  // ---- hydrate + persist ----
  useEffect(() => {
    loadState()
      .then((s) => s && dispatch({ type: 'HYDRATE', state: s }))
      .catch(() => setStorageError('Saved data could not be read. Starting fresh on this device.'))
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => setStorageError('Could not save to this device. Storage may be full.'));
    }, 250);
    return () => clearTimeout(t);
  }, [state, hydrated]);

  // ---- clock: roll over at midnight ----
  useEffect(() => {
    const i = setInterval(() => setToday(toISODate()), 60_000);
    return () => clearInterval(i);
  }, []);

  const act = useCallback((action: Action) => {
    checkAction(stateRef.current, action); // throws for the caller to show
    dispatch(action);
  }, []);

  // ---- adaptive coaching engine + notifications ----
  const runCoach = useCallback(async () => {
    const s = stateRef.current;
    if (!s.profile) return;
    const now = new Date();
    const date = toISODate(now);
    dispatch({ type: 'EXPIRE_PROPOSALS', today: date, now: nowISO() });
    const out = runEngine(s, date, now.getHours());
    if (out.proposals.length) dispatch({ type: 'ADD_PROPOSALS', proposals: out.proposals });
    dispatch({ type: 'SET_INSIGHTS', insights: out.insights });

    // At most one notification per engine run; policy enforces the daily cap + quiet hours.
    const candidates: Candidate[] = [
      ...out.proposals.map(proposalCandidate),
      ...out.insights.map((i) => ({ category: 'checkins' as const, title: i.title, body: i.body, dedupeKey: `notify-${i.dedupeKey}`, priority: i.priority })),
    ].sort((a, b) => b.priority - a.priority);
    const minutes = now.getHours() * 60 + now.getMinutes();
    const latest = stateRef.current;
    for (const c of candidates) {
      if (!decide(c, latest.settings.notifications, latest.notifications, date, minutes).send) continue;
      const shown = await showSystemNotification(c.title, c.body);
      const stamp = nowISO();
      dispatch({
        type: 'RECORD_NOTIFICATION',
        record: { id: newId(), date, sentAt: stamp, category: c.category, title: c.title, body: c.body, dedupeKey: c.dedupeKey, deviceId: latest.deviceId, delivered: shown ? 'system' : 'in_app', updatedAt: stamp },
      });
      break;
    }
  }, []);

  const engineKey = `${state.foodLog.length}|${state.weights.length}|${state.activity.length}|${state.sessions.length}|${state.targets?.updatedAt}|${state.profile?.updatedAt}|${today}`;
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => void runCoach(), 800);
    return () => clearTimeout(t);
  }, [engineKey, hydrated, runCoach]);

  useEffect(() => {
    const i = setInterval(() => void runCoach(), 15 * 60_000);
    return () => clearInterval(i);
  }, [runCoach]);

  // ---- cloud sync (optional) ----
  const [session, setSession] = useState<Session | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(isSupabaseConfigured ? 'signed_out' : 'local_only');
  const [lastSyncAt, setLastSyncAt] = useState<string>();
  const [syncError, setSyncError] = useState<string>();
  const syncing = useRef(false);

  useEffect(() => {
    const sb = supabase();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const doSync = useCallback(async () => {
    if (!session || syncing.current) return;
    syncing.current = true;
    setSyncStatus('syncing');
    try {
      const cursorKey = `${CURSOR_KEY}:${session.user.id}`;
      const raw = await AsyncStorage.getItem(cursorKey);
      const cursor: SyncCursor = raw ? JSON.parse(raw) : EMPTY_CURSOR;
      const result = await syncNow(stateRef.current, session.user.id, cursor);
      // Merged into the current state, so edits made during the network call are kept.
      dispatch({ type: 'MERGE_REMOTE', rows: result.rows });
      await AsyncStorage.setItem(cursorKey, JSON.stringify(result.cursor));
      setLastSyncAt(nowISO());
      setSyncError(undefined);
      setSyncStatus('idle');
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
      setSyncStatus('error');
    } finally {
      syncing.current = false;
    }
  }, [session]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!session) {
      setSyncStatus('signed_out');
      return;
    }
    void doSync();
    const i = setInterval(() => void doSync(), 120_000);
    const sub = RNAppState.addEventListener('change', (s) => s === 'active' && void doSync());
    return () => {
      clearInterval(i);
      sub.remove();
    };
  }, [session, doSync]);

  // push soon after local edits
  useEffect(() => {
    if (!session || !hydrated) return;
    const t = setTimeout(() => void doSync(), 5000);
    return () => clearTimeout(t);
  }, [state.foodLog, state.weights, state.sessions, state.proposals, state.plan, state.targets, state.profile, session, hydrated, doSync]);

  const value = useMemo<StoreValue>(
    () => ({
      state,
      hydrated,
      today,
      act,
      storageError,
      sync: { configured: isSupabaseConfigured, session, status: syncStatus, lastSyncAt, error: syncError, syncNow: doSync },
    }),
    [state, hydrated, today, act, storageError, session, syncStatus, lastSyncAt, syncError, doSync],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used inside AppStoreProvider');
  return v;
}

/** Wipe all local data on this device. */
export async function clearLocalData() {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith('fitapp:')));
}
