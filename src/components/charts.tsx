import React, { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { C } from '@/constants/theme';

export function Ring({ size = 150, stroke = 12, value, max, color = C.calories, children }: { size?: number; stroke?: number; value: number; max: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const over = max > 0 && value > max;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.surfaceAlt} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={over ? C.warning : color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

function useWidth(initial = 320) {
  const [w, setW] = useState(initial);
  return { w, onLayout: (e: LayoutChangeEvent) => setW(Math.max(160, e.nativeEvent.layout.width)) };
}

export interface Point {
  x: string; // label (date)
  y: number;
}

/** Minimal line chart with optional trend line and target band. */
export function LineChart({ points, height = 180, color = C.primary, trend, format = (v: number) => v.toFixed(1), label }: { points: Point[]; height?: number; color?: string; trend?: Point[]; format?: (v: number) => string; label: string }) {
  const { w, onLayout } = useWidth();
  if (points.length === 0) return <View onLayout={onLayout} style={{ height }} />;
  const ys = [...points.map((p) => p.y), ...(trend ?? []).map((p) => p.y)];
  let min = Math.min(...ys);
  let max = Math.max(...ys);
  if (max - min < 1e-6) {
    min -= 1;
    max += 1;
  }
  const padY = (max - min) * 0.15;
  min -= padY;
  max += padY;
  const left = 44;
  const right = 8;
  const top = 10;
  const bottom = 22;
  const iw = w - left - right;
  const ih = height - top - bottom;
  const xFor = (i: number, n: number) => left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yFor = (v: number) => top + ih - ((v - min) / (max - min)) * ih;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${xFor(i, points.length).toFixed(1)},${yFor(p.y).toFixed(1)}`).join(' ');
  const tpath = trend?.length ? trend.map((p, i) => `${i ? 'L' : 'M'}${xFor(i, trend.length).toFixed(1)},${yFor(p.y).toFixed(1)}`).join(' ') : undefined;
  const ticks = [min + padY, (min + max) / 2, max - padY];
  const labelIdx = points.length <= 1 ? [0] : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  return (
    <View onLayout={onLayout} accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={w} height={height}>
        {ticks.map((t, i) => (
          <G key={i}>
            <Line x1={left} x2={w - right} y1={yFor(t)} y2={yFor(t)} stroke={C.border} strokeWidth={1} />
            <SvgText x={left - 6} y={yFor(t) + 4} fontSize={10} fill={C.textMuted} textAnchor="end">
              {format(t)}
            </SvgText>
          </G>
        ))}
        {tpath ? <Path d={tpath} stroke={C.textMuted} strokeWidth={1.5} strokeDasharray="4 4" fill="none" /> : null}
        <Path d={path} stroke={color} strokeWidth={2.25} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <Circle key={i} cx={xFor(i, points.length)} cy={yFor(p.y)} r={points.length > 30 ? 1.5 : 3} fill={color} />
        ))}
        {[...new Set(labelIdx)].map((i) => (
          <SvgText key={i} x={xFor(i, points.length)} y={height - 6} fontSize={10} fill={C.textMuted} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
            {points[i].x}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

/** Bars with an optional target line (e.g. daily calories vs target). */
export function BarChart({ bars, height = 170, target, color = C.primary, label, format = (v: number) => String(Math.round(v)) }: { bars: { x: string; y: number | null; highlight?: boolean }[]; height?: number; target?: number; color?: string; label: string; format?: (v: number) => string }) {
  const { w, onLayout } = useWidth();
  const vals = bars.map((b) => b.y ?? 0);
  const max = Math.max(1, ...vals, target ?? 0) * 1.1;
  const left = 40;
  const bottom = 22;
  const top = 8;
  const iw = w - left - 4;
  const ih = height - top - bottom;
  const bw = Math.max(4, (iw / bars.length) * 0.62);
  const xFor = (i: number) => left + (i + 0.5) * (iw / bars.length);
  const yFor = (v: number) => top + ih - (v / max) * ih;
  const every = Math.ceil(bars.length / 7);
  return (
    <View onLayout={onLayout} accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={w} height={height}>
        {[0, max / 2, max / 1.1].map((t, i) => (
          <G key={i}>
            <Line x1={left} x2={w} y1={yFor(t)} y2={yFor(t)} stroke={C.border} />
            <SvgText x={left - 6} y={yFor(t) + 4} fontSize={10} fill={C.textMuted} textAnchor="end">
              {format(t)}
            </SvgText>
          </G>
        ))}
        {bars.map((b, i) =>
          b.y === null ? (
            <Rect key={i} x={xFor(i) - bw / 2} y={top + ih - 3} width={bw} height={3} fill={C.border} rx={1} />
          ) : (
            <Rect key={i} x={xFor(i) - bw / 2} y={yFor(b.y)} width={bw} height={Math.max(1, top + ih - yFor(b.y))} rx={3} fill={b.highlight ? C.warning : color} opacity={b.highlight ? 1 : 0.85} />
          ),
        )}
        {target ? <Line x1={left} x2={w} y1={yFor(target)} y2={yFor(target)} stroke={C.text} strokeDasharray="5 4" strokeWidth={1.25} /> : null}
        {bars.map((b, i) =>
          i % every === 0 || i === bars.length - 1 ? (
            <SvgText key={`l${i}`} x={xFor(i)} y={height - 6} fontSize={10} fill={C.textMuted} textAnchor="middle">
              {b.x}
            </SvgText>
          ) : null,
        )}
      </Svg>
    </View>
  );
}
