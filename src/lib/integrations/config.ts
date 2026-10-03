import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type IntegrationConfig = { supabaseUrl: string; supabaseKey: string; usdaKey: string };
const EMPTY: IntegrationConfig = { supabaseUrl: '', supabaseKey: '', usdaKey: '' };
const STORAGE_KEY = 'fitapp.integrations.v1';
let saved: IntegrationConfig = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

async function read(): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(STORAGE_KEY);
  const SecureStore = await import('expo-secure-store');
  return SecureStore.getItemAsync(STORAGE_KEY);
}

async function write(value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (value) await AsyncStorage.setItem(STORAGE_KEY, value);
    else await AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }
  const SecureStore = await import('expo-secure-store');
  if (value) await SecureStore.setItemAsync(STORAGE_KEY, value);
  else await SecureStore.deleteItemAsync(STORAGE_KEY);
}

export async function loadIntegrationConfig(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await read();
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<IntegrationConfig>;
      saved = {
        supabaseUrl: typeof parsed.supabaseUrl === 'string' ? parsed.supabaseUrl : '',
        supabaseKey: typeof parsed.supabaseKey === 'string' ? parsed.supabaseKey : '',
        usdaKey: typeof parsed.usdaKey === 'string' ? parsed.usdaKey : '',
      };
    }
  } catch {
    saved = EMPTY;
  }
  loaded = true;
  emit();
}

export function getIntegrationConfig(): IntegrationConfig { return saved; }

export function getSupabaseConfig() {
  const builtUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const builtKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return {
    url: builtUrl && builtKey ? builtUrl : saved.supabaseUrl,
    key: builtUrl && builtKey ? builtKey : saved.supabaseKey,
  };
}

export function getUsdaKey(): string {
  return saved.usdaKey || process.env.EXPO_PUBLIC_USDA_API_KEY || 'DEMO_KEY';
}

export function validateSupabaseConfig(url: string, key: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) || parsed.pathname !== '/') {
      return 'Enter your HTTPS Supabase project URL (https://<project>.supabase.co).';
    }
  } catch {
    return 'Enter a valid Supabase project URL.';
  }
  if (!key.trim().startsWith('sb_publishable_')) return 'Use a Supabase publishable key (sb_publishable_…), never a secret or service-role key.';
  return null;
}

export async function saveSupabaseConfig(url: string, key: string): Promise<void> {
  const error = validateSupabaseConfig(url, key);
  if (error) throw new Error(error);
  const next = { ...saved, supabaseUrl: url.trim().replace(/\/$/, ''), supabaseKey: key.trim() };
  await write(JSON.stringify(next));
  saved = next;
  loaded = true;
  emit();
}

export async function removeSupabaseConfig(): Promise<void> {
  const next = { ...saved, supabaseUrl: '', supabaseKey: '' };
  await write(JSON.stringify(next));
  saved = next;
  emit();
}

export async function saveUsdaKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!/^[A-Za-z0-9]{40}$/.test(trimmed)) throw new Error('Paste only the 40-character API key from your USDA email.');
  const next = { ...saved, usdaKey: trimmed };
  await write(JSON.stringify(next));
  saved = next;
  loaded = true;
  emit();
}

export async function removeUsdaKey(): Promise<void> {
  const next = { ...saved, usdaKey: '' };
  await write(JSON.stringify(next));
  saved = next;
  emit();
}

export async function clearIntegrationConfig(): Promise<void> {
  await write(null);
  saved = EMPTY;
  loaded = true;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIntegrationConfig(): { config: IntegrationConfig; loaded: boolean } {
  const config = useSyncExternalStore(subscribe, getIntegrationConfig, () => EMPTY);
  const isLoaded = useSyncExternalStore(subscribe, () => loaded, () => false);
  return { config, loaded: isLoaded };
}
