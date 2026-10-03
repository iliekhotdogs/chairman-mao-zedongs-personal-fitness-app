import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from '@/lib/integrations/config';

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
