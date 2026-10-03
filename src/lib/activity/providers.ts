import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { ActivityRecord, IntegrationState } from '../types';
import { simulatedHealthConnectPull } from './activity';
import { nowISO, toISODate } from '../dates';

/**
 * Wearable integration status.
 *
 * Real Android Health Connect access needs native code (the `react-native-health-connect`
 * library + its Expo config plugin) and therefore an Expo *development build* on an Android
 * phone. It cannot run in Expo Go or in a web browser. Until that build exists, the app offers
 * a clearly labelled SIMULATED source so the full sync/review flow can be designed and tested.
 * See docs/WEARABLES.md for the integration plan and limitations.
 */
export function healthConnectSupport(): { available: boolean; reason: string } {
  if (Platform.OS === 'web') {
    return { available: false, reason: 'Health Connect only exists on Android phones. Connect it from the Android app; synced activity then shows here.' };
  }
  if (Platform.OS !== 'android') return { available: false, reason: 'Health Connect is Android-only.' };
  if (Constants.executionEnvironment === 'storeClient') {
    return { available: false, reason: 'Not available in Expo Go. It needs the app\'s development build (see docs/WEARABLES.md).' };
  }
  return { available: false, reason: 'The Health Connect module is not yet included in this build (planned next stage).' };
}

export function simulatedSync(today = toISODate()): { records: ActivityRecord[]; integration: IntegrationState } {
  return {
    records: simulatedHealthConnectPull(today),
    integration: { id: 'health_connect', status: 'connected', lastSyncAt: nowISO(), message: 'Simulated data (no real device connected)' },
  };
}
