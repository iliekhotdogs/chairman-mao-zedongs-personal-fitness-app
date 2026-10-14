import React from 'react';
import { Platform, View } from 'react-native';
import { C, Space } from '@/constants/theme';
import { AccentRule, Button, Muted, Stack, Text } from './ui';
import { LogoMark } from './Brand';
import { log } from '@/lib/log';

type Props = { children: React.ReactNode };
type State = { error?: Error };

/** Catches render errors anywhere below it and shows a styled fallback with a reload action. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Goes to the error reporter (Sentry) when one is configured; the console in development.
    log.error('crash', 'FitCoach crashed while rendering.', error);
    if (__DEV__) console.error(info.componentStack);
  }

  reload = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.reload();
    else this.setState({ error: undefined });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return <CrashScreen error={this.state.error} onReload={this.reload} />;
  }
}

export function CrashScreen({ error, onReload }: { error: Error; onReload: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: Space.xl }}>
      <Stack gap={Space.lg} style={{ maxWidth: 460, width: '100%' }} accessibilityRole="alert">
        <LogoMark size={44} />
        <Text variant="display">Something broke.</Text>
        <AccentRule />
        <Muted>FitCoach hit an unexpected error. Your logged data is saved; reloading usually fixes this.</Muted>
        <Text variant="small" color={C.textMuted} numberOfLines={3} selectable>
          {error.message || String(error)}
        </Text>
        <Button title="Reload" icon="refresh" size="lg" onPress={onReload} />
      </Stack>
    </View>
  );
}
