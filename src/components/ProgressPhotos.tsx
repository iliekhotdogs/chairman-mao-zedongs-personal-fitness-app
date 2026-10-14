import React, { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, View, type ImageStyle, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C, Radius, Space } from '@/constants/theme';
import { Badge, Button, Card, Chip, EmptyState, Field, IconButton, Ionicons, Muted, NumberField, Row, SectionTitle, Sheet, Stack, Text } from './ui';
import { useStore } from '@/store/AppStore';
import { useAct } from './Toast';
import { useLayout } from '@/hooks/useLayout';
import { signedPhotoUrl } from '@/lib/sync/sync';
import { discardLocalPhoto, persistPhoto } from '@/lib/photo';
import { compareSummary, galleryOrder, photoDateError } from '@/lib/progressPhotos';
import { latestWeight } from '@/lib/selectors';
import { formatDateLabel, nowISO, parseISODate } from '@/lib/dates';
import { displayWeight, toKg, weightUnit, weightValue } from '@/lib/units';
import { newId } from '@/lib/id';
import { log } from '@/lib/log';
import type { ProgressPhoto } from '@/lib/types';

const longDate = (d: string) => parseISODate(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** A progress photo, resolving private cloud photos (`storage:`) to a short-lived signed URL. */
export function PhotoImage({ uri, style, contain }: { uri: string; style?: StyleProp<ImageStyle>; contain?: boolean }) {
  const [signed, setSigned] = useState<{ uri: string; url?: string }>();
  useEffect(() => {
    if (!uri.startsWith('storage:')) return;
    let alive = true;
    signedPhotoUrl(uri)
      .then((url) => alive && setSigned({ uri, url }))
      .catch((e) => log.warn('photos', 'Could not load a cloud photo.', e));
    return () => {
      alive = false;
    };
  }, [uri]);
  const src = uri.startsWith('storage:') ? (signed?.uri === uri ? signed.url : undefined) : uri;
  if (!src) {
    return (
      <View style={[{ alignItems: 'center', justifyContent: 'center', backgroundColor: C.surfaceAlt }, style as object]}>
        <Ionicons name="image-outline" size={28} color={C.textMuted} />
      </View>
    );
  }
  return <Image source={{ uri: src }} resizeMode={contain ? 'contain' : 'cover'} style={[{ backgroundColor: C.surfaceAlt }, style]} accessibilityIgnoresInvertColors />;
}

export function ProgressPhotosSection() {
  const { state } = useStore();
  const photos = useMemo(() => galleryOrder(state.progressPhotos), [state.progressPhotos]);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  return (
    <Stack gap={Space.lg}>
      <SectionTitle right={<Button title="Add progress photo" icon="camera" size="sm" onPress={() => setAdding(true)} />}>Progress photos</SectionTitle>
      {photos.length === 0 ? (
        <EmptyState
          icon="body-outline"
          title="See the change, not just the scale"
          body="Take a photo every couple of weeks in the same spot and light. Photos stay private to your account."
          action={<Button title="Add progress photo" icon="camera" onPress={() => setAdding(true)} />}
        />
      ) : (
        <>
          <Gallery photos={photos} onOpen={setViewing} />
          {photos.length >= 2 ? <Compare photos={photos} /> : <Muted variant="small">Add a second photo to compare side by side.</Muted>}
        </>
      )}
      <AddPhotoSheet visible={adding} onClose={() => setAdding(false)} />
      <FullView photos={photos} index={viewing} onIndex={setViewing} />
    </Stack>
  );
}

function Gallery({ photos, onOpen }: { photos: ProgressPhoto[]; onOpen: (i: number) => void }) {
  const { state } = useStore();
  const { isPhone } = useLayout();
  const units = state.settings.units;
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(photos.length - 1);
  const ref = React.useRef<ScrollView>(null);
  const gap = Space.md;
  // phones show one slide plus a peek of the next; wider screens show several
  const slideW = width ? (isPhone ? Math.round(width * 0.82) : Math.min(320, Math.round(width / 3.2))) : 0;
  const step = slideW + gap;
  const current = Math.min(index, photos.length - 1);

  // The newest photo sits at the end; open there.
  const maxX = Math.max(0, photos.length * step - gap - width);
  const didInit = React.useRef(false);
  useEffect(() => {
    if (!slideW || didInit.current) return;
    didInit.current = true;
    ref.current?.scrollTo({ x: maxX, animated: false });
  }, [slideW, maxX]);

  // Counter follows the slide snapped to the left edge; at the very end it is the newest photo.
  const indexAt = (x: number) => (x >= maxX - 2 ? photos.length - 1 : Math.max(0, Math.min(photos.length - 1, Math.round(x / step))));
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (step) setIndex(indexAt(e.nativeEvent.contentOffset.x));
  };

  const go = (d: number) => {
    const i = Math.max(0, Math.min(photos.length - 1, current + d));
    ref.current?.scrollTo({ x: Math.min(maxX, i * step), animated: true });
    setIndex(i);
  };

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ gap: Space.md }}>
      <Row align="flex-end">
        <Stack gap={0} style={{ flex: 1 }}>
          <Text variant="eyebrow" color={C.textSecondary}>{photos[current] ? longDate(photos[current].date) : ''}</Text>
          <Muted variant="small">Swipe through your timeline. Tap a photo to open it.</Muted>
        </Stack>
        <Row gap={2} align="flex-end" accessibilityLabel={`Photo ${current + 1} of ${photos.length}`}>
          <Text variant="numberSm" color={C.accent}>{current + 1}</Text>
          <Text variant="h2" color={C.textSecondary}>/{photos.length}</Text>
        </Row>
        {!isPhone ? (
          <Row gap={4}>
            <IconButton icon="chevron-back" label="Previous photo" onPress={() => go(-1)} style={{ backgroundColor: C.surfaceAlt }} />
            <IconButton icon="chevron-forward" label="Next photo" onPress={() => go(1)} style={{ backgroundColor: C.surfaceAlt }} />
          </Row>
        ) : null}
      </Row>
      {slideW ? (
        <ScrollView
          ref={ref}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={step}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          onScroll={onScroll}
          scrollEventThrottle={32}
          contentContainerStyle={{ gap }}>
          {photos.map((p, i) => (
            <Pressable key={p.id} onPress={() => onOpen(i)} accessibilityRole="imagebutton" accessibilityLabel={`Progress photo from ${longDate(p.date)}${p.weightKg ? `, ${displayWeight(p.weightKg, units)}` : ''}. Open full view`} style={({ pressed }) => [styles.slide, { width: slideW, opacity: pressed ? 0.9 : 1, borderColor: i === current ? C.primaryBorder : C.border }]}>
              <PhotoImage uri={p.uri} style={{ width: '100%', height: '100%' }} />
              <View style={styles.slideFooter}>
                <Text variant="h2">{formatDateLabel(p.date)}</Text>
                <Row gap={6}>
                  {p.weightKg ? <Text variant="smallStrong" color={C.accent}>{displayWeight(p.weightKg, units)}</Text> : null}
                  {p.note ? <Muted variant="small" numberOfLines={1} style={{ flex: 1 }}>{p.note}</Muted> : null}
                </Row>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <View style={{ height: 320 }} />
      )}
    </View>
  );
}

function Compare({ photos }: { photos: ProgressPhoto[] }) {
  const { state } = useStore();
  const units = state.settings.units;
  const [beforeId, setBeforeId] = useState<string>();
  const [afterId, setAfterId] = useState<string>();
  const before = photos.find((p) => p.id === beforeId) ?? photos[0];
  const after = photos.find((p) => p.id === afterId) ?? photos[photos.length - 1];
  const s = compareSummary(before, after);
  const delta = s.weightDeltaKg;

  const side = (label: string, p: ProgressPhoto, selectedId: string, onPick: (id: string) => void) => (
    <Stack gap={Space.sm} style={{ flex: 1, minWidth: 0 }}>
      <Text variant="eyebrow" color={label === 'After' ? C.accent : C.textSecondary}>{label}</Text>
      <PhotoImage uri={p.uri} style={styles.compareImg} />
      <Text variant="h2">{longDate(p.date)}</Text>
      {p.weightKg ? <Muted variant="small">{displayWeight(p.weightKg, units)}</Muted> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {photos.map((x) => (
          <Chip key={x.id} label={parseISODate(x.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} selected={x.id === selectedId} onPress={() => onPick(x.id)} />
        ))}
      </ScrollView>
    </Stack>
  );

  return (
    <Card style={{ gap: Space.md }}>
      <Row wrap gap={Space.md} align="flex-end">
        <Text variant="h2" style={{ flex: 1 }}>Compare</Text>
        <Row gap={Space.lg}>
          <Stack gap={0}>
            <Text variant="eyebrow" color={C.textSecondary}>Days apart</Text>
            <Text variant="numberSm">{Math.abs(s.days)}</Text>
          </Stack>
          {delta !== undefined ? (
            <Stack gap={0}>
              <Text variant="eyebrow" color={C.textSecondary}>Weight</Text>
              <Text variant="numberSm" color={C.accent}>
                {delta >= 0 ? '+' : '−'}
                {weightValue(Math.abs(delta), units)}
                <Text variant="small" color={C.textSecondary}> {weightUnit(units)}</Text>
              </Text>
            </Stack>
          ) : null}
        </Row>
      </Row>
      <Row align="flex-start" gap={Space.md} style={{ width: '100%', maxWidth: 760, alignSelf: 'center' }}>
        {side('Before', before, before.id, setBeforeId)}
        {side('After', after, after.id, setAfterId)}
      </Row>
    </Card>
  );
}

function FullView({ photos, index, onIndex }: { photos: ProgressPhoto[]; index: number | null; onIndex: (i: number | null) => void }) {
  const { state } = useStore();
  const doAct = useAct();
  const insets = useSafeAreaInsets();
  const [confirm, setConfirm] = useState(false);
  const units = state.settings.units;
  const p = index !== null ? photos[index] : undefined;
  const close = () => {
    setConfirm(false);
    onIndex(null);
  };
  return (
    <Modal visible={!!p} transparent animationType="fade" onRequestClose={close}>
      <View style={[styles.full, { paddingTop: Math.max(insets.top, Space.md), paddingBottom: Math.max(insets.bottom, Space.md) }]}>
        {p ? (
          <>
            <Row style={{ paddingHorizontal: Space.lg }}>
              <Stack gap={0} style={{ flex: 1 }}>
                <Text variant="h2">{longDate(p.date)}</Text>
                <Muted variant="small">
                  {index! + 1}/{photos.length}
                  {p.weightKg ? ` · ${displayWeight(p.weightKg, units)}` : ''}
                </Muted>
              </Stack>
              <IconButton icon="trash-outline" label="Delete photo" color={C.danger} onPress={() => setConfirm(true)} />
              <IconButton icon="close" label="Close" onPress={close} />
            </Row>
            <View style={{ flex: 1, marginVertical: Space.md }}>
              <PhotoImage uri={p.uri} contain style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }} />
              {index! > 0 ? <IconButton icon="chevron-back" label="Previous photo" onPress={() => onIndex(index! - 1)} style={[styles.navBtn, { left: Space.md }]} size={26} /> : null}
              {index! < photos.length - 1 ? <IconButton icon="chevron-forward" label="Next photo" onPress={() => onIndex(index! + 1)} style={[styles.navBtn, { right: Space.md }]} size={26} /> : null}
            </View>
            {p.note ? <Text style={{ paddingHorizontal: Space.lg }}>{p.note}</Text> : null}
            {confirm ? (
              <Card tone="danger" style={{ marginHorizontal: Space.lg, marginTop: Space.sm }}>
                <Text variant="bodyStrong">Delete this photo?</Text>
                <Muted variant="small">It is removed from all your devices.</Muted>
                <Row gap={Space.sm}>
                  <Button title="Cancel" kind="secondary" onPress={() => setConfirm(false)} style={{ flex: 1 }} />
                  <Button
                    title="Delete"
                    kind="danger"
                    icon="trash-outline"
                    style={{ flex: 1 }}
                    onPress={() => {
                      if (doAct({ type: 'DELETE_PROGRESS_PHOTO', id: p.id, now: nowISO() }, 'Photo deleted')) discardLocalPhoto(p.uri);
                      close();
                    }}
                  />
                </Row>
              </Card>
            ) : null}
          </>
        ) : null}
      </View>
    </Modal>
  );
}

function AddPhotoSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { state, today } = useStore();
  const doAct = useAct();
  const units = state.settings.units;
  const latest = latestWeight(state);
  const [picked, setPicked] = useState<string>();
  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState<number | undefined>(latest ? weightValue(latest.weightKg, units) : undefined);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const dateError = photoDateError(date, today);

  const reset = () => {
    setPicked(undefined);
    setDate(today);
    setNote('');
    setError(undefined);
    setWeight(latest ? weightValue(latest.weightKg, units) : undefined);
  };
  const close = () => {
    reset();
    onClose();
  };

  const pick = async (source: 'camera' | 'library') => {
    setError(undefined);
    try {
      if (source === 'camera' && Platform.OS !== 'web') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setError('Camera access is off. Allow it in your device settings, or choose a photo from your library.');
          return;
        }
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsEditing: false };
      const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]) return;
      setPicked(res.assets[0].uri);
    } catch (e) {
      log.warn('photos', 'Image picker failed', e);
      setError('Could not open the camera or photo library on this device.');
    }
  };

  const save = async () => {
    if (!picked || dateError) return;
    setSaving(true);
    try {
      const id = newId();
      const uri = await persistPhoto(picked, id, { folder: 'progress-photos', webMaxSize: 540 });
      if (!uri) {
        setError('This photo could not be saved. Try a different one.');
        return;
      }
      const now = nowISO();
      const photo: ProgressPhoto = { id, date, uri, createdAt: now, updatedAt: now, ...(weight ? { weightKg: toKg(weight, units) } : {}), ...(note.trim() ? { note: note.trim() } : {}) };
      if (doAct({ type: 'ADD_PROGRESS_PHOTO', photo }, 'Progress photo saved')) close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title="Add progress photo"
      footer={<Button title="Save photo" icon="checkmark" size="lg" full onPress={save} loading={saving} disabled={!picked || !!dateError} />}>
      {picked ? (
        <View style={{ alignItems: 'center', gap: Space.sm }}>
          <Image source={{ uri: picked }} style={styles.preview} resizeMode="cover" accessibilityLabel="Selected photo" />
          <Button title="Choose a different photo" kind="ghost" size="sm" onPress={() => setPicked(undefined)} />
        </View>
      ) : (
        <Row gap={Space.sm}>
          <Button title="Take photo" icon="camera" onPress={() => pick('camera')} style={{ flex: 1 }} />
          <Button title="From library" kind="secondary" icon="images-outline" onPress={() => pick('library')} style={{ flex: 1 }} />
        </Row>
      )}
      {error ? <Text variant="small" color={C.danger}>{error}</Text> : null}
      <Row gap={Space.sm} align="flex-start">
        <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" error={dateError} style={{ flex: 1 }} autoCapitalize="none" />
        <NumberField label={`Weight (${weightUnit(units)})`} value={weight} onChange={setWeight} style={{ flex: 1 }} hint="Optional" />
      </Row>
      <Field label="Note" value={note} onChangeText={setNote} placeholder="Optional, e.g. morning, after week 4" maxLength={280} />
      <Row gap={6}>
        <Badge kind="neutral" label="Private to your account" icon="lock-closed-outline" />
      </Row>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  slide: { aspectRatio: 3 / 4, borderRadius: Radius.xl, overflow: 'hidden', borderWidth: 1, backgroundColor: C.surface },
  slideFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Space.md, gap: 2, backgroundColor: C.glass },
  compareImg: { width: '100%', aspectRatio: 3 / 4, borderRadius: Radius.lg },
  full: { flex: 1, backgroundColor: C.bgDeep },
  navBtn: { position: 'absolute', top: '50%', marginTop: -22, backgroundColor: C.overlay },
  preview: { width: 180, aspectRatio: 3 / 4, borderRadius: Radius.lg, backgroundColor: C.surfaceAlt },
});
