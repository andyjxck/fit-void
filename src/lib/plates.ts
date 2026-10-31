import type { WeightUnit } from './types';

/** Standard plate denominations per side. */
const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];
const PLATES_LBS = [45, 35, 25, 10, 5, 2.5];

export const KG_PER_LB = 0.45359237;
export const kgToLbs = (kg: number) => kg / KG_PER_LB;
export const lbsToKg = (lbs: number) => lbs * KG_PER_LB;

export interface PlateBreakdown {
  /** Plates per side, heaviest first. Empty when the bar alone (or less). */
  plates: number[];
  /** Weight that can't be plated (returns 0 when the load is exact). */
  remainder: number;
  /** true when total can't be loaded exactly with standard plates. */
  approximate: boolean;
}

/**
 * Per-side plate breakdown for a barbell load.
 * `total` and `barWeight` are in `unit`. Greedy heaviest-first - standard
 * plates are monotonically loadable so greedy is optimal here.
 */
export function plateBreakdown(
  total: number,
  barWeight: number,
  unit: WeightUnit
): PlateBreakdown {
  const plates = unit === 'kg' ? PLATES_KG : PLATES_LBS;
  let perSide = (total - barWeight) / 2;
  const out: number[] = [];
  if (perSide <= 0) return { plates: out, remainder: 0, approximate: perSide < 0 };

  for (const p of plates) {
    while (perSide >= p - 1e-9) {
      out.push(p);
      perSide = Math.round((perSide - p) * 1000) / 1000;
    }
  }
  return { plates: out, remainder: perSide, approximate: perSide > 1e-9 };
}

/** Smallest loadable increment (a pair of the smallest plates). */
export function smallestIncrement(unit: WeightUnit): number {
  return unit === 'kg' ? 2.5 : 5;
}

/**
 * Round a target load to the nearest weight achievable with standard plates.
 */
export function roundToLoadable(total: number, barWeight: number, unit: WeightUnit): number {
  const inc = smallestIncrement(unit);
  const over = total - barWeight;
  if (over <= 0) return barWeight;
  return barWeight + Math.round(over / inc) * inc;
}
