import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from '@/lib/integrations/config';
import { log } from '@/lib/log';
import { unregisterPushToken } from '@/lib/notifications/push';

/**
 * Supabase is optional. Without these public settings the app runs in
 * "this device only" mode. The anon/publishable key is designed to be public;
 * Row Level Security on the database is what protects each user's data.
 */
export function isSupabaseConfigured(): boolean {
  const { url, key } = getSupabaseConfig();
  return Boolean(url && key);
}

let client: SupabaseClient | null = null;
let clientConfig = '';

// ---- password recovery ----
// A reset link signs the user in and Supabase emits PASSWORD_RECOVERY, often during client
// start-up before any screen is listening. The flag remembers it so the root layout can send
// the user to /reset-password wherever the link landed.
let recoveryPending = false;
const recoveryListeners = new Set<() => void>();

/** True after a password-reset link signed this browser in, until the new password is saved. */
export function isPasswordRecoveryPending(): boolean {
  return recoveryPending;
}

export function clearPasswordRecovery(): void {
  recoveryPending = false;
}

/** Called when a PASSWORD_RECOVERY event arrives. Returns an unsubscribe function. */
export function onPasswordRecovery(listener: () => void): () => void {
  recoveryListeners.add(listener);
  return () => { recoveryListeners.delete(listener); };
}

export function supabase(): SupabaseClient | null {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;
  const config = `${url}|${key}`;
  if (!client || clientConfig !== config) {
    client = createClient(url, key, {
      auth: {
        // PKCE: email links (password reset) come back with a one-time ?code= that only the
        // browser which asked for the link can exchange (the verifier is in its storage), so
        // tokens never appear in the URL. detectSessionInUrl exchanges the code on start-up.
        flowType: 'pkce',
        storage: Platform.OS === 'web' ? undefined : AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
      },
    });
    clientConfig = config;
    // Subscribed synchronously after creation, so the event fired by the start-up code exchange is seen.
    client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        recoveryPending = true;
        recoveryListeners.forEach((listener) => listener());
      } else if (event === 'SIGNED_OUT') {
        recoveryPending = false;
      }
    });
  }
  return client;
}

/**
 * Sign out, first removing this device's push token (the delete needs the session for RLS),
 * so a signed-out phone stops receiving the account's coaching notifications.
 */
export async function signOut(options?: { scope?: 'global' | 'local' | 'others' }): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  await unregisterPushToken(sb).catch(() => {});
  const { error } = await sb.auth.signOut(options);
  if (error) log.warn('auth', 'Sign-out reported an error.', error);
}
