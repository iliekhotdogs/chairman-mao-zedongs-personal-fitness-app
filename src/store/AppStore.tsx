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
import { mergeRemote } from '@/lib/sync/merge';
import type { Proposal } from '@/lib/types';
import { loadApiKey, loadGeminiKey } from '@/lib/ai/apiKey';
import { loadIntegrationConfig, useIntegrationConfig } from '@/lib/integrations/config';

const STORAGE_KEY = 'fitapp:state:v1';
const CURSOR_KEY = 'fitapp:sync-cursor:v1';
const stateKey = (owner: string) => owner === 'local' ? STORAGE_KEY : `${STORAGE_KEY}:user:${owner}`;

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
    legacyAvailable: boolean;
    importLocalData: () => Promise<void>;
  };
  storageError?: string;
}

const Ctx = createContext<StoreValue | null>(null);

async function loadState(owner: string): Promise<AppState | null> {
  const raw = await AsyncStorage.getItem(stateKey(owner));
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
  const { config: integrationConfig, loaded: integrationsLoaded } = useIntegrationConfig();
  const supabaseIdentity = `${integrationConfig.supabaseUrl}|${integrationConfig.supabaseKey}`;
  const configured = isSupabaseConfigured();
  const [state, dispatch] = useReducer(reducer, undefined, () => emptyState(newId(), nowISO()));
  const [hydrated, setHydrated] = useState(false);
  const [hydratedScope, setHydratedScope] = useState('');
  const [storageError, setStorageError] = useState<string>();
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [today, setToday] = useState(toISODate());
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // ---- provider settings and account-scoped state ----
  useEffect(() => {
    Promise.all([loadApiKey(), loadGeminiKey(), loadIntegrationConfig()])
      .catch(() => setStorageError('Saved settings could not be read.'));
    loadState('local').then((saved) => setLegacyAvailable(Boolean(saved?.profile))).catch(() => {});
  }, []);

  const [session, setSession] = useState<Session | null>(null);
  const [authIdentity, setAuthIdentity] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [lastSyncAt, setLastSyncAt] = useState<string>();
  const [syncError, setSyncError] = useState<string>();
  const owner = configured ? (session?.user.id ?? 'signed-out') : 'local';
  const authReady = !configured || authIdentity === supabaseIdentity;
  const scopeReady = integrationsLoaded && authReady && hydrated && hydratedScope === owner;

  useEffect(() => {
    if (!integrationsLoaded || !authReady) return;
    let active = true;
    if (owner === 'signed-out') {
      Promise.resolve().then(() => {
        if (!active) return;
        dispatch({ type: 'HYDRATE', state: emptyState(newId(), nowISO()) });
        setHydratedScope(owner);
        setHydrated(true);
      });
      return () => { active = false; };
    }
    loadState(owner)
      .then(async (saved) => {
        let next = saved ?? emptyState(newId(), nowISO());
        if (configured && session?.user.id === owner) {
          try {
            const cursorKey = `${CURSOR_KEY}:${owner}`;
            const raw = await AsyncStorage.getItem(cursorKey);
            const result = await syncNow(next, owner, raw ? JSON.parse(raw) as SyncCursor : EMPTY_CURSOR);
            if (!active) return;
            next = mergeRemote(next, result.rows);
            await AsyncStorage.setItem(cursorKey, JSON.stringify(result.cursor));
            setLastSyncAt(nowISO());
            setSyncError(undefined);
            setSyncStatus('idle');
          } catch (error) {
            if (active) { setSyncError(error instanceof Error ? error.message : String(error)); setSyncStatus('error'); }
          }
        }
        if (active) dispatch({ type: 'HYDRATE', state: next });
      })
      .catch(() => { if (active) { dispatch({ type: 'HYDRATE', state: emptyState(newId(), nowISO()) }); setStorageError('Saved data could not be read.'); } })
      .finally(() => { if (active) { setHydratedScope(owner); setHydrated(true); } });
    return () => { active = false; };
  }, [owner, integrationsLoaded, authReady, configured, session?.user.id]);

  useEffect(() => {
    if (!scopeReady || owner === 'signed-out') return;
    const t = setTimeout(() => {
      AsyncStorage.setItem(stateKey(owner), JSON.stringify(state)).catch(() => setStorageError('Could not save to this device. Storage may be full.'));
    }, 250);
    return () => clearTimeout(t);
  }, [state, scopeReady, owner]);

  // ---- clock: roll over at midnight ----
  useEffect(() => {
    const i = setInterval(() => setToday(toISODate()), 60_000);
    return () => clearInterval(i);
  }, []);

  const act = useCallback((action: Action) => {
    if (!scopeReady) return;
    checkAction(stateRef.current, action); // throws for the caller to show
    dispatch(action);
  }, [scopeReady]);

  // ---- adaptive coaching engine + notifications ----
  const sessionRef = useRef<Session | null>(null);
  const coaching = useRef(false);
  const runCoach = useCallback(async () => {
    if (!scopeReady) return;
    const s = stateRef.current;
    if (!s.profile || coaching.current) return;
    coaching.current = true;
    try {
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
      // Signed in: the server enforces the 3/day cap across ALL devices before we notify.
      const sb = supabase();
      if (sb && sessionRef.current) {
        try {
          const { data, error } = await sb.functions.invoke('notify', { body: { title: c.title, body: c.body, dedupe_key: c.dedupeKey, local_date: date, push: false } });
          if (!error && data && data.allowed === false) continue;
        } catch {
          /* offline: fall back to the synced local cap */
        }
      }
      const shown = await showSystemNotification(c.title, c.body);
      const stamp = nowISO();
      dispatch({
        type: 'RECORD_NOTIFICATION',
        record: { id: newId(), date, sentAt: stamp, category: c.category, title: c.title, body: c.body, dedupeKey: c.dedupeKey, deviceId: latest.deviceId, delivered: shown ? 'system' : 'in_app', updatedAt: stamp },
      });
      break;
    }
    } finally {
      coaching.current = false;
    }
  }, [scopeReady]);

  const engineKey = `${state.foodLog.length}|${state.weights.length}|${state.activity.length}|${state.sessions.length}|${state.targets?.updatedAt}|${state.profile?.updatedAt}|${today}`;
  useEffect(() => {
    if (!scopeReady) return;
    const t = setTimeout(() => void runCoach(), 800);
    return () => clearTimeout(t);
  }, [engineKey, scopeReady, runCoach]);

  useEffect(() => {
    const i = setInterval(() => void runCoach(), 15 * 60_000);
    return () => clearInterval(i);
  }, [runCoach]);

  // ---- cloud sync (optional) ----
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const syncing = useRef<string | null>(null);

  useEffect(() => {
    if (!integrationsLoaded) return;
    let active = true;
    const sb = supabase();
    if (!sb) {
      Promise.resolve().then(() => { if (active) { setSession(null); setAuthIdentity(supabaseIdentity); } });
      return () => { active = false; };
    }
    sb.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setAuthIdentity(supabaseIdentity); } });
    const { data } = sb.auth.onAuthStateChange((_e, s) => { if (active) { setSession(s); setAuthIdentity(supabaseIdentity); } });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [supabaseIdentity, integrationsLoaded]);

  const doSync = useCallback(async () => {
    if (!session || !scopeReady || syncing.current === session.user.id) return;
    const userId = session.user.id;
    syncing.current = userId;
    setSyncStatus('syncing');
    try {
      const cursorKey = `${CURSOR_KEY}:${userId}`;
      const raw = await AsyncStorage.getItem(cursorKey);
      const cursor: SyncCursor = raw ? JSON.parse(raw) : EMPTY_CURSOR;
      const result = await syncNow(stateRef.current, userId, cursor);
      if (sessionRef.current?.user.id !== userId) return;
      // Merged into the current state, so edits made during the network call are kept.
      dispatch({ type: 'MERGE_REMOTE', rows: result.rows });
      await AsyncStorage.setItem(cursorKey, JSON.stringify(result.cursor));
      setLastSyncAt(nowISO());
      setSyncError(undefined);
      setSyncStatus('idle');
    } catch (e) {
      if (sessionRef.current?.user.id === userId) {
        setSyncError(e instanceof Error ? e.message : String(e));
        setSyncStatus('error');
      }
    } finally {
      if (syncing.current === userId) syncing.current = null;
    }
  }, [session, scopeReady]);

  const importLocalData = useCallback(async () => {
    if (!session || !scopeReady || stateRef.current.profile) throw new Error('This account already has data.');
    const legacy = await loadState('local');
    if (!legacy?.profile) throw new Error('No earlier device data was found.');
    dispatch({ type: 'REPLACE_STATE', state: legacy });
    setLegacyAvailable(false);
  }, [session, scopeReady]);

  useEffect(() => {
    if (!configured || !session || !scopeReady) return;
    const first = setTimeout(() => void doSync(), 0); // sync right after sign-in
    const i = setInterval(() => void doSync(), 120_000);
    const sub = RNAppState.addEventListener('change', (s) => s === 'active' && void doSync());
    return () => {
      clearTimeout(first);
      clearInterval(i);
      sub.remove();
    };
  }, [configured, session, scopeReady, doSync]);

  // push soon after local edits
  useEffect(() => {
    if (!session || !scopeReady) return;
    const t = setTimeout(() => void doSync(), 5000);
    return () => clearTimeout(t);
  }, [state.foodLog, state.weights, state.sessions, state.proposals, state.plan, state.targets, state.profile, session, scopeReady, doSync]);

  const value = useMemo<StoreValue>(
    () => ({
      state,
      hydrated: scopeReady,
      today,
      act,
      storageError,
      // status is derived so it can't go stale when the user signs out
      sync: { configured, session, status: !configured ? 'local_only' : !session ? 'signed_out' : syncStatus, lastSyncAt, error: syncError, syncNow: doSync, legacyAvailable, importLocalData },
    }),
    [state, scopeReady, today, act, storageError, session, syncStatus, lastSyncAt, syncError, doSync, configured, legacyAvailable, importLocalData],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used inside AppStoreProvider');
  return v;
}

/** Wipe all local data on this device. */
export async function clearLocalData(userId?: string) {
  await AsyncStorage.multiRemove(userId ? [stateKey(userId), `${CURSOR_KEY}:${userId}`] : [STORAGE_KEY]);
}
