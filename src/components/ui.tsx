import React from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewProps, type ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C, Font, MaxContentWidth, Radius, Space, Type } from '@/constants/theme';
import { useLayout } from '@/hooks/useLayout';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export { Ionicons };

// ---------- Text ----------

type Variant = keyof typeof Type;

export function Text({ variant = 'body', color, style, ...rest }: TextProps & { variant?: Variant; color?: string }) {
  return <RNText {...rest} style={[{ color: color ?? C.text, fontFamily: Font.family }, Type[variant], style]} />;
}

export const Muted = (p: TextProps & { variant?: Variant }) => <Text color={C.textSecondary} {...p} />;

// ---------- Layout ----------

export function Screen({ children, scroll = true, maxWidth = MaxContentWidth, padded = true, contentStyle }: { children: React.ReactNode; scroll?: boolean; maxWidth?: number; padded?: boolean; contentStyle?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  const { isPhone } = useLayout();
  const inner = (
    <View style={[{ width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: padded ? (isPhone ? Space.lg : Space.xxl) : 0, paddingTop: isPhone ? Math.max(insets.top, Space.md) + Space.sm : Space.xxl, paddingBottom: Space.xxxl * 2, gap: Space.lg }, contentStyle]}>
      {children}
    </View>
  );
  if (!scroll) return <View style={{ flex: 1, backgroundColor: C.bg }}>{inner}</View>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
      {inner}
    </ScrollView>
  );
}

export function Row({ style, gap = Space.sm, align = 'center', wrap, ...rest }: ViewProps & { gap?: number; align?: ViewStyle['alignItems']; wrap?: boolean }) {
  return <View {...rest} style={[{ flexDirection: 'row', alignItems: align, gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]} />;
}

export function Stack({ style, gap = Space.sm, ...rest }: ViewProps & { gap?: number }) {
  return <View {...rest} style={[{ gap }, style]} />;
}

export const Spacer = () => <View style={{ flex: 1 }} />;

/** Responsive columns: stacks on phones, side by side on wider screens. */
export function Columns({ children, ratio = [1, 1], gap = Space.lg }: { children: React.ReactNode[]; ratio?: number[]; gap?: number }) {
  const { isPhone } = useLayout();
  if (isPhone) return <Stack gap={gap}>{children}</Stack>;
  return (
    <Row align="flex-start" gap={gap}>
      {children.map((c, i) => (
        <View key={i} style={{ flex: ratio[i] ?? 1, minWidth: 0, gap }}>
          {c}
        </View>
      ))}
    </Row>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <Row align="flex-start" style={{ marginBottom: Space.xs }}>
      <Stack gap={2} style={{ flex: 1 }}>
        <Text variant="h1" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
      </Stack>
      {right}
    </Row>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Row style={{ marginTop: Space.sm }}>
      <Text variant="h3" style={{ flex: 1 }} accessibilityRole="header">
        {children}
      </Text>
      {right}
    </Row>
  );
}

// ---------- Surfaces ----------

export function Card({ style, tone = 'default', dashed, children, ...rest }: ViewProps & { tone?: 'default' | 'suggestion' | 'pending' | 'saved' | 'simulated' | 'danger' | 'info' | 'muted'; dashed?: boolean }) {
  const tones = {
    default: { bg: C.surface, border: C.border },
    suggestion: { bg: C.suggestionSoft, border: '#D9CCFB' },
    pending: { bg: C.warningSoft, border: '#F7D9A8' },
    saved: { bg: C.successSoft, border: '#B7E4CB' },
    simulated: { bg: C.simulatedSoft, border: C.borderStrong },
    danger: { bg: C.dangerSoft, border: '#F9C9C4' },
    info: { bg: C.infoSoft, border: '#C7DBFB' },
    muted: { bg: C.surfaceAlt, border: C.border },
  }[tone];
  return (
    <View {...rest} style={[styles.card, { backgroundColor: tones.bg, borderColor: tones.border, borderStyle: dashed ? 'dashed' : 'solid' }, style]}>
      {children}
    </View>
  );
}

export const Divider = ({ style }: { style?: StyleProp<ViewStyle> }) => <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: C.border }, style]} />;

// ---------- Buttons ----------

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accept' | 'reject';

export function Button({ title, kind = 'primary', icon, loading, disabled, size = 'md', style, full, ...rest }: PressableProps & { title: string; kind?: ButtonKind; icon?: IconName; loading?: boolean; size?: 'sm' | 'md' | 'lg'; style?: StyleProp<ViewStyle>; full?: boolean }) {
  const palette = {
    primary: { bg: C.primary, fg: C.onPrimary, border: C.primary },
    accept: { bg: C.primary, fg: C.onPrimary, border: C.primary },
    secondary: { bg: C.surface, fg: C.text, border: C.borderStrong },
    reject: { bg: C.surface, fg: C.text, border: C.borderStrong },
    ghost: { bg: 'transparent', fg: C.primary, border: 'transparent' },
    danger: { bg: C.surface, fg: C.danger, border: '#F3B2AB' },
  }[kind];
  const pad = size === 'sm' ? { paddingVertical: 7, paddingHorizontal: 12 } : size === 'lg' ? { paddingVertical: 14, paddingHorizontal: 20 } : { paddingVertical: 11, paddingHorizontal: 16 };
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      accessibilityLabel={title}
      disabled={isDisabled}
      {...rest}
      style={({ pressed }) => [
        styles.button,
        pad,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1, alignSelf: full ? 'stretch' : 'flex-start', minHeight: size === 'sm' ? 34 : 44 },
        style,
      ]}>
      {loading ? <ActivityIndicator size="small" color={palette.fg} /> : icon ? <Ionicons name={icon} size={size === 'sm' ? 15 : 18} color={palette.fg} /> : null}
      <Text variant={size === 'sm' ? 'smallStrong' : 'bodyStrong'} color={palette.fg}>
        {title}
      </Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, color = C.text, size = 22, style }: { icon: IconName; label: string; onPress?: () => void; color?: string; size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={({ pressed }) => [{ padding: 8, borderRadius: Radius.pill, opacity: pressed ? 0.6 : 1 }, style]}>
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

// ---------- Badges & banners ----------

export type BadgeKind = 'suggestion' | 'pending' | 'saved' | 'simulated' | 'sourced' | 'estimate' | 'neutral' | 'danger' | 'info' | 'rejected';

const BADGES: Record<BadgeKind, { bg: string; fg: string; icon?: IconName }> = {
  suggestion: { bg: '#EBE4FF', fg: C.suggestion, icon: 'sparkles' },
  pending: { bg: '#FDEBC8', fg: '#93370D', icon: 'time-outline' },
  saved: { bg: '#D1FADF', fg: C.success, icon: 'checkmark-circle' },
  simulated: { bg: '#E4E7EC', fg: C.simulated, icon: 'flask-outline' },
  sourced: { bg: '#DCEBFF', fg: C.info, icon: 'document-text-outline' },
  estimate: { bg: '#FDEBC8', fg: '#93370D', icon: 'eye-outline' },
  neutral: { bg: C.surfaceAlt, fg: C.textSecondary },
  danger: { bg: '#FEE4E2', fg: C.danger, icon: 'alert-circle' },
  info: { bg: '#DCEBFF', fg: C.info, icon: 'information-circle-outline' },
  rejected: { bg: C.surfaceAlt, fg: C.textSecondary, icon: 'close-circle-outline' },
};

export function Badge({ kind = 'neutral', label, icon }: { kind?: BadgeKind; label: string; icon?: IconName | null }) {
  const b = BADGES[kind];
  const ic = icon === null ? undefined : icon ?? b.icon;
  return (
    <View style={[styles.badge, { backgroundColor: b.bg }]} accessibilityLabel={label}>
      {ic ? <Ionicons name={ic} size={12} color={b.fg} /> : null}
      <Text variant="caption" color={b.fg}>
        {label}
      </Text>
    </View>
  );
}

export function SimulatedTag({ what }: { what: string }) {
  return <Badge kind="simulated" label={`Simulated ${what}`} />;
}

export function Banner({ kind = 'info', title, children, icon, action }: { kind?: 'info' | 'warning' | 'danger' | 'success' | 'simulated'; title?: string; children?: React.ReactNode; icon?: IconName; action?: React.ReactNode }) {
  const map = {
    info: { tone: 'info' as const, fg: C.info, icon: 'information-circle' as IconName },
    warning: { tone: 'pending' as const, fg: C.warning, icon: 'warning' as IconName },
    danger: { tone: 'danger' as const, fg: C.danger, icon: 'alert-circle' as IconName },
    success: { tone: 'saved' as const, fg: C.success, icon: 'checkmark-circle' as IconName },
    simulated: { tone: 'simulated' as const, fg: C.simulated, icon: 'flask' as IconName },
  }[kind];
  return (
    <Card tone={map.tone} dashed={kind === 'simulated'} style={{ padding: Space.md }} accessibilityRole={kind === 'danger' ? 'alert' : undefined}>
      <Row align="flex-start" gap={Space.sm}>
        <Ionicons name={icon ?? map.icon} size={18} color={map.fg} style={{ marginTop: 2 }} />
        <Stack gap={2} style={{ flex: 1 }}>
          {title ? <Text variant="bodyStrong">{title}</Text> : null}
          {typeof children === 'string' ? <Text variant="small" color={C.textSecondary}>{children}</Text> : children}
        </Stack>
        {action}
      </Row>
    </Card>
  );
}

// ---------- States ----------

export function EmptyState({ icon = 'leaf-outline', title, body, action }: { icon?: IconName; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: Space.xxl, gap: Space.sm }}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={24} color={C.textSecondary} />
      </View>
      <Text variant="h3" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {body ? <Muted style={{ textAlign: 'center', maxWidth: 380 }}>{body}</Muted> : null}
      {action ? <View style={{ marginTop: Space.sm }}>{action}</View> : null}
    </Card>
  );
}

export function ErrorState({ title = 'Something went wrong', body, onRetry, secondary }: { title?: string; body?: string; onRetry?: () => void; secondary?: React.ReactNode }) {
  return (
    <Card tone="danger" style={{ gap: Space.sm }} accessibilityRole="alert">
      <Row>
        <Ionicons name="alert-circle" size={20} color={C.danger} />
        <Text variant="bodyStrong">{title}</Text>
      </Row>
      {body ? <Text variant="small" color={C.textSecondary}>{body}</Text> : null}
      <Row wrap>
        {onRetry ? <Button title="Try again" kind="secondary" size="sm" icon="refresh" onPress={onRetry} /> : null}
        {secondary}
      </Row>
    </Card>
  );
}

export function LoadingState({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <Card style={{ gap: Space.md }} accessibilityLabel={label} accessibilityRole="progressbar">
      <Row>
        <ActivityIndicator color={C.primary} />
        <Muted>{label}</Muted>
      </Row>
      {Array.from({ length: lines }).map((_, i) => (
        <View key={i} style={{ height: 12, borderRadius: 6, backgroundColor: C.surfaceAlt, width: `${90 - i * 18}%` }} />
      ))}
    </Card>
  );
}

// ---------- Inputs ----------

export function Field({ label, hint, error, suffix, style, inputStyle, ...rest }: TextInputProps & { label?: string; hint?: string; error?: string; suffix?: string; style?: StyleProp<ViewStyle>; inputStyle?: StyleProp<TextStyle> }) {
  return (
    <Stack gap={6} style={style}>
      {label ? <Text variant="smallStrong">{label}</Text> : null}
      <View style={[styles.inputWrap, error ? { borderColor: C.danger } : null]}>
        <TextInput
          placeholderTextColor={C.textMuted}
          accessibilityLabel={label ?? rest.placeholder}
          {...rest}
          style={[styles.input, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null, inputStyle]}
        />
        {suffix ? <Muted variant="small" style={{ paddingRight: 12 }}>{suffix}</Muted> : null}
      </View>
      {error ? <Text variant="small" color={C.danger}>{error}</Text> : hint ? <Muted variant="small">{hint}</Muted> : null}
    </Stack>
  );
}

export function NumberField({ value, onChange, ...rest }: Omit<React.ComponentProps<typeof Field>, 'value' | 'onChangeText'> & { value: number | undefined; onChange: (v: number | undefined) => void }) {
  const [text, setText] = React.useState(value === undefined || Number.isNaN(value) ? '' : String(value));
  React.useEffect(() => {
    const parsed = parseFloat(text);
    if (value !== undefined && parsed !== value) setText(String(value));
    if (value === undefined && text !== '' && !Number.isNaN(parsed)) setText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Field
      keyboardType="decimal-pad"
      inputMode="decimal"
      {...rest}
      value={text}
      onChangeText={(t) => {
        const clean = t.replace(',', '.').replace(/[^0-9.]/g, '');
        setText(clean);
        const n = parseFloat(clean);
        onChange(Number.isFinite(n) ? n : undefined);
      }}
    />
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.chip, selected ? { backgroundColor: C.primarySoft, borderColor: C.primary } : null, pressed ? { opacity: 0.8 } : null]}>
      {icon ? <Ionicons name={icon} size={15} color={selected ? C.primary : C.textSecondary} /> : null}
      <Text variant="smallStrong" color={selected ? C.primary : C.text}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: sel }}
            style={[styles.segmentItem, sel ? styles.segmentItemSel : null]}>
            <Text variant="smallStrong" color={sel ? C.text : C.textSecondary} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function OptionCard({ title, body, selected, onPress, icon }: { title: string; body?: string; selected?: boolean; onPress: () => void; icon?: IconName }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [styles.card, { padding: Space.md, flexDirection: 'row', gap: Space.md, alignItems: 'center', borderColor: selected ? C.primary : C.border, backgroundColor: selected ? C.primarySoft : C.surface, opacity: pressed ? 0.9 : 1 }]}>
      {icon ? <Ionicons name={icon} size={22} color={selected ? C.primary : C.textSecondary} /> : null}
      <Stack gap={2} style={{ flex: 1 }}>
        <Text variant="bodyStrong">{title}</Text>
        {body ? <Muted variant="small">{body}</Muted> : null}
      </Stack>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? C.primary : C.borderStrong} />
    </Pressable>
  );
}

export function Stepper({ value, onChange, step = 1, min = 0, max = 9999, format }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; format?: (v: number) => string }) {
  return (
    <Row gap={4}>
      <IconButton icon="remove" label="Decrease" onPress={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))} style={styles.stepBtn} size={18} />
      <Text variant="bodyStrong" style={{ minWidth: 56, textAlign: 'center' }}>
        {format ? format(value) : value}
      </Text>
      <IconButton icon="add" label="Increase" onPress={() => onChange(Math.min(max, Math.round((value + step) * 100) / 100))} style={styles.stepBtn} size={18} />
    </Row>
  );
}

export function Toggle({ value, onChange, label, description }: { value: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.sm }}>
      <Stack gap={2} style={{ flex: 1 }}>
        <Text variant="bodyStrong">{label}</Text>
        {description ? <Muted variant="small">{description}</Muted> : null}
      </Stack>
      <View style={[styles.switchTrack, { backgroundColor: value ? C.primary : C.borderStrong }]}>
        <View style={[styles.switchThumb, { transform: [{ translateX: value ? 18 : 0 }] }]} />
      </View>
    </Pressable>
  );
}

// ---------- Data display ----------

export function ProgressBar({ value, max, color = C.primary, height = 8, over }: { value: number; max: number; color?: string; height?: number; over?: boolean }) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <View style={{ height, borderRadius: height, backgroundColor: C.surfaceAlt, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(value) }}>
      <View style={{ width: `${pct * 100}%`, height, borderRadius: height, backgroundColor: over ? C.warning : color }} />
    </View>
  );
}

export function Stat({ label, value, unit, sub, color }: { label: string; value: string | number; unit?: string; sub?: string; color?: string }) {
  return (
    <Stack gap={2}>
      <Muted variant="caption">{label.toUpperCase()}</Muted>
      <Row gap={4} align="flex-end">
        <Text variant="h2" color={color}>
          {value}
        </Text>
        {unit ? <Muted variant="small" style={{ marginBottom: 2 }}>{unit}</Muted> : null}
      </Row>
      {sub ? <Muted variant="small">{sub}</Muted> : null}
    </Stack>
  );
}

export function KeyValue({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <Row align="flex-start" style={{ paddingVertical: 4 }}>
      <Muted variant="small" style={{ width: 140 }}>{k}</Muted>
      {typeof v === 'string' || typeof v === 'number' ? <Text variant="small" style={{ flex: 1 }}>{v}</Text> : <View style={{ flex: 1 }}>{v}</View>}
    </Row>
  );
}

/** Expandable section — used for nutrition sources, assumptions and rationale. */
export function Expandable({ title, children, initiallyOpen = false, icon }: { title: string; children: React.ReactNode; initiallyOpen?: boolean; icon?: IconName }) {
  const [open, setOpen] = React.useState(initiallyOpen);
  return (
    <View>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
        {icon ? <Ionicons name={icon} size={15} color={C.textSecondary} /> : null}
        <Text variant="smallStrong" color={C.textSecondary} style={{ flex: 1 }}>
          {title}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={C.textSecondary} />
      </Pressable>
      {open ? <View style={{ paddingTop: 4, gap: 6 }}>{children}</View> : null}
    </View>
  );
}

export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const { isPhone } = useLayout();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType={isPhone ? 'slide' : 'fade'} onRequestClose={onClose}>
      <View style={[styles.backdrop, { justifyContent: isPhone ? 'flex-end' : 'center' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, isPhone ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: Math.max(insets.bottom, Space.lg) } : { width: 520, alignSelf: 'center' }]}>
          <Row>
            <Text variant="h2" style={{ flex: 1 }} accessibilityRole="header">
              {title}
            </Text>
            <IconButton icon="close" label="Close" onPress={onClose} />
          </Row>
          <ScrollView style={{ maxHeight: isPhone ? 520 : 600 }} contentContainerStyle={{ gap: Space.md, paddingBottom: Space.sm }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.lg, borderWidth: 1, padding: Space.lg, gap: Space.sm },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm, borderRadius: Radius.md, borderWidth: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.pill, alignSelf: 'flex-start' },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.borderStrong, borderRadius: Radius.md, backgroundColor: C.surface, minHeight: 44 },
  input: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.text, minHeight: 44 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.pill, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, minHeight: 36 },
  segment: { flexDirection: 'row', backgroundColor: C.surfaceAlt, borderRadius: Radius.md, padding: 3, gap: 2 },
  segmentItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: Radius.sm, minHeight: 36 },
  segmentItemSel: { backgroundColor: C.surface, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  stepBtn: { backgroundColor: C.surfaceAlt },
  switchTrack: { width: 44, height: 26, borderRadius: 13, padding: 3 },
  switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  backdrop: { flex: 1, backgroundColor: 'rgba(16,24,40,0.45)', padding: 0 },
  sheet: { backgroundColor: C.surface, borderRadius: Radius.xl, padding: Space.xl, gap: Space.md, maxWidth: '100%' },
});
