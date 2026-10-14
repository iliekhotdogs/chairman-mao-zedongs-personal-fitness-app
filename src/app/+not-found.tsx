import React from 'react';
import { router, Stack as RouterStack } from 'expo-router';

import { Space } from '@/constants/theme';
import { Button, EmptyState, Row, Screen, Text } from '@/components/ui';
import { LogoMark } from '@/components/Brand';

/** Unknown URLs. Replaces Expo Router's default page, which lists every route. */
export default function NotFound() {
  return (
    <Screen size="narrow" maxWidth={520}>
      <RouterStack.Screen options={{ title: 'Page not found' }} />
      <Row gap={Space.sm}>
        <LogoMark />
        <Text variant="h3">FitCoach</Text>
      </Row>
      <EmptyState
        icon="compass-outline"
        title="Page not found"
        body="This page doesn't exist or has moved."
        action={<Button title="Go to Today" icon="home-outline" onPress={() => router.replace('/')} />}
      />
    </Screen>
  );
}
