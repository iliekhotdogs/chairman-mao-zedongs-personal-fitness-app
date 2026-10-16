import React, { useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View, type ScrollView, type TextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/nav';
import * as Haptics from 'expo-haptics';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';

import { C, Radius, Space } from '@/constants/theme';
import { Badge, Banner, Button, Card, Columns, Field, LoadingState, Muted, NumberField, PageHeader, Row, Screen, Segmented, Stack, Text } from '@/components/ui';
import { FoodItemEditor } from '@/components/FoodItemEditor';
import { useStore } from '@/store/AppStore';
import { useAct } from '@/components/Toast';
import { BarcodeError, hasValidCheckDigit, normalizeBarcode, OFF_USER_AGENT } from '@/lib/nutrition/barcode';
import { resolveBarcode } from '@/lib/nutrition/barcodeResolve';
import { defaultMealForTime, manualEntry } from '@/lib/nutrition/estimate';
import { sumItems } from '@/lib/nutrition/lookup';
import { formatDateLabel } from '@/lib/dates';
import { log } from '@/lib/log';
import { useLayout } from '@/hooks/useLayout';
import type { FoodItem, MealType } from '@/lib/types';

const MEALS: { value: MealType; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' }, { value: 'lunch', label: 'Lunch' }, { value: 'dinner', label: 'Dinner' }, { value: 'snack', label: 'Snack' },
];

/** Retail product codes only; QR codes etc. are ignored. */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

type Missing = { code: string; name?: string; reason: 'not_found' | 'incomplete' };

/** Browsers without camera access (or insecure origins) can still type the number. */
const webCameraAvailable = () => Platform.OS !== 'web' || (typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function');

export default function BarcodeScreen() {
  const { today } = useStore();
  const doAct = useAct();
  const { date: dateParam } = useLocalSearchParams<{ date?: string }>();
  const date = dateParam ?? today;

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraOn, setCameraOn] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string>();
  const [looking, setLooking] = useState<string>();
  const [error, setError] = useState<{ message: string; code?: string }>();
  const [missing, setMissing] = useState<Missing>();
  const [items, setItems] = useState<FoodItem[]>([]);
  const [meal, setMeal] = useState<MealType>(defaultMealForTime());
  const [blocked, setBlocked] = useState(false);
  const [torch, setTorch] = useState(false);
  const handled = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const codeInput = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const reviewRef = useRef<View>(null);
  const { isPhone } = useLayout();
  const total = sumItems(items);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null; // lets a stale lookup's finally skip its state updates
    },
    [],
  );

  /** On phones the result column sits below the scanner: bring it into view after a scan. */
  const revealResult = () => {
    if (!isPhone) return;
    requestAnimationFrame(() => {
      const target = reviewRef.current;
      if (!target) return;
      if (Platform.OS === 'web') {
        (target as unknown as { scrollIntoView?: (o: ScrollIntoViewOptions) => void }).scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        return;
      }
      const scroll = scrollRef.current;
      const inner = scroll?.getNativeScrollRef();
      if (!scroll || !inner) return;
      target.measureLayout(inner, (_x, y) => scroll.scrollTo({ y: Math.max(0, y - Space.md), animated: true }), () => {});
    });
  };

  const lookup = async (raw: string, fromScan: boolean) => {
    const clean = normalizeBarcode(raw);
    if (!clean) {
      setCodeError('Barcodes are 8, 12, 13 or 14 digits.');
      return;
    }
    if (!fromScan && !hasValidCheckDigit(clean)) {
      setCodeError("That number doesn't add up. Check the digits under the barcode.");
      return;
    }
    setCodeError(undefined);
    setError(undefined);
    setMissing(undefined);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLooking(clean);
    try {
      // Native only: browsers forbid setting User-Agent (and a custom header would trigger a CORS preflight).
      const r = await resolveBarcode(clean, { signal: ctrl.signal, userAgent: Platform.OS === 'web' ? undefined : OFF_USER_AGENT });
      if (ctrl.signal.aborted) return;
      if (r.status === 'found') {
        setItems((cur) => [...cur, r.item]);
        setCode('');
      } else {
        setMissing({ code: r.code, name: r.status === 'incomplete' ? r.name : undefined, reason: r.status });
      }
    } catch (e) {
      if (ctrl.signal.aborted || (e as { name?: string })?.name === 'AbortError') return;
      if (!(e instanceof BarcodeError)) log.warn('barcode', 'Lookup failed', e);
      setError({ code: clean, message: e instanceof BarcodeError ? e.message : 'Lookup failed. Try again, or enter the food by hand.' });
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setLooking(undefined);
        if (fromScan) revealResult();
      }
    }
  };

  const onScanned = (r: BarcodeScanningResult) => {
    if (handled.current) return;
    // Misread (bad check digit): ignore silently and keep scanning.
    const clean = normalizeBarcode(r.data);
    if (!clean || !hasValidCheckDigit(clean)) return;
    handled.current = true;
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch((e) => log.warn('barcode', 'Haptics failed', e));
    setCameraOn(false);
    setTorch(false);
    setCode(r.data);
    revealResult();
    void lookup(r.data, true);
  };

  const startCamera = async () => {
    let granted = Boolean(permission?.granted);
    if (!granted) {
      try {
        granted = (await requestPermission()).granted;
      } catch (e) {
        log.warn('barcode', 'Camera permission request failed', e);
      }
    }
    if (!granted) {
      // Blocked (browser site setting or a denied prompt): say so and move to the number field.
      setBlocked(true);
      setCameraOn(false);
      setTimeout(() => codeInput.current?.focus(), 50);
      return;
    }
    setBlocked(false);
    handled.current = false;
    setError(undefined);
    setMissing(undefined);
    setCameraOn(true);
  };

  const save = () => {
    try {
      const entry = manualEntry({ items, meal, date });
      if (doAct({ type: 'LOG_FOOD', entry }, `Logged ${Math.round(total.calories)} kcal`)) router.replace('/food');
    } catch {
      /* the button is disabled without items */
    }
  };

  const canUseCamera = webCameraAvailable();
  const denied = Boolean(permission && !permission.granted && !permission.canAskAgain);
  const showBlocked = blocked || denied;

  const scanner = (
    <Stack key="scan" gap={Space.md}>
      <Card style={{ gap: Space.md }}>
        <Row>
          <Text variant="h3" style={{ flex: 1 }}>Scan</Text>
          <Badge kind="info" label="Open Food Facts" icon="globe-outline" />
        </Row>
        {cameraOn ? (
          <View style={styles.viewport}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
              onBarcodeScanned={onScanned}
              onMountError={(e) => {
                log.warn('barcode', 'Camera failed to start', e);
                setCameraOn(false);
                setError({ message: 'The camera could not start. Type the number under the barcode instead.' });
              }}
            />
            <View style={[styles.frameWrap, { pointerEvents: 'none' }]}>
              <View style={styles.frame} />
              <Text variant="caption" color={C.text} style={styles.frameHint}>Line up the barcode inside the frame</Text>
            </View>
          </View>
        ) : (
          <View style={[styles.viewport, styles.idle]}>
            <Text variant="display" color={C.accent} accessibilityElementsHidden importantForAccessibility="no">|||| ||| ||</Text>
            <Muted variant="small" style={{ textAlign: 'center', maxWidth: 260 }}>
              {canUseCamera ? 'Point your camera at the barcode on the package.' : 'Camera scanning is not available in this browser. Type the number under the barcode below.'}
            </Muted>
            {canUseCamera ? <Button title={items.length ? 'Scan another item' : 'Start camera'} icon="scan-outline" size="lg" onPress={startCamera} disabled={!!looking} style={{ alignSelf: 'center' }} /> : null}
          </View>
        )}
        {cameraOn ? <Muted variant="small">Hold steady about 15 cm away and keep the whole barcode in the frame.</Muted> : null}
        {cameraOn ? (
          <Row gap={Space.sm}>
            {Platform.OS !== 'web' ? <Button title={torch ? 'Torch off' : 'Torch on'} kind="secondary" icon={torch ? 'flashlight' : 'flashlight-outline'} onPress={() => setTorch(!torch)} style={{ flex: 1 }} /> : null}
            <Button title="Stop camera" kind="secondary" icon="close" onPress={() => { setCameraOn(false); setTorch(false); }} style={{ flex: 1 }} />
          </Row>
        ) : null}
        {showBlocked ? (
          <View accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Banner kind="warning" title="Camera access is blocked"
              action={Platform.OS !== 'web' ? <Button title="Open settings" kind="secondary" size="sm" onPress={() => void Linking.openSettings()} /> : undefined}>
              {Platform.OS === 'web'
                ? 'Your browser is blocking the camera for this site. Allow it in the site settings (the icon next to the address), then tap Start camera again. Or type the number below.'
                : 'Allow camera access for FitCoach in your device settings, or type the number below.'}
            </Banner>
          </View>
        ) : null}
      </Card>

      <Card style={{ gap: Space.sm }}>
        <Text variant="h3">Type the number</Text>
        <Field
          ref={codeInput}
          value={code}
          onChangeText={(t) => {
            setCode(t.replace(/[^\d\s-]/g, ''));
            setCodeError(undefined);
          }}
          placeholder="e.g. 3017620422003"
          keyboardType="number-pad"
          inputMode="numeric"
          returnKeyType="search"
          onSubmitEditing={() => lookup(code, false)}
          accessibilityLabel="Barcode number"
          error={codeError}
          hint="The digits printed under the bars."
        />
        <Button title="Look up" kind="secondary" icon="search" onPress={() => lookup(code, false)} disabled={!code.trim() || !!looking} loading={!!looking} />
      </Card>
    </Stack>
  );

  const review = (
    <Stack key="review" gap={Space.md} ref={reviewRef}>
      {looking ? <LoadingState label={`Looking up ${looking}…`} lines={2} /> : null}
      {error ? (
        <Banner kind="danger" title={error.code ? 'Lookup failed' : 'Camera problem'} action={error.code ? <Button title="Enter manually" kind="secondary" size="sm" onPress={() => { setMissing({ code: error.code!, reason: 'not_found' }); setError(undefined); }} /> : undefined}>
          {error.message}
        </Banner>
      ) : null}
      {missing ? <MissingProduct key={missing.code} missing={missing} onAdd={(it) => { setItems([...items, it]); setMissing(undefined); setCode(''); }} onCancel={() => setMissing(undefined)} /> : null}

      <Text variant="h3">This meal</Text>
      <Segmented label="Meal" value={meal} onChange={setMeal} options={MEALS} />
      {items.length === 0 ? (
        <Card tone="muted">
          <Muted>Scanned products appear here. Check the serving size before you log it.</Muted>
        </Card>
      ) : (
        items.map((it, i) => (
          <FoodItemEditor key={`${it.name}-${i}`} item={it} onChange={(next) => setItems(items.map((x, j) => (j === i ? next : x)))} onRemove={() => setItems(items.filter((_, j) => j !== i))} />
        ))
      )}
      <Card>
        <Row>
          <Text variant="bodyStrong" style={{ flex: 1 }}>Total</Text>
          <Text variant="bodyStrong">{Math.round(total.calories)} kcal</Text>
        </Row>
        <Muted variant="small">P {Math.round(total.proteinG)} g · C {Math.round(total.carbsG)} g · F {Math.round(total.fatG)} g</Muted>
      </Card>
      {!items.length ? <Muted variant="small">Scan or look up a product first to enable Log meal.</Muted> : null}
      <Button title="Log meal" icon="checkmark" size="lg" onPress={save} disabled={!items.length} full />
      <Muted variant="small">Nothing is saved until you tap Log meal. Product data comes from Open Food Facts, a free community database, so double-check it against the label.</Muted>
    </Stack>
  );

  return (
    <Screen size="medium" scrollRef={scrollRef}>
      <PageHeader eyebrow="Food" title="Scan barcode" subtitle={formatDateLabel(date, today)} right={<Button title="Cancel" kind="ghost" onPress={() => goBack('/food')} />} />
      <Columns ratio={[1, 1]}>{[scanner, review]}</Columns>
    </Screen>
  );
}

/** Product not in Open Food Facts (or without calories): enter it by hand, prefilled with what we know. */
function MissingProduct({ missing, onAdd, onCancel }: { missing: Missing; onAdd: (item: FoodItem) => void; onCancel: () => void }) {
  const [item, setItem] = useState<FoodItem>({
    name: missing.name ?? '',
    portionLabel: '1 serving',
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    source: { kind: 'user_entered', sourced: false, label: `Entered by you (barcode ${missing.code})` },
  });
  return (
    <Card tone="pending" style={{ gap: Space.sm }}>
      <Badge kind="pending" label={missing.reason === 'incomplete' ? 'No nutrition data' : 'Not found'} />
      <Text variant="bodyStrong">{missing.reason === 'incomplete' ? `${missing.name ?? 'This product'} has no calorie data yet` : `No product found for ${missing.code}`}</Text>
      <Muted variant="small">Copy the numbers from the nutrition label for one serving.</Muted>
      <Field label="Name" value={item.name} onChangeText={(name) => setItem({ ...item, name })} placeholder="e.g. Protein bar" />
      <Field label="Portion" value={item.portionLabel} onChangeText={(portionLabel) => setItem({ ...item, portionLabel })} />
      <Row gap={Space.sm}>
        <NumberField label="Calories" suffix="kcal" value={item.calories || undefined} onChange={(v) => setItem({ ...item, calories: Math.round(v ?? 0) })} style={{ flex: 1 }} />
        <NumberField label="Protein" suffix="g" value={item.proteinG || undefined} onChange={(v) => setItem({ ...item, proteinG: v ?? 0 })} style={{ flex: 1 }} />
      </Row>
      <Row gap={Space.sm}>
        <NumberField label="Carbs" suffix="g" value={item.carbsG || undefined} onChange={(v) => setItem({ ...item, carbsG: v ?? 0 })} style={{ flex: 1 }} />
        <NumberField label="Fat" suffix="g" value={item.fatG || undefined} onChange={(v) => setItem({ ...item, fatG: v ?? 0 })} style={{ flex: 1 }} />
      </Row>
      <Row wrap gap={Space.sm}>
        <Button title="Add item" icon="add" onPress={() => onAdd({ ...item, name: item.name.trim() })} disabled={!item.name.trim() || item.calories <= 0} />
        <Button title="Search foods instead" kind="secondary" onPress={() => router.replace('/food/manual')} />
        <Button title="Dismiss" kind="ghost" onPress={onCancel} />
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  viewport: { width: '100%', aspectRatio: 4 / 3, borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: C.bgDeep, borderWidth: 1, borderColor: C.border },
  idle: { alignItems: 'center', justifyContent: 'center', gap: Space.md, padding: Space.lg },
  frameWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: Space.sm },
  frame: { width: '74%', height: '38%', borderWidth: 2, borderColor: C.accent, borderRadius: Radius.md },
  frameHint: { backgroundColor: C.overlay, paddingHorizontal: Space.sm, paddingVertical: 2, borderRadius: Radius.sm, overflow: 'hidden' },
});
