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

export function supabase(): SupabaseClient | null {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;
  const config = `${url}|${key}`;
  if (!client || clientConfig !== config) {
    client = createClient(url, key, {
      auth: {
        storage: Platform.OS === 'web' ? undefined : AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
      },
    });
    clientConfig = config;
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
