import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as RNAppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';

import { contentSignature, emptyState, type AppState } from '@/lib/state';
import { checkedAction, reducer, type Action } from '@/lib/reducer';
import { pruneState, sanitizeState } from '@/lib/schemaMigrations';
import { log } from '@/lib/log';
import { newId } from '@/lib/id';
import { nowISO, toISODate } from '@/lib/dates';
import { runEngine } from '@/lib/coaching/adaptive';
import { decide, type Candidate } from '@/lib/notifications/policy';
import { showSystemNotification } from '@/lib/notifications/deliver';
import { currentPushToken, onNotificationPermissionGranted, onPushTokenChange, registerPushToken } from '@/lib/notifications/push';
import { isSupabaseConfigured, supabase } from '@/lib/sync/supabase';
import { EMPTY_CURSOR, parseCursor, syncNow, type SyncCursor, type SyncStore } from '@/lib/sync/sync';
import { localChanges } from '@/lib/sync/merge';
import { signOutAndWipe } from '@/lib/sync/signOut';
import type { Proposal } from '@/lib/types';
import { loadIntegrationConfig, useIntegrationConfig } from '@/lib/integrations/config';
import { isNetworkError } from '@/lib/uiText';

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
    /** Flush, sign out, wipe local data. Never throws; remoteOk=false if the server was unreachable. */
    signOut: () => Promise<{ remoteOk: boolean }>;
  };
  storageError?: string;
}

const Ctx = createContext<StoreValue | null>(null);

/** Read, migrate and validate saved state. Invalid records are dropped (and logged), never fatal. */
async function loadState(owner: string): Promise<AppState | null> {
  const raw = await AsyncStorage.getItem(stateKey(owner));
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    log.error('store', 'Saved state is not valid JSON; starting fresh.', e);
    throw e;
  }
  const { state, dropped } = sanitizeState(parsed, newId(), nowISO());
  if (dropped) log.warn('store', `Dropped ${dropped} unreadable saved record(s) for ${owner === 'local' ? 'this device' : 'this account'}.`);
  return state;
}

async function loadCursor(owner: string): Promise<SyncCursor> {
  return parseCursor(await AsyncStorage.getItem(`${CURSOR_KEY}:${owner}`));
}

/** Collections whose changes should re-run the coaching engine. */
const ENGINE_KEYS = ['foodLog', 'weights', 'activity', 'sessions', 'proposals', 'dayAdjustments', 'targets', 'profile', 'plan'] as const;

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
  const [state, setState] = useState<AppState>(() => emptyState(newId(), nowISO()));
  // The latest state, updated synchronously by every dispatch (not after the next render),
  // so act(), the coaching engine and sync never read a state that is a dispatch behind.
  const stateRef = useRef(state);
  const dispatch = useCallback((action: Action) => {
    const next = reducer(stateRef.current, action);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);
  const [hydrated, setHydrated] = useState(false);
  const [hydratedScope, setHydratedScope] = useState('');
  const [storageError, setStorageError] = useState<string>();
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [today, setToday] = useState(toISODate());
  /** The signed-in account's saved sync cursor (loaded at hydration, updated after each sync). */
  const cursorRef = useRef<SyncCursor>(EMPTY_CURSOR);

  // ---- provider settings and account-scoped state ----
  useEffect(() => {
    loadIntegrationConfig()
      .catch((e) => {
        log.error('store', 'Saved settings could not be read.', e);
        setStorageError('Saved settings could not be read.');
      });
    loadState('local').then((saved) => setLegacyAvailable(Boolean(saved?.profile))).catch((e) => log.warn('store', 'Could not check for earlier device data.', e));
  }, []);

  const [session, setSession] = useState<Session | null>(null);
  const [authIdentity, setAuthIdentity] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [lastSyncAt, setLastSyncAt] = useState<string>();
  const [syncError, setSyncError] = useState<string>();
  // Effects key on the user id, not the session object, which changes on every token refresh.
  const userId = session?.user.id;
  const owner = configured ? (userId ?? 'signed-out') : 'local';
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
    // Show what is saved on this device right away; the first sync runs in the background
    // once hydrated (see the sync effect below), so startup never waits on the network.
    loadState(owner)
      .then(async (saved) => {
        let next = saved ?? emptyState(newId(), nowISO());
        // Records edited at or before this are on the server; undefined = sync is off (local only).
        let syncedBefore: string | undefined;
        if (configured && userId === owner) {
          const cursor = await loadCursor(owner);
          if (!active) return;
          cursorRef.current = cursor;
          syncedBefore = cursor.lastPushedAt;
        }
        next = pruneState(next, { now: nowISO(), syncedBefore });
        if (active) dispatch({ type: 'HYDRATE', state: next });
      })
      .catch((e) => {
        log.error('store', 'Saved data could not be read.', e);
        if (active) { dispatch({ type: 'HYDRATE', state: emptyState(newId(), nowISO()) }); setStorageError('Saved data could not be read.'); }
      })
      .finally(() => { if (active) { setHydratedScope(owner); setHydrated(true); } });
    return () => { active = false; };
  }, [owner, integrationsLoaded, authReady, configured, userId, dispatch]);

  const savedProfile = useRef(false);
  useEffect(() => {
    if (!scopeReady || owner === 'signed-out') return;
    const save = () => {
      savedProfile.current = !!state.profile;
      AsyncStorage.setItem(stateKey(owner), JSON.stringify(state)).catch((e) => {
        log.error('store', 'Could not persist state.', e);
        setStorageError('Could not save to this device. Storage may be full.');
      });
    };
    // A profile that just appeared (onboarding finished) is saved at once, not after the
    // debounce, so closing the tab right away can't lose it.
    if (state.profile && !savedProfile.current) return save();
    const t = setTimeout(save, 250);
    return () => clearTimeout(t);
  }, [state, scopeReady, owner]);

  // ---- clock: roll over at midnight ----
  useEffect(() => {
    const i = setInterval(() => setToday(toISODate()), 60_000);
    return () => clearInterval(i);
  }, []);

  const act = useCallback((action: Action) => {
    if (!scopeReady) return;
    // Checked once here (throws for the caller to show); the reducer skips re-checking it.
    dispatch(checkedAction(stateRef.current, action));
  }, [scopeReady, dispatch]);

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
          // push: the server also sends it to the user's OTHER registered phones; this device
          // shows it locally below, so its own token is excluded. Only the category is sent:
          // the server picks fixed push text for it (no coaching details leave the device).
          const ownToken = currentPushToken(sessionRef.current.user.id);
          const { data, error } = await sb.functions.invoke('notify', {
            body: { category: c.category, dedupe_key: c.dedupeKey, local_date: date, push: true, ...(ownToken ? { exclude_token: ownToken } : {}) },
          });
          if (!error && data && data.allowed === false) continue;
        } catch (e) {
          // offline: fall back to the synced local cap
          log.warn('notify', 'Server notification cap check failed; using the local cap.', e);
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
  }, [scopeReady, dispatch]);

  // Content signatures (count + newest edit per collection), so edits re-trigger too, not just additions.
  const engineKey = useMemo(() => `${contentSignature(state, ENGINE_KEYS)}|${today}`, [state, today]);
  const syncKey = useMemo(() => contentSignature(state), [state]);
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

  // A signed-in device with no local profile waits for a completed first pull.
  const [firstSyncSettled, setFirstSyncSettled] = useState<string>();
  const awaitingAccountData = configured && !!userId && scopeReady && !state.profile && firstSyncSettled !== userId;

  const doSync = useCallback(async () => {
    if (!userId || !scopeReady || syncing.current === userId) return;
    syncing.current = userId;
    setSyncStatus('syncing');
    const stillSignedIn = () => sessionRef.current?.user.id === userId;
    // Sync reads and updates the LIVE state (uploads take a while; see syncNow), and stops
    // touching it if the user signs out or switches accounts meanwhile.
    const store: SyncStore = {
      get: () => {
        if (!stillSignedIn()) throw new Error('Signed out during sync.');
        return stateRef.current;
      },
      dispatch: (action) => {
        if (stillSignedIn()) dispatch(action);
      },
    };
    try {
      const cursorKey = `${CURSOR_KEY}:${userId}`;
      const result = await syncNow(store, userId, await loadCursor(userId));
      if (!stillSignedIn()) return;
      // Merged into the current state, so edits made during the network calls are kept.
      dispatch({ type: 'MERGE_REMOTE', rows: result.rows });
      setFirstSyncSettled(userId);
      cursorRef.current = result.cursor;
      await AsyncStorage.setItem(cursorKey, JSON.stringify(result.cursor));
      setLastSyncAt(nowISO());
      setSyncError(result.pushError);
      setSyncStatus(!result.pushError ? 'idle' : isNetworkError(result.pushError) ? 'offline' : 'error');
    } catch (e) {
      log.warn('sync', 'Sync failed.', e);
      if (stillSignedIn()) {
        setSyncError(e instanceof Error ? e.message : String(e));
        const offline = (Platform.OS === 'web' && typeof navigator !== 'undefined' && !navigator.onLine) || isNetworkError(e instanceof Error ? e.message : String(e));
        setSyncStatus(offline ? 'offline' : 'error');
      }
    } finally {
      if (syncing.current === userId) syncing.current = null;
    }
  }, [userId, scopeReady, dispatch]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const offline = () => setSyncStatus('offline');
    const online = () => void doSync();
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    if (!navigator.onLine) offline();
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online); };
  }, [doSync]);

  const importLocalData = useCallback(async () => {
    if (!userId || !scopeReady || stateRef.current.profile) throw new Error('This account already has data.');
    const legacy = await loadState('local');
    if (!legacy?.profile) throw new Error('No earlier device data was found.');
    // Merged into what was already pulled for the account, and re-stamped so it all uploads.
    dispatch({ type: 'IMPORT_LEGACY', legacy, now: nowISO() });
    setLegacyAvailable(false);
  }, [userId, scopeReady, dispatch]);

  const signOut = useCallback(() => {
    const uid = session?.user.id;
    return signOutAndWipe({
      flush: doSync,
      signOut: async () => {
        const sb = supabase();
        const { error } = (await sb?.auth.signOut()) ?? {};
        if (error) { await sb?.auth.signOut({ scope: 'local' }); throw error; }
      },
      reset: () => {
        sessionRef.current = null;
        setSession(null);
        dispatch({ type: 'REPLACE_STATE', state: emptyState(newId(), nowISO()) });
      },
      clear: async () => {
        // includes the pre-account 'local' copy so the next person on a shared device can't import it
        await AsyncStorage.multiRemove([STORAGE_KEY, ...(uid ? [stateKey(uid), `${CURSOR_KEY}:${uid}`] : [])]);
      },
    });
  }, [session, doSync, dispatch]);

  useEffect(() => {
    if (!configured || !userId || !scopeReady) return;
    // First sync for this account, in the background right after hydration (or sign-in).
    const first = setTimeout(() => void doSync(), 0);
    const i = setInterval(() => void doSync(), firstSyncSettled === userId ? 120_000 : 10_000);
    const sub = RNAppState.addEventListener('change', (s) => s === 'active' && void doSync());
    return () => {
      clearTimeout(first);
      clearInterval(i);
      sub.remove();
    };
  }, [configured, userId, scopeReady, firstSyncSettled, doSync]);

  // ---- remote push: register this device's Expo push token (native builds only) ----
  useEffect(() => {
    const sb = supabase();
    if (!sb || !userId) return;
    let active = true;
    const register = () => { if (active) void registerPushToken(sb, userId); };
    register();
    const offPermission = onNotificationPermissionGranted(register);
    const appState = RNAppState.addEventListener('change', (s) => s === 'active' && register());
    let offTokenChange: () => void = () => {};
    void onPushTokenChange(register).then((off) => { if (active) offTokenChange = off; else off(); });
    return () => {
      active = false;
      offPermission();
      appState.remove();
      offTokenChange();
    };
  }, [userId, supabaseIdentity]);

  // Push soon after local edits to ANY synced collection or singleton (see SYNCED_* in
  // state.ts). Only when there is something to push: rows merged in by a sync change the
  // signature too, and must not trigger another sync right after it.
  useEffect(() => {
    if (!userId || !scopeReady) return;
    const t = setTimeout(() => {
      if (localChanges(stateRef.current, cursorRef.current.lastPushedAt).length) void doSync();
    }, 5000);
    return () => clearTimeout(t);
  }, [syncKey, userId, scopeReady, doSync]);

  const value = useMemo<StoreValue>(
    () => ({
      state,
      hydrated: scopeReady && !awaitingAccountData,
      today,
      act,
      storageError,
      // status is derived so it can't go stale when the user signs out
      sync: { configured, session, status: !configured ? 'local_only' : !session ? 'signed_out' : syncStatus, lastSyncAt, error: syncError, syncNow: doSync, legacyAvailable, importLocalData, signOut },
    }),
    [state, scopeReady, awaitingAccountData, today, act, storageError, session, syncStatus, lastSyncAt, syncError, doSync, configured, legacyAvailable, importLocalData, signOut],
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
