import React, { useState } from 'react';
import { Image, Linking, Platform, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { C, Radius, Space } from '@/constants/theme';
import { Badge, Banner, Button, Card, ErrorState, Expandable, Field, LoadingState, Muted, PageHeader, Row, Screen, Segmented, Sheet, Stack, Text, Columns } from '@/components/ui';
import { FoodItemEditor, FoodSearch, ItemSourceDetails } from '@/components/FoodItemEditor';
import { useStore } from '@/store/AppStore';
import { useAct } from '@/components/Toast';
import { estimateFood, AIUnavailableError } from '@/lib/ai/provider';
import { confirmEstimate, defaultMealForTime, FoodConfirmationError } from '@/lib/nutrition/estimate';
import { sumItems } from '@/lib/nutrition/lookup';
import type { Confidence, EstimateItem, FoodEstimate, FoodItem, MealType } from '@/lib/types';
import { useLayout } from '@/hooks/useLayout';
import { persistPhoto } from '@/lib/photo';
import { useAiEngine } from '@/hooks/useAiEngine';

type Phase = 'pick' | 'analyzing' | 'review' | 'error' | 'denied';

const MEALS: { value: MealType; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' }, { value: 'lunch', label: 'Lunch' }, { value: 'dinner', label: 'Dinner' }, { value: 'snack', label: 'Snack' },
];

const CONF: Record<Confidence, { kind: 'saved' | 'pending' | 'danger'; label: string }> = {
  high: { kind: 'saved', label: 'Higher confidence' },
  medium: { kind: 'pending', label: 'Medium confidence' },
  low: { kind: 'danger', label: 'Low confidence. Please check' },
};

export default function CaptureScreen() {
  const { state, today } = useStore();
  const doAct = useAct();
  const { isPhone } = useLayout();
  const params = useLocalSearchParams<{ date?: string }>();
  const date = params.date ?? today;

  const [phase, setPhase] = useState<Phase>('pick');
  const [photo, setPhoto] = useState<{ uri: string; width?: number; height?: number } | null>(null);
  const [hint, setHint] = useState('');
  const [meal, setMeal] = useState<MealType>(defaultMealForTime());
  const [estimate, setEstimate] = useState<FoodEstimate | null>(null);
  const [items, setItems] = useState<(FoodItem | EstimateItem)[]>([]);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string>();
  const [addOpen, setAddOpen] = useState(false);
  const [answered, setAnswered] = useState(false);
  const engine = useAiEngine();
  const realAI = engine !== 'simulated';

  const pick = async (source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setPhase('denied');
          return;
        }
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsEditing: false };
      const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setPhoto({ uri: a.uri, width: a.width, height: a.height });
    } catch {
      setError('Could not open the camera or photo library on this device.');
      setPhase('error');
    }
  };

  const analyze = async (extraHint?: string) => {
    const fullHint = [hint.trim(), extraHint?.trim()].filter(Boolean).join(', ');
    setPhase('analyzing');
    setError(undefined);
    try {
      const est = await estimateFood(state, { hint: fullHint, photoUri: photo?.uri, photoSize: photo ? { width: photo.width, height: photo.height } : undefined, followUpAnswered: Boolean(extraHint) || answered });
      if (extraHint) {
        setHint(fullHint);
        setAnswered(true);
      }
      setEstimate(est);
      setItems(est.items);
      setAnswer('');
      setPhase('review');
    } catch (e) {
      setError(e instanceof AIUnavailableError ? e.message : 'The estimate could not be created. Check your connection and try again.');
      setPhase('error');
    }
  };

  const accept = async () => {
    if (!estimate) return;
    try {
      const photoUri = await persistPhoto(estimate.photoUri, estimate.id);
      const entry = confirmEstimate({ estimate: { ...estimate, photoUri }, items, meal, date, userAccepted: true });
      if (doAct({ type: 'LOG_FOOD', entry }, `Logged ${Math.round(sumItems(items).calories)} kcal`)) router.replace('/food');
    } catch (e) {
      setError(e instanceof FoodConfirmationError ? e.message : 'Could not log this meal.');
    }
  };

  const discard = () => {
    setAnswered(false);
    setEstimate(null);
    setItems([]);
    setPhase('pick');
  };

  const total = sumItems(items);

  // ---------- render ----------
  return (
    <Screen maxWidth={980}>
      <PageHeader title="Log a meal" subtitle={phase === 'review' ? 'Review the estimate. Nothing is saved until you accept.' : 'Take or upload a photo and add a short hint.'} right={<Button title="Cancel" kind="ghost" onPress={() => router.back()} />} />

      {!realAI ? (
        <Banner kind="simulated" title="Built-in estimates">
          Without an AI key, the estimate comes from your hint matched against built-in reference foods. The photo itself is not analysed. Add an NVIDIA API key in Settings → AI for real photo recognition.
        </Banner>
      ) : null}
      {phase === 'review' && estimate?.aiNotice ? (
        <Banner kind="warning" title="NVIDIA AI didn't work this time">{`${estimate.aiNotice} This is the built-in estimate from your hint instead. Check the items carefully.`}</Banner>
      ) : null}

      {phase === 'denied' && (
        <Card tone="pending" style={{ gap: Space.sm }} accessibilityRole="alert">
          <Text variant="h3">Camera access is off</Text>
          <Muted>FitCoach needs camera permission to take meal photos. You can turn it on in your device settings, or upload a photo from your gallery instead.</Muted>
          <Row wrap gap={Space.sm}>
            {Platform.OS !== 'web' ? <Button title="Open settings" kind="secondary" icon="settings-outline" onPress={() => Linking.openSettings()} /> : null}
            <Button title="Upload a photo instead" icon="images-outline" onPress={() => { setPhase('pick'); void pick('library'); }} />
            <Button title="Enter manually" kind="ghost" onPress={() => router.replace({ pathname: '/food/manual', params: { date } })} />
          </Row>
        </Card>
      )}

      {phase === 'pick' && (
        <Columns ratio={[1, 1]}>
          {[
            <Stack key="photo" gap={Space.md}>
              {photo ? (
                <Stack gap={Space.sm}>
                  <Image source={{ uri: photo.uri }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: Radius.lg, backgroundColor: C.surfaceAlt }} resizeMode="cover" accessibilityLabel="Selected meal photo" />
                  <Row gap={Space.sm}>
                    <Button title="Retake" kind="secondary" size="sm" icon="camera-outline" onPress={() => pick('camera')} />
                    <Button title="Choose another" kind="secondary" size="sm" icon="images-outline" onPress={() => pick('library')} />
                    <Button title="Remove" kind="ghost" size="sm" onPress={() => setPhoto(null)} />
                  </Row>
                </Stack>
              ) : (
                <Card style={{ alignItems: 'center', paddingVertical: Space.xxxl, borderStyle: 'dashed', borderColor: C.borderStrong, gap: Space.md }}>
                  <Badge kind="neutral" label="No photo yet" icon="image-outline" />
                  <Row wrap gap={Space.sm} style={{ justifyContent: 'center' }}>
                    <Button title={Platform.OS === 'web' && !isPhone ? 'Use camera' : 'Take photo'} icon="camera" onPress={() => pick('camera')} />
                    <Button title="Upload" kind="secondary" icon="images-outline" onPress={() => pick('library')} />
                  </Row>
                  <Muted variant="small" style={{ textAlign: 'center' }}>A photo is optional. A good hint alone also works.</Muted>
                </Card>
              )}
            </Stack>,
            <Stack key="hint" gap={Space.md}>
              <Field
                label="Hint (recommended)"
                value={hint}
                onChangeText={setHint}
                placeholder={'e.g. "Wendy\'s double burger" or "homemade chicken curry"'}
                hint="Brand, dish name, or amounts help a lot (e.g. '2 eggs, 1 slice toast')."
                multiline
                inputStyle={{ minHeight: 64, textAlignVertical: 'top' }}
              />
              <Text variant="smallStrong">Meal</Text>
              <Segmented label="Meal" value={meal} onChange={setMeal} options={MEALS} />
              <Button title="Estimate calories" size="lg" icon="sparkles" onPress={() => analyze()} disabled={!photo && !hint.trim()} full />
              <Button title="Enter manually instead" kind="ghost" onPress={() => router.replace({ pathname: '/food/manual', params: { date } })} />
            </Stack>,
          ]}
        </Columns>
      )}

      {phase === 'analyzing' && (
        <Stack gap={Space.md}>
          <LoadingState label={realAI ? 'Identifying food and looking up nutrition sources…' : 'Matching your hint to reference foods (built-in)…'} lines={4} />
          <Button title="Cancel" kind="ghost" onPress={() => setPhase('pick')} />
        </Stack>
      )}

      {phase === 'error' && (
        <ErrorState
          title="Couldn't create an estimate"
          body={error}
          onRetry={() => analyze()}
          secondary={<Button title="Enter manually" kind="secondary" size="sm" onPress={() => router.replace({ pathname: '/food/manual', params: { date } })} />}
        />
      )}

      {phase === 'review' && estimate && (
        <Columns ratio={[2, 3]}>
          {[
            <Stack key="left" gap={Space.md}>
              {estimate.photoUri ? <Image source={{ uri: estimate.photoUri }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: Radius.lg, backgroundColor: C.surfaceAlt }} accessibilityLabel="Meal photo" /> : null}
              <Card tone="pending" style={{ gap: Space.sm }}>
                <Row wrap gap={6}>
                  <Badge kind="suggestion" label="AI estimate" />
                  {estimate.simulated ? <Badge kind="simulated" label="Simulated" /> : null}
                  <Badge kind={CONF[estimate.overallConfidence].kind} label={CONF[estimate.overallConfidence].label} />
                </Row>
                <Row align="flex-end" gap={6}>
                  <Text variant="number">{Math.round(total.calories).toLocaleString()}</Text>
                  <Muted style={{ marginBottom: 4 }}>kcal estimated</Muted>
                </Row>
                <Muted variant="small">
                  P {Math.round(total.proteinG)} g · C {Math.round(total.carbsG)} g · F {Math.round(total.fatG)} g
                </Muted>
                <Muted variant="small">Photos can&apos;t reveal exact calories. Portion size is the biggest source of error, so adjust anything that looks off.</Muted>
                <Expandable title="Confidence & uncertainty" icon="analytics-outline">
                  {estimate.notes.map((n, i) => (
                    <Muted key={i} variant="small">• {n}</Muted>
                  ))}
                  <Muted variant="small">• Estimated by: {estimate.provider}</Muted>
                </Expandable>
              </Card>
              {estimate.followUpQuestion ? (
                <Card tone="info" style={{ gap: Space.sm }}>
                  <Row gap={6}>
                    <Badge kind="info" label="Quick question" icon="help-circle-outline" />
                  </Row>
                  <Text variant="bodyStrong">{estimate.followUpQuestion}</Text>
                  <Field value={answer} onChangeText={setAnswer} placeholder="Your answer" accessibilityLabel="Answer to follow-up question" />
                  <Button title="Update estimate" kind="secondary" size="sm" icon="refresh" disabled={!answer.trim()} onPress={() => analyze(answer)} />
                </Card>
              ) : null}
            </Stack>,
            <Stack key="right" gap={Space.md}>
              <Text variant="h3">Items ({items.length})</Text>
              {items.length === 0 ? (
                <Card tone="muted">
                  <Muted>No foods identified yet. Answer the question, or add items yourself.</Muted>
                </Card>
              ) : null}
              {items.map((it, i) => (
                <FoodItemEditor
                  key={`${it.name}-${i}`}
                  item={it}
                  onChange={(next) => setItems(items.map((x, j) => (j === i ? { ...x, ...next } : x)))}
                  onRemove={() => setItems(items.filter((_, j) => j !== i))}
                  extra={
                    <>
                      {'confidence' in it ? <Badge kind={CONF[it.confidence].kind} label={CONF[it.confidence].label} /> : null}
                      <Expandable title="Nutrition source & portion assumption" icon="document-text-outline">
                        <ItemSourceDetails item={it} />
                      </Expandable>
                    </>
                  }
                />
              ))}
              <Button title="Add an item" kind="secondary" icon="add" onPress={() => setAddOpen(true)} />
              <Text variant="smallStrong">Meal</Text>
              <Segmented label="Meal" value={meal} onChange={setMeal} options={MEALS} />
              {error ? <Text variant="small" color={C.danger}>{error}</Text> : null}
              <View style={{ gap: Space.sm, marginTop: Space.sm }}>
                <Button title={`Accept estimate & log ${Math.round(total.calories)} kcal`} kind="accept" size="lg" icon="checkmark" onPress={accept} disabled={!items.length} full />
                <Button title="Discard" kind="reject" onPress={discard} full={isPhone} />
              </View>
              <Muted variant="small">The meal is only added to your log after you accept.</Muted>
            </Stack>,
          ]}
        </Columns>
      )}

      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add an item">
        <FoodSearch
          onPick={(item) => {
            setItems([...items, item]);
            setAddOpen(false);
          }}
        />
      </Sheet>
    </Screen>
  );
}
