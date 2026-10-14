import { Platform } from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

import { log } from '@/lib/log';

/**
 * Expo push token registration (Android/iOS builds only; web and simulators skip it).
 *
 * The token is stored in `push_tokens` through the `register_push_token` RPC, which also
 * removes it from any other account that used this device before. The `notify` Edge
 * Function sends to the user's OTHER devices (this one shows a local notification itself).
 * Requires an EAS project id (`extra.eas.projectId` in app config) and FCM credentials in
 * EAS; see docs/RELEASE.md.
 */

/** Token registered on this device, and for which user. */
let registered: { token: string; userId: string } | null = null;

export function currentPushToken(userId: string): string | undefined {
  return registered?.userId === userId ? registered.token : undefined;
}

/** EAS project id from app config, or undefined when the app is not linked to EAS. */
export async function easProjectId(): Promise<string | undefined> {
  try {
    const { default: Constants } = await import('expo-constants');
    const id = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    return typeof id === 'string' && id ? id : undefined;
  } catch (e) {
    log.warn('push', 'expo-constants is unavailable.', e);
    return undefined;
  }
}

let warnedNoProject = false;

/**
 * Registers this device's Expo push token for the signed-in user if notification permission
 * is already granted. Never prompts. Returns the token, or undefined when push is not
 * possible here (web, simulator, no permission, no EAS project id, offline).
 */
export async function registerPushToken(sb: SupabaseClient, userId: string): Promise<string | undefined> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return undefined;
  if (registered?.userId === userId) return registered.token;
  try {
    const Device = await import('expo-device');
    if (!Device.isDevice) return undefined; // simulators/emulators cannot receive push
    const N = await import('expo-notifications');
    const permission = await N.getPermissionsAsync();
    if (!permission.granted) return undefined;
    const projectId = await easProjectId();
    if (!projectId) {
      if (!warnedNoProject) log.warn('push', 'No EAS project id in app config (extra.eas.projectId); remote push is off. Run `eas init`.');
      warnedNoProject = true;
      return undefined;
    }
    if (Platform.OS === 'android') {
      // Android 13+ needs a channel before a token can be issued.
      await N.setNotificationChannelAsync('coach', { name: 'Coach check-ins', importance: N.AndroidImportance.DEFAULT });
    }
    const { data: token } = await N.getExpoPushTokenAsync({ projectId });
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    const { error } = await sb.rpc('register_push_token', { p_token: token, p_platform: Platform.OS, p_timezone: timezone });
    if (error) {
      log.warn('push', 'Could not save the push token; will retry later.', error);
      return undefined;
    }
    registered = { token, userId };
    return token;
  } catch (e) {
    // Offline, missing FCM credentials, or Expo's token service unavailable: retry later.
    log.warn('push', 'Could not get a push token; will retry later.', e);
    return undefined;
  }
}

/** Removes this device's token for the signed-in user. Call BEFORE signing out (RLS needs the session). */
export async function unregisterPushToken(sb: SupabaseClient): Promise<void> {
  const current = registered;
  registered = null;
  if (!current) return;
  const { error } = await sb.from('push_tokens').delete().eq('user_id', current.userId).eq('token', current.token);
  if (error) log.warn('push', 'Could not remove the push token from the server.', error);
}

/** Forget the local registration without a server call (account deleted: rows cascade). */
export function forgetPushToken(): void {
  registered = null;
}

/** Push tokens can roll; re-register when that happens. Returns an unsubscribe function. */
export async function onPushTokenChange(listener: () => void): Promise<() => void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return () => {};
  try {
    const N = await import('expo-notifications');
    const sub = N.addPushTokenListener(() => {
      registered = null;
      listener();
    });
    return () => sub.remove();
  } catch (e) {
    log.warn('push', 'Push token updates are unavailable on this build.', e);
    return () => {};
  }
}

// Permission granted from Settings: let the store register right away.
const permissionListeners = new Set<() => void>();
export function onNotificationPermissionGranted(listener: () => void): () => void {
  permissionListeners.add(listener);
  return () => { permissionListeners.delete(listener); };
}
export function emitNotificationPermissionGranted(): void {
  permissionListeners.forEach((listener) => listener());
}
