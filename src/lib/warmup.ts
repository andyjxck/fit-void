import { kgToLbs, lbsToKg, roundToLoadable } from './plates';
import type { WeightUnit } from './types';

export interface WarmupSet {
  weightKg: number;
  reps: number;
  percent: number; // of the working weight, for display
}

/** Bar × 10, 50% × 5, 70% × 3, 85% × 1 - plate-rounded per step. */
const RAMP: [number, number][] = [
  [0, 10],
  [0.5, 5],
  [0.7, 3],
  [0.85, 1],
];

/**
 * Generates 4 ramp sets toward `workKg` (canonical kg).
 *
 * Rounding happens in the DISPLAY unit - an lbs lifter has lbs plates - then
 * converts back to kg for storage. `barKg` is the bar weight in canonical kg.
 */
export function generateWarmups(workKg: number, barKg: number, unit: WeightUnit): WarmupSet[] {
  const toDisplay = unit === 'lbs' ? kgToLbs : (v: number) => v;
  const toKg = unit === 'lbs' ? lbsToKg : (v: number) => v;
  const workDisplay = toDisplay(workKg);
  const barDisplay = toDisplay(barKg);

  return RAMP.map(([pct, reps]) => {
    const raw = pct === 0 ? barDisplay : workDisplay * pct;
    const rounded = roundToLoadable(Math.max(raw, barDisplay), barDisplay, unit);
    return { weightKg: Math.round(toKg(rounded) * 100) / 100, reps, percent: pct };
  });
}
