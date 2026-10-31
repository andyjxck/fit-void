import { formatDistance } from './cardio';
import { kgToLbs } from './plates';
import type { WeightUnit } from './types';

/** Canonical storage is kg; display converts to the user's unit. */
export function displayWeight(kg: number | null, unit: WeightUnit): string {
  if (kg == null) return '';
  const v = unit === 'lbs' ? kgToLbs(kg) : kg;
  return trimNum(Math.round(v * 100) / 100);
}

/** Parse a display-unit input back to canonical kg. */
export function parseWeight(input: string, unit: WeightUnit): number | null {
  const v = parseFloat(input);
  if (!Number.isFinite(v) || v < 0) return null;
  return unit === 'lbs' ? v * 0.45359237 : v;
}

export function trimNum(v: number): string {
  return Number.isInteger(v) ? String(v) : String(v).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatVolume(kg: number, unit: WeightUnit): string {
  const v = unit === 'lbs' ? kgToLbs(kg) : kg;
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : trimNum(Math.round(v));
}

/**
 * Label for a personal-record value. Weight records (1rm, max_weight) show the
 * user's unit; volume records are kg×reps and rep records are a plain count;
 * hold records are a duration and distance records are metres - so a 2400
 * kg×reps PR never reads as a 2400 kg lift, and a 45-second plank never reads
 * as "45kg".
 */
export function formatRecord(recordType: string, value: number, unit: WeightUnit): string {
  if (recordType === 'max_volume') return `${formatVolume(value, unit)} ${unit}×reps`;
  if (recordType === 'max_reps') return `${Math.round(value)} reps`;
  if (recordType === 'max_hold_seconds') return formatDuration(value);
  if (recordType === 'max_distance') return formatDistance(value, unit === 'lbs' ? 'mi' : 'km');
  return `${displayWeight(value, unit)} ${unit}`;
}

export function formatDuration(totalSeconds: number): string {
  // Truncate to whole seconds - "1:30", never "1:30.7".
  const total = Math.floor(totalSeconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Duration entry on a digits-only numpad works like a treadmill clock:
 * digits fill mm:ss from the right - "215" means 2:15 (135s), "45" → 45s,
 * "5" → 5s, "12345" → 123:45. Overflow seconds normalize naturally
 * ("290" → 210s → displays "3:30").
 */
export function clockDigitsToSeconds(digits: string): number | null {
  const d = digits.replace(/\D/g, '');
  if (!d) return null;
  const sec = parseInt(d.slice(-2), 10);
  const min = d.length > 2 ? parseInt(d.slice(0, -2), 10) : 0;
  return min * 60 + sec;
}

/** Inverse of clockDigitsToSeconds: 135 → "215", so re-editing round-trips. */
export function secondsToClockDigits(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}${String(s).padStart(2, '0')}`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
