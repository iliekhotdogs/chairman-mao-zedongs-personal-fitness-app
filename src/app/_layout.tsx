import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppStoreProvider, useStore } from '@/store/AppStore';
import { ToastProvider } from '@/components/Toast';
import { C } from '@/constants/theme';
import { AccountCard } from '@/components/AccountCard';
import { Screen } from '@/components/ui';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Gate() {
  const { hydrated, sync } = useStore();
  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync().catch(() => {});
  }, [hydrated]);
  if (!hydrated) return null;
  if (sync.configured && !sync.session) return <Screen><AccountCard intro="Create an account or sign in to keep your data private and sync it across devices." /></Screen>;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppStoreProvider>
        <ToastProvider>
          <StatusBar style="dark" />
          <Gate />
        </ToastProvider>
      </AppStoreProvider>
    </SafeAreaProvider>
  );
}
