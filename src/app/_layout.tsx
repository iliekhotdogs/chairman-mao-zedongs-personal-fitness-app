import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { BarlowCondensed_800ExtraBold } from '@expo-google-fonts/barlow-condensed/800ExtraBold';

import { AppStoreProvider, useStore } from '@/store/AppStore';
import { ToastProvider } from '@/components/Toast';
import { C } from '@/constants/theme';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Splash } from '@/components/Splash';
import { Landing } from '@/components/landing/Landing';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Gate() {
  const { hydrated, sync } = useStore();
  const [fontsLoaded, fontError] = useFonts({ BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold });
  // On web the CSS fallback stack keeps headings condensed while the font streams in, so don't block on it.
  const ready = hydrated && (Platform.OS === 'web' || fontsLoaded || !!fontError);
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return <Splash />;
  if (sync.configured && !sync.session) return <Landing />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider style={{ backgroundColor: C.bg }}>
      <ErrorBoundary>
        <AppStoreProvider>
          <ToastProvider>
            <StatusBar style="light" />
            <Gate />
          </ToastProvider>
        </AppStoreProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
