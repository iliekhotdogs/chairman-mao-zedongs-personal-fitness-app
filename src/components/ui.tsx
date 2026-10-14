import React from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewProps, type ViewStyle,
} from 'react-native';
import Animated, { Easing, FadeInDown, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C, Font, MaxWidths, Motion, Radius, Space, Type } from '@/constants/theme';
import { useLayout } from '@/hooks/useLayout';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export { Ionicons };

/** Pressable state on react-native-web also carries `hovered`. */
type PState = { pressed: boolean; hovered?: boolean };

// ---------- Text ----------

type Variant = keyof typeof Type;

export function Text({ variant = 'body', color, style, ...rest }: TextProps & { variant?: Variant; color?: string }) {
  return <RNText {...rest} style={[{ color: color ?? C.text, fontFamily: Font.family }, Type[variant], style]} />;
}

export const Muted = (p: TextProps & { variant?: Variant }) => <Text color={C.textSecondary} {...p} />;

/** Short accent underline used under display headings. */
export function AccentRule({ width = 36, style }: { width?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width, height: 3, borderRadius: 2, backgroundColor: C.accent }, style]} />;
}

// ---------- Motion ----------

/** Entrance fade + slide for a block of content. `index` staggers siblings. Respects reduced motion. */
export function Reveal({ children, index = 0, style }: { children: React.ReactNode; index?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={FadeInDown.duration(Motion.enter).delay(index * Motion.stagger).reduceMotion(ReduceMotion.System)} style={style}>
      {children}
    </Animated.View>
  );
}

/** Animates a number from its previous value to `target` (ease-out). Returns the current display value. */
export function useCountUp(target: number, duration: number = Motion.countUp) {
  const reduce = useReducedMotion();
  const [value, setValue] = React.useState(0);
  const last = React.useRef(0);
  React.useEffect(() => {
    if (reduce || !Number.isFinite(target)) return;
    const from = last.current;
    const start = Date.now();
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const v = from + (target - from) * (1 - Math.pow(1 - t, 3));
      last.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduce]);
  return reduce || !Number.isFinite(target) ? target : value;
}

/** A big number that counts up on mount/changes. */
export function CountUp({ value, format = (v) => Math.round(v).toLocaleString(), variant = 'number', color, style }: { value: number; format?: (v: number) => string; variant?: Variant; color?: string; style?: StyleProp<TextStyle> }) {
  const v = useCountUp(value);
  return (
    <Text variant={variant} color={color} style={style} accessibilityLabel={format(value)}>
      {format(v)}
    </Text>
  );
}

// ---------- Layout ----------

export type ScreenSize = keyof typeof MaxWidths;

export function Screen({ children, scroll = true, size = 'wide', maxWidth, padded = true, contentStyle }: { children: React.ReactNode; scroll?: boolean; size?: ScreenSize; maxWidth?: number; padded?: boolean; contentStyle?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  const { isPhone } = useLayout();
  const inner = (
    <Animated.View
      entering={FadeInDown.duration(Motion.enter).reduceMotion(ReduceMotion.System)}
      style={[{ width: '100%', maxWidth: maxWidth ?? MaxWidths[size], alignSelf: 'center', paddingHorizontal: padded ? (isPhone ? Space.lg : Space.xxl) : 0, paddingTop: isPhone ? Math.max(insets.top, Space.md) + Space.md : Space.xxl + Space.sm, paddingBottom: Space.xxxl * 2, gap: Space.lg }, contentStyle]}>
      {children}
    </Animated.View>
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

export function PageHeader({ title, subtitle, eyebrow, right }: { title: string; subtitle?: string; eyebrow?: string; right?: React.ReactNode }) {
  return (
    <Row align="flex-end" wrap gap={Space.md} style={{ marginBottom: Space.sm }}>
      <Stack gap={Space.sm} style={{ flex: 1, minWidth: 220 }}>
        {eyebrow ? <Text variant="eyebrow" color={C.textSecondary}>{eyebrow}</Text> : null}
        <Text variant="h1" accessibilityRole="header">
          {title}
        </Text>
        <AccentRule />
        {subtitle ? <Muted>{subtitle}</Muted> : null}
      </Stack>
      {right}
    </Row>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Row style={{ marginTop: Space.md }}>
      <Text variant="h2" style={{ flex: 1 }} accessibilityRole="header">
        {children}
      </Text>
      {right}
    </Row>
  );
}

// ---------- Surfaces ----------

export type CardTone = 'default' | 'suggestion' | 'pending' | 'saved' | 'simulated' | 'danger' | 'info' | 'muted' | 'accent';

const TONES: Record<CardTone, { bg: string; border: string }> = {
  default: { bg: C.surface, border: C.border },
  suggestion: { bg: C.suggestionSoft, border: C.suggestionBorder },
  pending: { bg: C.warningSoft, border: C.warningBorder },
  saved: { bg: C.successSoft, border: C.successBorder },
  simulated: { bg: C.simulatedSoft, border: C.borderStrong },
  danger: { bg: C.dangerSoft, border: C.dangerBorder },
  info: { bg: C.infoSoft, border: C.infoBorder },
  muted: { bg: C.surfaceAlt, border: C.border },
  accent: { bg: C.primarySoft, border: C.primaryBorder },
};

export function Card({ style, tone = 'default', dashed, children, onPress, ...rest }: ViewProps & { tone?: CardTone; dashed?: boolean; onPress?: () => void }) {
  const t = TONES[tone];
  const base = [styles.card, { backgroundColor: t.bg, borderColor: t.border, borderStyle: dashed ? 'dashed' : 'solid' } as ViewStyle];
  if (onPress) {
    return (
      <Pressable
        {...(rest as PressableProps)}
        onPress={onPress}
        accessibilityRole={rest.accessibilityRole ?? 'button'}
        style={({ pressed, hovered }: PState) => [...base, hovered ? { borderColor: C.borderStrong, backgroundColor: tone === 'default' ? C.surfaceHover : t.bg } : null, pressed ? { opacity: 0.85 } : null, style]}>
        {children}
      </Pressable>
    );
  }
  return (
    <View {...rest} style={[...base, style]}>
      {children}
    </View>
  );
}

export const Divider = ({ style }: { style?: StyleProp<ViewStyle> }) => <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: C.border }, style]} />;

// ---------- Buttons ----------

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accept' | 'reject';

const BUTTONS: Record<ButtonKind, { bg: string; fg: string; border: string; hoverBg: string; hoverBorder: string }> = {
  primary: { bg: C.primary, fg: C.onPrimary, border: C.primary, hoverBg: C.primaryHover, hoverBorder: C.primaryHover },
  accept: { bg: C.primary, fg: C.onPrimary, border: C.primary, hoverBg: C.primaryHover, hoverBorder: C.primaryHover },
  secondary: { bg: C.surfaceAlt, fg: C.text, border: C.borderStrong, hoverBg: C.surfaceRaised, hoverBorder: C.textMuted },
  reject: { bg: C.surfaceAlt, fg: C.text, border: C.borderStrong, hoverBg: C.surfaceRaised, hoverBorder: C.textMuted },
  ghost: { bg: 'transparent', fg: C.primary, border: 'transparent', hoverBg: C.primarySoft, hoverBorder: 'transparent' },
  danger: { bg: 'transparent', fg: C.danger, border: C.dangerBorder, hoverBg: C.dangerSoft, hoverBorder: C.danger },
};

export function Button({ title, kind = 'primary', icon, loading, disabled, size = 'md', style, full, ...rest }: PressableProps & { title: string; kind?: ButtonKind; icon?: IconName; loading?: boolean; size?: 'sm' | 'md' | 'lg'; style?: StyleProp<ViewStyle>; full?: boolean }) {
  const palette = BUTTONS[kind];
  const pad = size === 'sm' ? { paddingVertical: 7, paddingHorizontal: 12 } : size === 'lg' ? { paddingVertical: 15, paddingHorizontal: 24 } : { paddingVertical: 11, paddingHorizontal: 18 };
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      accessibilityLabel={title}
      disabled={isDisabled}
      {...rest}
      style={({ pressed, hovered }: PState) => [
        styles.button,
        pad,
        {
          backgroundColor: hovered && !isDisabled ? palette.hoverBg : palette.bg,
          borderColor: hovered && !isDisabled ? palette.hoverBorder : palette.border,
          opacity: isDisabled ? 0.45 : pressed ? 0.8 : 1,
          transform: [{ scale: pressed && !isDisabled ? 0.98 : 1 }],
          alignSelf: full ? 'stretch' : 'flex-start',
          minHeight: size === 'sm' ? 34 : size === 'lg' ? 52 : 44,
        },
        style,
      ]}>
      {loading ? <ActivityIndicator size="small" color={palette.fg} /> : icon ? <Ionicons name={icon} size={size === 'sm' ? 15 : 18} color={palette.fg} /> : null}
      <Text variant={size === 'sm' ? 'smallStrong' : 'bodyStrong'} color={palette.fg} style={size === 'lg' ? { letterSpacing: 0.3 } : undefined}>
        {title}
      </Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, color = C.text, size = 22, style }: { icon: IconName; label: string; onPress?: () => void; color?: string; size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={({ pressed, hovered }: PState) => [{ padding: 8, borderRadius: Radius.pill, opacity: pressed ? 0.6 : 1 }, style, hovered ? { backgroundColor: C.surfaceRaised } : null]}>
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

// ---------- Badges & banners ----------

export type BadgeKind = 'suggestion' | 'pending' | 'saved' | 'simulated' | 'sourced' | 'estimate' | 'neutral' | 'danger' | 'info' | 'rejected' | 'accent';

const BADGES: Record<BadgeKind, { bg: string; fg: string; border: string; icon?: IconName }> = {
  suggestion: { bg: C.suggestionSoft, fg: C.suggestion, border: C.suggestionBorder, icon: 'sparkles' },
  pending: { bg: C.warningSoft, fg: C.warning, border: C.warningBorder, icon: 'time-outline' },
  saved: { bg: C.successSoft, fg: C.success, border: C.successBorder, icon: 'checkmark-circle' },
  simulated: { bg: C.simulatedSoft, fg: C.simulated, border: C.borderStrong, icon: 'flask-outline' },
  sourced: { bg: C.infoSoft, fg: C.info, border: C.infoBorder, icon: 'document-text-outline' },
  estimate: { bg: C.warningSoft, fg: C.warning, border: C.warningBorder, icon: 'eye-outline' },
  neutral: { bg: C.surfaceAlt, fg: C.textSecondary, border: C.border },
  danger: { bg: C.dangerSoft, fg: C.danger, border: C.dangerBorder, icon: 'alert-circle' },
  info: { bg: C.infoSoft, fg: C.info, border: C.infoBorder, icon: 'information-circle-outline' },
  rejected: { bg: C.surfaceAlt, fg: C.textSecondary, border: C.border, icon: 'close-circle-outline' },
  accent: { bg: C.primarySoft, fg: C.primary, border: C.primaryBorder },
};

export function Badge({ kind = 'neutral', label, icon }: { kind?: BadgeKind; label: string; icon?: IconName | null }) {
  const b = BADGES[kind];
  const ic = icon === null ? undefined : icon ?? b.icon;
  return (
    <View style={[styles.badge, { backgroundColor: b.bg, borderColor: b.border }]} accessibilityLabel={label}>
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

/** A placeholder bar with a moving highlight (static when reduced motion is on). */
export function Skeleton({ width = '100%', height = 12, radius = 6, style }: { width?: ViewStyle['width']; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const x = useSharedValue(0);
  React.useEffect(() => {
    if (reduce) return;
    x.set(withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.ease) }), -1, false));
  }, [reduce, x]);
  const shine = useAnimatedStyle(() => ({ left: `${-40 + x.get() * 140}%` as `${number}%` }));
  return (
    <View style={[{ width, height, borderRadius: radius, backgroundColor: C.surfaceAlt, overflow: 'hidden' }, style]}>
      {reduce ? null : <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, width: '40%', backgroundColor: C.surfaceRaised, opacity: 0.9 }, shine]} />}
    </View>
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
        <Skeleton key={i} width={`${90 - i * 18}%`} />
      ))}
    </Card>
  );
}

// ---------- Inputs ----------

export function Field({ label, hint, error, suffix, style, inputStyle, ...rest }: TextInputProps & { label?: string; hint?: string; error?: string; suffix?: string; style?: StyleProp<ViewStyle>; inputStyle?: StyleProp<TextStyle> }) {
  const [focused, setFocused] = React.useState(false);
  return (
    <Stack gap={6} style={style}>
      {label ? <Text variant="smallStrong" color={C.textSecondary}>{label}</Text> : null}
      <View style={[styles.inputWrap, focused ? { borderColor: C.primary } : null, error ? { borderColor: C.danger } : null]}>
        <TextInput
          placeholderTextColor={C.textMuted}
          accessibilityLabel={label ?? rest.placeholder}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[styles.input, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null, inputStyle]}
        />
        {suffix ? <Muted variant="small" style={{ paddingRight: 12 }}>{suffix}</Muted> : null}
      </View>
      {error ? <Text variant="small" color={C.danger}>{error}</Text> : hint ? <Muted variant="small">{hint}</Muted> : null}
    </Stack>
  );
}

export function NumberField({ value, onChange, ...rest }: Omit<React.ComponentProps<typeof Field>, 'value' | 'onChangeText' | 'onChange'> & { value: number | undefined; onChange: (v: number | undefined) => void }) {
  const [text, setText] = React.useState(value === undefined || Number.isNaN(value) ? '' : String(value));
  // Sync the text when the value is changed from outside (e.g. +/- buttons), without an effect.
  const [prev, setPrev] = React.useState(value);
  if (value !== prev) {
    setPrev(value);
    const parsed = parseFloat(text);
    if (value !== undefined && parsed !== value) setText(String(value));
    if (value === undefined && text !== '' && !Number.isNaN(parsed)) setText('');
  }
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

export function Chip({ label, selected, onPress, icon, asButton }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName; asButton?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={asButton ? 'button' : 'checkbox'}
      accessibilityState={asButton ? undefined : { checked: !!selected }}
      accessibilityLabel={label}
      style={({ pressed, hovered }: PState) => [styles.chip, hovered && !selected ? { borderColor: C.borderStrong, backgroundColor: C.surfaceRaised } : null, selected ? { backgroundColor: C.primarySoft, borderColor: C.primaryBorder } : null, pressed ? { opacity: 0.8 } : null]}>
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
            accessibilityLabel={o.label}
            accessibilityState={{ selected: sel }}
            style={({ hovered }: PState) => [styles.segmentItem, sel ? styles.segmentItemSel : hovered ? { backgroundColor: C.surfaceHover } : null]}>
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
      accessibilityLabel={body ? `${title}. ${body}` : title}
      accessibilityState={{ selected: !!selected }}
      style={({ pressed, hovered }: PState) => [styles.card, { padding: Space.md, flexDirection: 'row', gap: Space.md, alignItems: 'center', borderColor: selected ? C.primaryBorder : hovered ? C.borderStrong : C.border, backgroundColor: selected ? C.primarySoft : hovered ? C.surfaceHover : C.surface, opacity: pressed ? 0.9 : 1 }]}>
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
      <View style={[styles.switchTrack, { backgroundColor: value ? C.primary : C.surfaceRaised, borderColor: value ? C.primary : C.borderStrong }]}>
        <View style={[styles.switchThumb, { backgroundColor: value ? C.onPrimary : C.textSecondary, transform: [{ translateX: value ? 18 : 0 }] }]} />
      </View>
    </Pressable>
  );
}

// ---------- Data display ----------

export function ProgressBar({ value, max, color = C.primary, height = 8, over }: { value: number; max: number; color?: string; height?: number; over?: boolean }) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <View style={{ height, borderRadius: height, backgroundColor: C.surfaceRaised, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(value) }}>
      <View style={{ width: `${pct * 100}%`, height, borderRadius: height, backgroundColor: over ? C.warning : color }} />
    </View>
  );
}

export function Stat({ label, value, unit, sub, color }: { label: string; value: string | number; unit?: string; sub?: string; color?: string }) {
  return (
    <Stack gap={4}>
      <Text variant="eyebrow" color={C.textSecondary}>{label}</Text>
      <Row gap={6} align="flex-end">
        <Text variant="numberSm" color={color}>
          {value}
        </Text>
        {unit ? <Muted variant="small" style={{ marginBottom: 4 }}>{unit}</Muted> : null}
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
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={({ hovered }: PState) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, borderRadius: Radius.sm }, hovered ? { opacity: 0.8 } : null]}>
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
        <View style={[styles.sheet, isPhone ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0, paddingBottom: Math.max(insets.bottom, Space.lg) } : { width: 520, alignSelf: 'center' }]}>
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
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.pill, borderWidth: 1, alignSelf: 'flex-start' },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.borderStrong, borderRadius: Radius.md, backgroundColor: C.bgDeep, minHeight: 44 },
  input: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.text, minHeight: 44 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.pill, borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceAlt, minHeight: 36 },
  segment: { flexDirection: 'row', backgroundColor: C.bgDeep, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, padding: 3, gap: 2 },
  segmentItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: Radius.sm, minHeight: 36 },
  segmentItemSel: { backgroundColor: C.surfaceRaised },
  stepBtn: { backgroundColor: C.surfaceAlt },
  switchTrack: { width: 46, height: 28, borderRadius: 14, padding: 3, borderWidth: 1 },
  switchThumb: { width: 20, height: 20, borderRadius: 10 },
  backdrop: { flex: 1, backgroundColor: C.overlay, padding: 0 },
  sheet: { backgroundColor: C.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.border, padding: Space.xl, gap: Space.md, maxWidth: '100%' },
});
