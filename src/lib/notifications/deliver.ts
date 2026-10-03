import { Platform } from 'react-native';

export type PermissionResult = 'granted' | 'denied' | 'unsupported';

type ExpoNotifications = typeof import('expo-notifications');

/** Loaded lazily: in Expo Go some notification features are unavailable and log warnings on import. */
async function native(): Promise<ExpoNotifications | null> {
  try {
    const mod = await import('expo-notifications');
    mod.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
    return mod;
  } catch {
    return null;
  }
}

export async function requestPermission(): Promise<PermissionResult> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    const r = await window.Notification.requestPermission();
    return r === 'granted' ? 'granted' : 'denied';
  }
  const N = await native();
  if (!N) return 'unsupported';
  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync('coach', { name: 'Coach check-ins', importance: N.AndroidImportance.DEFAULT });
  }
  const current = await N.getPermissionsAsync();
  if (current.granted) return 'granted';
  const r = await N.requestPermissionsAsync();
  return r.granted ? 'granted' : 'denied';
}

export async function permissionStatus(): Promise<PermissionResult | 'undetermined'> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    const p = window.Notification.permission;
    return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'undetermined';
  }
  const N = await native();
  if (!N) return 'unsupported';
  const s = await N.getPermissionsAsync();
  return s.granted ? 'granted' : s.canAskAgain ? 'undetermined' : 'denied';
}

/** Show a local system notification. Returns false if the platform could not show it. */
export async function showSystemNotification(title: string, body: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || !('Notification' in window) || window.Notification.permission !== 'granted') return false;
      new window.Notification(title, { body });
      return true;
    }
    const N = await native();
    if (!N) return false;
    const perm = await N.getPermissionsAsync();
    if (!perm.granted) return false;
    await N.scheduleNotificationAsync({ content: { title, body }, trigger: Platform.OS === 'android' ? { channelId: 'coach' } : null });
    return true;
  } catch {
    return false;
  }
}
