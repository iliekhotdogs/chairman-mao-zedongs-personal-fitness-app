import type { UnitSystem } from './types';

export const LB_PER_KG = 2.20462;

export const kgToLb = (kg: number) => kg * LB_PER_KG;
export const lbToKg = (lb: number) => lb / LB_PER_KG;

export function displayWeight(kg: number, units: UnitSystem, digits = 1): string {
  const v = units === 'imperial' ? kgToLb(kg) : kg;
  return `${round(v, digits)} ${units === 'imperial' ? 'lb' : 'kg'}`;
}

/** Number in the user's unit, without a label. */
export function weightValue(kg: number, units: UnitSystem, digits = 1): number {
  return round(units === 'imperial' ? kgToLb(kg) : kg, digits);
}

export function toKg(value: number, units: UnitSystem): number {
  return units === 'imperial' ? lbToKg(value) : value;
}

export const weightUnit = (units: UnitSystem) => (units === 'imperial' ? 'lb' : 'kg');

export function round(v: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Round a training load to a plate-friendly increment in the user's units. */
export function roundLoadKg(kg: number, units: UnitSystem): number {
  if (units === 'imperial') return lbToKg(Math.round(kgToLb(kg) / 5) * 5);
  return Math.round(kg / 2.5) * 2.5;
}

export function cmToFtIn(cm: number): { ft: number; inch: number } {
  const totalIn = cm / 2.54;
  let ft = Math.floor(totalIn / 12);
  let inch = Math.round(totalIn - ft * 12);
  if (inch === 12) {
    ft += 1;
    inch = 0;
  }
  return { ft, inch };
}

export const ftInToCm = (ft: number, inch: number) => (ft * 12 + inch) * 2.54;
