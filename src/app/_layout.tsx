import { Stack, router, usePathname } from 'expo-router';
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
import { initErrorReporting, withErrorReporting } from '@/lib/errorReporting';
import { isPasswordRecoveryPending, onPasswordRecovery } from '@/lib/sync/supabase';
import { pageTitle } from '@/lib/uiText';

// Crash/error reporting, only when EXPO_PUBLIC_SENTRY_DSN is set (no-op otherwise).
initErrorReporting();
SplashScreen.preventAutoHideAsync().catch(() => {});

/** Routes that render without a session (the reset page explains an unusable link itself). */
const PUBLIC_ROUTES = new Set(['/reset-password']);

/**
 * A password-reset link signs the user in and fires PASSWORD_RECOVERY. Wherever the link
 * landed (an old email pointing at /settings, the Site URL), send the user to /reset-password.
 */
function RecoveryRedirect() {
  const pathname = usePathname();
  useEffect(() => {
    const go = () => {
      if (pathname !== '/reset-password') router.replace('/reset-password');
    };
    if (isPasswordRecoveryPending()) go();
    return onPasswordRecovery(go);
  }, [pathname]);
  return null;
}

function Gate() {
  const pathname = usePathname();
  const { hydrated, sync } = useStore();
  const [fontsLoaded, fontError] = useFonts({ BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold });
  // On web the CSS fallback stack keeps headings condensed while the font streams in, so don't block on it.
  const ready = hydrated && (Platform.OS === 'web' || fontsLoaded || !!fontError);
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  const landing = sync.configured && !sync.session && !PUBLIC_ROUTES.has(pathname);
  // Expo Router leaves document titles off; set one per route on web.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.title = landing ? 'FitCoach' : pageTitle(pathname);
  }, [pathname, landing]);
  if (!ready) return <Splash />;
  if (landing) return <Landing />;
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }} />
      {sync.configured ? <RecoveryRedirect /> : null}
    </>
  );
}

function RootLayout() {
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

export default withErrorReporting(RootLayout);
