import React, { useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View, type ScrollView, type TextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/nav';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';

import { C, Radius, Space } from '@/constants/theme';
import { Badge, Banner, Button, Card, Columns, Field, LoadingState, Muted, NumberField, PageHeader, Row, Screen, Segmented, Stack, Text } from '@/components/ui';
import { FoodItemEditor, useFieldErrors } from '@/components/FoodItemEditor';
import { useStore } from '@/store/AppStore';
import { useAct, useToast } from '@/components/Toast';
import { estimateFood } from '@/lib/ai/provider';
import { draftFromItem, draftProblems, findSavedByBarcode, FOOD_LIMITS, itemFromSaved, savedFoodFromDraft, type ProductDraft } from '@/lib/nutrition/savedFoods';
import { BarcodeError, hasValidCheckDigit, normalizeBarcode, OFF_USER_AGENT } from '@/lib/nutrition/barcode';
import { resolveBarcode } from '@/lib/nutrition/barcodeResolve';
import { defaultMealForTime, manualEntry } from '@/lib/nutrition/estimate';
import { sumItems } from '@/lib/nutrition/lookup';
import { formatDateLabel, nowISO } from '@/lib/dates';
import { log } from '@/lib/log';
import { useLayout } from '@/hooks/useLayout';
import type { FoodItem, MealType, Nutrients, ServingBasis } from '@/lib/types';

const MEALS: { value: MealType; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' }, { value: 'lunch', label: 'Lunch' }, { value: 'dinner', label: 'Dinner' }, { value: 'snack', label: 'Snack' },
];

/** Retail product codes only; QR codes etc. are ignored. */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

/** A product waiting for the user to check it against their package. */
type Verify = { key: string; draft: ProductDraft; badge: string; title: string; note?: string };

const blankDraft = (barcode?: string, name = ''): ProductDraft => ({
  name, barcode, basis: { unit: 'serving', amount: 1, label: '' }, nutrients: { calories: null, proteinG: null, carbsG: null, fatG: null },
  source: { kind: 'user_entered', sourced: false, label: barcode ? `Entered by you (barcode ${barcode})` : 'Entered by you' },
});

const LABEL_HINT = 'This photo is a packaged-food Nutrition Facts label, not a meal. Return exactly one item: the product, with the serving size text exactly as printed (e.g. "Per 3/4 cup (175 g)") as the portion and the calories, protein, carbohydrate and fat for that one serving as printed. Do not estimate values that are not on the label.';

/** Browsers without camera access (or insecure origins) can still type the number. */
const webCameraAvailable = () => Platform.OS !== 'web' || (typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function');

export default function BarcodeScreen() {
  const { state, today } = useStore();
  const doAct = useAct();
  const toast = useToast();
  const { date: dateParam } = useLocalSearchParams<{ date?: string }>();
  const date = dateParam ?? today;

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraOn, setCameraOn] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string>();
  const [looking, setLooking] = useState<string>();
  const [error, setError] = useState<{ message: string; code?: string }>();
  const [verify, setVerify] = useState<Verify>();
  const [starting, setStarting] = useState(false);
  const [noCamera, setNoCamera] = useState(false);
  const [readingLabel, setReadingLabel] = useState(false);
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
    setVerify(undefined);
    // A product the user already confirmed wins over any database answer, and needs no network.
    const mine = findSavedByBarcode(state.savedFoods, clean);
    const mineItem = mine && itemFromSaved(mine);
    if (mineItem) {
      abortRef.current?.abort();
      setItems((cur) => [...cur, mineItem]);
      setCode('');
      toast(`Added ${mineItem.name} from your foods`);
      revealResult();
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLooking(clean);
    try {
      // Native only: browsers forbid setting User-Agent (and a custom header would trigger a CORS preflight).
      const r = await resolveBarcode(clean, { signal: ctrl.signal, userAgent: Platform.OS === 'web' ? undefined : OFF_USER_AGENT });
      if (ctrl.signal.aborted) return;
      if (r.status === 'found') {
        setVerify({ key: `found-${r.code}`, draft: draftFromItem(r.item, { brand: r.brand, packageSize: r.packageSize, barcode: r.code }), badge: 'Check before adding', title: 'Does this match your package?', note: 'Database entries can differ from Canadian packaging. Check the brand, flavour, package size and the serving size on your Nutrition Facts table, and fix anything that differs.' });
        setCode('');
      } else {
        setVerify({ key: `missing-${r.code}`, draft: blankDraft(r.code, r.status === 'incomplete' ? r.name ?? '' : ''), badge: r.status === 'incomplete' ? 'No nutrition data' : 'Not found', title: r.status === 'incomplete' ? `${r.name ?? 'This product'} has no calorie data yet` : `No product found for ${r.code}`, note: 'Copy the numbers from the Nutrition Facts table, or take a Nutrition Facts photo.' });
      }
    } catch (e) {
      if (ctrl.signal.aborted || (e as { name?: string })?.name === 'AbortError') return;
      if (!(e instanceof BarcodeError)) log.warn('barcode', 'Lookup failed', e);
      setError({ code: clean, message: e instanceof BarcodeError ? e.message : 'Lookup failed. Try again, or enter the food by hand.' });
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setLooking(undefined);
        // typed lookups too: on phones the result is below the fold
        revealResult();
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
    setStarting(true);
    try {
      await startCameraInner();
    } finally {
      setStarting(false);
    }
  };

  const startCameraInner = async () => {
    setNoCamera(false);
    if (Platform.OS === 'web') {
      try {
        // Device kinds are listed even before permission; none means there is no camera at all (not a block).
        const devices = await navigator.mediaDevices.enumerateDevices?.();
        if (devices && !devices.some((d) => d.kind === 'videoinput')) {
          setNoCamera(true);
          setTimeout(() => codeInput.current?.focus(), 50);
          return;
        }
      } catch (e) {
        log.warn('barcode', 'Could not list cameras', e);
      }
    }
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
    setVerify(undefined);
    setCameraOn(true);
  };

  /** Read a Nutrition Facts photo with the AI photo estimator; the user must check every value. */
  const readLabel = async () => {
    setReadingLabel(true);
    setError(undefined);
    const barcode = normalizeBarcode(code) ?? verify?.draft.barcode;
    try {
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsEditing: false };
      const useCamera = Platform.OS !== 'web' && (await ImagePicker.requestCameraPermissionsAsync()).granted;
      const res = useCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      const a = res.canceled ? undefined : res.assets?.[0];
      if (!a) return;
      const est = await estimateFood(state, { hint: LABEL_HINT, photoUri: a.uri, photoSize: { width: a.width, height: a.height } });
      const it = est.items[0];
      if (est.simulated || est.aiNotice || !it) {
        setVerify({ key: `label-${est.id}`, draft: blankDraft(barcode), badge: 'Label not read', title: 'Enter the Nutrition Facts by hand', note: est.aiNotice ?? 'Label reading needs server AI. Copy the numbers from the label instead.' });
      } else {
        // The AI's gram figure is a guess, so the basis comes only from the serving text it read.
        const read: FoodItem = { ...it, grams: undefined, source: { kind: 'label', sourced: true, label: 'Read from your Nutrition Facts photo (checked by you)' } };
        setVerify({ key: `label-${est.id}`, draft: draftFromItem(read, { barcode, name: verify?.draft.name || it.name }), badge: 'Read from photo', title: 'Check every value against the label', note: 'Photo reading can misread digits. Compare each number with your Nutrition Facts table before you confirm.' });
      }
      revealResult();
    } catch (e) {
      log.warn('barcode', 'Label photo failed', e);
      setError({ message: 'Could not read that photo. Enter the values by hand instead.' });
    } finally {
      setReadingLabel(false);
    }
  };

  const addFromDraft = (draft: ProductDraft, save: boolean) => {
    const now = nowISO();
    const saved = savedFoodFromDraft(draft, 'barcode', now);
    if (save && !doAct({ type: 'SAVE_FOOD', food: saved })) return;
    const item = itemFromSaved(saved);
    if (!item) return;
    setItems((cur) => [...cur, item]);
    setVerify(undefined);
    setCode('');
    toast(save ? `Saved and added ${item.name}` : `Added ${item.name}`);
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
  const showBlocked = (blocked || denied) && !noCamera;
  const cameraLabel = items.length ? 'Scan another item' : 'Start camera';

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
            {canUseCamera ? <Button title={starting ? 'Starting camera…' : cameraLabel} icon="scan-outline" size="lg" onPress={startCamera} loading={starting} disabled={!!looking} style={{ alignSelf: 'center' }} /> : null}
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
                ? `Your browser is blocking the camera for this site. Allow it in the site settings (the icon next to the address), then tap ${cameraLabel}. Or type the number below.`
                : 'Allow camera access for FitCoach in your device settings, or type the number below.'}
            </Banner>
          </View>
        ) : null}
        {noCamera ? (
          <View accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Banner kind="warning" title="No camera found">This device has no camera the browser can use. Type the number under the barcode below, or choose a Nutrition Facts photo.</Banner>
          </View>
        ) : null}
        <Button title="Nutrition Facts photo" kind="secondary" icon="document-text-outline" onPress={readLabel} loading={readingLabel} disabled={!!looking} />
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
        <Banner kind="danger" title={error.code ? 'Lookup failed' : 'Something went wrong'} action={error.code ? <Button title="Enter manually" kind="secondary" size="sm" onPress={() => { setVerify({ key: `manual-${error.code}`, draft: blankDraft(error.code), badge: 'Manual entry', title: `Enter ${error.code} by hand`, note: 'Copy the numbers from the Nutrition Facts table.' }); setError(undefined); }} /> : undefined}>
          {error.message}
        </Banner>
      ) : null}
      {verify ? <ProductForm key={verify.key} verify={verify} onConfirm={addFromDraft} onCancel={() => setVerify(undefined)} /> : null}

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
        <Muted variant="small">P {Math.round(total.proteinG)} g · C {Math.round(total.carbsG)} g · F {Math.round(total.fatG)} g{items.some((i) => i.missing?.length) ? ' (some macros not on the label)' : ''}</Muted>
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

const UNITS: { value: ServingBasis['unit']; label: string }[] = [{ value: 'g', label: 'Grams' }, { value: 'ml', label: 'mL' }, { value: 'serving', label: 'Per serving' }];

/** Check (and fix) product details against the package before it is added or saved. Nothing is filled in for the user. */
function ProductForm({ verify, onConfirm, onCancel }: { verify: Verify; onConfirm: (d: ProductDraft, save: boolean) => void; onCancel: () => void }) {
  const [d, setD] = useState(verify.draft);
  const errors = useFieldErrors();
  const set = (patch: Partial<ProductDraft>) => setD((cur) => ({ ...cur, ...patch }));
  const setBasis = (patch: Partial<ServingBasis>) => setD((cur) => ({ ...cur, basis: { ...cur.basis, ...patch } }));
  const problems = draftProblems(d);
  const blocked = problems.length > 0 || errors.hasError;
  const nutrient = (key: keyof Nutrients, label: string, suffix: string, max: number) => (
    <NumberField
      label={label}
      suffix={suffix}
      value={d.nutrients[key] ?? undefined}
      min={0}
      max={max}
      exclusiveMin={key === 'calories'}
      placeholder="—"
      onChange={(v, err) => {
        errors.track(key)(v, err);
        if (!err) setD((cur) => ({ ...cur, nutrients: { ...cur.nutrients, [key]: v ?? null } }));
      }}
      style={{ flex: 1 }}
    />
  );
  return (
    <Card tone="pending" style={{ gap: Space.sm }}>
      <Badge kind="pending" label={verify.badge} />
      <Text variant="bodyStrong">{verify.title}</Text>
      {verify.note ? <Muted variant="small">{verify.note}</Muted> : null}
      <Field label="Name" value={d.name} onChangeText={(name) => set({ name })} placeholder="e.g. Protein bar" />
      <Row gap={Space.sm} align="flex-start">
        <Field label="Brand" value={d.brand ?? ''} onChangeText={(brand) => set({ brand })} style={{ flex: 1 }} />
        <Field label="Flavour" value={d.flavour ?? ''} onChangeText={(flavour) => set({ flavour })} placeholder="e.g. Original" style={{ flex: 1 }} />
      </Row>
      <Field label="Package size" value={d.packageSize ?? ''} onChangeText={(packageSize) => set({ packageSize })} placeholder="e.g. 400 g, 6 x 355 mL" />
      <Text variant="smallStrong" color={C.textSecondary}>Values are per</Text>
      <Segmented label="Serving basis" value={d.basis.unit} onChange={(unit) => setBasis(unit === 'serving' ? { unit, amount: 1 } : { unit })} options={UNITS} />
      <Row gap={Space.sm} align="flex-start">
        {d.basis.unit !== 'serving' ? (
          <NumberField
            label="Serving amount"
            suffix={d.basis.unit === 'ml' ? 'mL' : 'g'}
            value={d.basis.amount}
            min={0}
            max={FOOD_LIMITS.amount}
            exclusiveMin
            onChange={(v, err) => {
              errors.track('amount')(v, err);
              if (!err) setBasis({ amount: v ?? 0 });
            }}
            style={{ flex: 1 }}
          />
        ) : null}
        <Field label="Serving as printed" value={d.basis.label} onChangeText={(label) => setBasis({ label })} placeholder="e.g. 3/4 cup (175 g)" style={{ flex: 2 }} />
      </Row>
      <Row gap={Space.sm} align="flex-start">
        {nutrient('calories', 'Calories', 'kcal', FOOD_LIMITS.kcal)}
        {nutrient('proteinG', 'Protein', 'g', FOOD_LIMITS.macroG)}
      </Row>
      <Row gap={Space.sm} align="flex-start">
        {nutrient('carbsG', 'Carbs', 'g', FOOD_LIMITS.macroG)}
        {nutrient('fatG', 'Fat', 'g', FOOD_LIMITS.macroG)}
      </Row>
      <Muted variant="small">Leave a value empty if the label doesn&apos;t list it; it shows as &quot;—&quot;, never 0.</Muted>
      {problems.length ? <Muted variant="small">{problems[0]}</Muted> : null}
      <Row wrap gap={Space.sm}>
        <Button title="Matches my package: save & add" icon="checkmark" onPress={() => onConfirm(d, true)} disabled={blocked} />
        <Button title="Add once" kind="secondary" onPress={() => onConfirm(d, false)} disabled={blocked} />
        <Button title="Search foods instead" kind="ghost" onPress={() => router.replace('/food/manual')} />
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
