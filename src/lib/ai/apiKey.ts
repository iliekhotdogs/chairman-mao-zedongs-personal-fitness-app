import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The user's own NVIDIA API key (from build.nvidia.com, starts with "nvapi-").
 *
 * Kept ONLY on this device and deliberately outside AppState, so it is never synced to
 * Supabase, never included in data exports, and never sent anywhere except NVIDIA's API (on web, via the local dev server's pass-through).
 *  - Android: expo-secure-store (encrypted with the Android Keystore).
 *  - Web: the browser's local storage for this site (readable by anyone using this browser profile).
 */

const STORE_KEY = 'fitapp.nvidia-api-key';
const GEMINI_STORE_KEY = 'fitapp.gemini-api-key';

let current: string | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function read(storeKey = STORE_KEY): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(storeKey);
  const SecureStore = await import('expo-secure-store');
  return SecureStore.getItemAsync(storeKey);
}

async function write(value: string | null, storeKey = STORE_KEY): Promise<void> {
  if (Platform.OS === 'web') {
    if (value) await AsyncStorage.setItem(storeKey, value);
    else await AsyncStorage.removeItem(storeKey);
    return;
  }
  const SecureStore = await import('expo-secure-store');
  if (value) await SecureStore.setItemAsync(storeKey, value);
  else await SecureStore.deleteItemAsync(storeKey);
}

/** Loads the saved key once at startup. Safe to call repeatedly. */
export async function loadApiKey(): Promise<string | null> {
  if (loaded) return current;
  try {
    current = (await read()) || null;
  } catch {
    current = null; // storage unavailable (e.g. private window): behave as "no key"
  }
  loaded = true;
  emit();
  return current;
}

export function getApiKey(): string | null {
  return current;
}

export async function saveApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  await write(trimmed || null);
  current = trimmed || null;
  loaded = true;
  emit();
}

export async function removeApiKey(): Promise<void> {
  await write(null);
  current = null;
  emit();
}

/** NVIDIA keys look like "nvapi-…". Used only for a friendly warning. */
export function looksLikeNvidiaKey(key: string): boolean {
  return /^nvapi-[A-Za-z0-9_-]{20,}$/.test(key.trim());
}

/** "nvapi-A…a1b2" so the user can recognise the saved key without exposing it. */
export function maskKey(key: string): string {
  const k = key.trim();
  return k.length <= 12 ? '••••' : `${k.slice(0, 7)}…${k.slice(-4)}`;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** React hook: the saved key (or null) and whether storage has been read yet. */
export function useApiKey(): { key: string | null; loaded: boolean } {
  const key = useSyncExternalStore(subscribe, () => current, () => null);
  const isLoaded = useSyncExternalStore(subscribe, () => loaded, () => false);
  return { key, loaded: isLoaded };
}

/** Test helper. */
export function __setApiKeyForTests(key: string | null) {
  current = key;
  loaded = true;
  emit();
}

// The coach's Gemini key is independent of the NVIDIA photo key. Neither key enters
// AppState, cloud sync, or data exports.
let geminiKey: string | null = null;
let geminiLoaded = false;
const geminiListeners = new Set<() => void>();
const emitGemini = () => geminiListeners.forEach((listener) => listener());

export async function loadGeminiKey(): Promise<string | null> {
  if (geminiLoaded) return geminiKey;
  try { geminiKey = (await read(GEMINI_STORE_KEY)) || null; }
  catch { geminiKey = null; }
  geminiLoaded = true;
  emitGemini();
  return geminiKey;
}

export function getGeminiKey(): string | null { return geminiKey; }

export async function saveGeminiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('Enter a Gemini API key.');
  await write(trimmed, GEMINI_STORE_KEY);
  geminiKey = trimmed;
  geminiLoaded = true;
  emitGemini();
}

export async function removeGeminiKey(): Promise<void> {
  await write(null, GEMINI_STORE_KEY);
  geminiKey = null;
  geminiLoaded = true;
  emitGemini();
}

function subscribeGemini(listener: () => void) {
  geminiListeners.add(listener);
  return () => geminiListeners.delete(listener);
}

export function useGeminiKey(): { key: string | null; loaded: boolean } {
  const key = useSyncExternalStore(subscribeGemini, () => geminiKey, () => null);
  const isLoaded = useSyncExternalStore(subscribeGemini, () => geminiLoaded, () => false);
  return { key, loaded: isLoaded };
}

export function __setGeminiKeyForTests(key: string | null) {
  geminiKey = key;
  geminiLoaded = true;
  emitGemini();
}
