import { Redirect, Slot } from 'expo-router';
import { AppShell } from '@/components/AppShell';
import { useStore } from '@/store/AppStore';

export default function MainLayout() {
  const { state } = useStore();
  if (!state.profile || !state.targets) return <Redirect href="/onboarding" />;
  return (
    <AppShell>
      <Slot />
    </AppShell>
  );
}
