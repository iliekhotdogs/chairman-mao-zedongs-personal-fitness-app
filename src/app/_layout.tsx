import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppStoreProvider, useStore } from '@/store/AppStore';
import { ToastProvider } from '@/components/Toast';
import { C } from '@/constants/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Gate() {
  const { hydrated } = useStore();
  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync().catch(() => {});
  }, [hydrated]);
  if (!hydrated) return null;
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
