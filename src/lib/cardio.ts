/**
 * Cardio domain helpers - pure functions, unit-tested.
 * Canonical distance unit is metres (like kg for weights).
 */

export type CardioActivity =
  | 'run'
  | 'cycle'
  | 'swim'
  | 'row'
  | 'walk'
  | 'hike'
  | 'elliptical'
  | 'stairs'
  | 'other';

export interface CardioSessionLike {
  activity: string;
  distance_m: number | null;
  duration_seconds: number;
  started_at: string;
}

export const ACTIVITY_META: Record<
  CardioActivity,
  { label: string; /** Standard PB distances in metres */ pbDistances: number[] }
> = {
  run: { label: 'Run', pbDistances: [1000, 5000, 10000, 21097, 42195] },
  cycle: { label: 'Cycle', pbDistances: [10000, 20000, 40000, 50000, 100000] },
  swim: { label: 'Swim', pbDistances: [200, 400, 800, 1000, 1500] },
  row: { label: 'Row', pbDistances: [500, 1000, 2000, 5000, 10000] },
  walk: { label: 'Walk', pbDistances: [1000, 5000, 10000] },
  hike: { label: 'Hike', pbDistances: [5000, 10000, 20000] },
  elliptical: { label: 'Elliptical', pbDistances: [] },
  stairs: { label: 'Stairs', pbDistances: [] },
  other: { label: 'Other', pbDistances: [] },
};

export const ACTIVITIES = Object.keys(ACTIVITY_META) as CardioActivity[];

// -- Optional per-set extras --------------------------------------------------

/**
 * Optional inputs beyond duration/distance/HR, per activity. Stored as JSON
 * on workout_sets.meta / cardio_sessions.meta - a generic bag so new fields
 * never need a schema change.
 */
export interface CardioExtra {
  key: string;
  label: string;
  /** Display suffix ('%', 'spm', 'm') - empty for bare numbers like LEVEL. */
  unit: string;
  /** How multiple per-set values fold into the single cardio_sessions row. */
  merge: 'avg' | 'sum' | 'max';
}

export const ACTIVITY_EXTRAS: Record<CardioActivity, CardioExtra[]> = {
  run: [
    { key: 'incline_pct', label: 'INCLINE', unit: '%', merge: 'avg' },
    { key: 'cadence', label: 'CADENCE', unit: 'spm', merge: 'avg' },
  ],
  walk: [
    { key: 'incline_pct', label: 'INCLINE', unit: '%', merge: 'avg' },
    { key: 'steps', label: 'STEPS', unit: '', merge: 'sum' },
  ],
  hike: [{ key: 'elevation_m', label: 'ELEVATION', unit: 'm', merge: 'sum' }],
  cycle: [
    { key: 'resistance', label: 'LEVEL', unit: '', merge: 'avg' },
    { key: 'watts', label: 'WATTS', unit: 'w', merge: 'avg' },
  ],
  swim: [{ key: 'laps', label: 'LAPS', unit: '', merge: 'sum' }],
  row: [
    { key: 'stroke_rate', label: 'STROKE', unit: 'spm', merge: 'avg' },
    { key: 'watts', label: 'WATTS', unit: 'w', merge: 'avg' },
  ],
  elliptical: [{ key: 'resistance', label: 'LEVEL', unit: '', merge: 'avg' }],
  stairs: [{ key: 'level', label: 'LEVEL', unit: '', merge: 'avg' }],
  other: [],
};

/** Fold per-set extras into one session-level object per each key's merge rule. */
export function mergeCardioExtras(
  sets: ({ meta?: Record<string, number> } | undefined)[],
  spec: CardioExtra[]
): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const e of spec) {
    const vals = sets.map((s) => s?.meta?.[e.key]).filter((v): v is number => v != null);
    if (vals.length === 0) continue;
    out[e.key] =
      e.merge === 'sum'
        ? vals.reduce((a, b) => a + b, 0)
        : e.merge === 'max'
          ? Math.max(...vals)
          : Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }
  return Object.keys(out).length ? out : null;
}

/** { incline_pct: 12 } → "INCLINE 12%" for session meta lines. */
export function formatExtras(
  meta: Record<string, number> | null | undefined,
  activity: CardioActivity
): string {
  if (!meta) return '';
  return ACTIVITY_EXTRAS[activity]
    .filter((e) => meta[e.key] != null)
    .map((e) => `${e.label} ${meta[e.key]}${e.unit}`)
    .join(' · ');
}

/** HealthKit activityName (e.g. 'Running') → our activity. */
export function hkActivityToCardio(name: string): CardioActivity {
  const n = name.toLowerCase();
  if (n.includes('run')) return 'run';
  if (n.includes('cycl') || n.includes('bik')) return 'cycle';
  if (n.includes('swim')) return 'swim';
  if (n.includes('row')) return 'row';
  if (n.includes('hik')) return 'hike';
  if (n.includes('walk')) return 'walk';
  if (n.includes('ellipt')) return 'elliptical';
  if (n.includes('stair') || n.includes('step')) return 'stairs';
  return 'other';
}

/** Fitbit activityName ('Treadmill', 'Spinning', 'Weights') → our activity. */
export function fitbitActivityToCardio(name: string): CardioActivity {
  const n = name.toLowerCase();
  if (n.includes('treadmill')) return 'run';
  if (n.includes('spin')) return 'cycle';
  if (n.includes('stair') || n.includes('step')) return 'stairs';
  return hkActivityToCardio(n);
}

/** Google Health exerciseType enum ('RUNNING', 'WALKING', 'BIKING') → ours. */
export function googleExerciseToCardio(t: string): CardioActivity {
  const n = t.toLowerCase().replace(/_/g, ' ');
  if (n.includes('treadmill')) return 'run';
  if (n.includes('biking') || n.includes('spinning')) return 'cycle';
  if (n.includes('stair')) return 'stairs';
  return hkActivityToCardio(n);
}

/** Health Connect exerciseType int → our activity. */
const HC_MAP: Record<number, CardioActivity> = {
  8: 'cycle', // BIKING
  9: 'cycle', // BIKING_STATIONARY
  25: 'elliptical',
  37: 'hike',
  53: 'row', // ROWING
  54: 'row', // ROWING_MACHINE
  56: 'run', // RUNNING
  57: 'run', // RUNNING_TREADMILL
  68: 'stairs', // STAIR_CLIMBING
  69: 'stairs', // STAIR_CLIMBING_MACHINE
  73: 'swim', // SWIMMING_OPEN_WATER
  74: 'swim', // SWIMMING_POOL
  79: 'walk', // WALKING
  // 80 is WATER_POLO - not walking; falls through to 'other'.
};

export function hcExerciseToCardio(t: number): CardioActivity {
  return HC_MAP[t] ?? 'other';
}

/** Minutes per km (lower is faster). null when distance is missing/zero. */
export function paceMinPerKm(distanceM: number | null, seconds: number): number | null {
  if (!distanceM || distanceM <= 0 || seconds <= 0) return null;
  return seconds / 60 / (distanceM / 1000);
}

export type DistanceUnit = 'km' | 'mi';
const MI_M = 1609.344;
const FT_M = 3.28084;

/** Display distance unit follows the weight-unit setting: lbs users read miles. */
export function distanceUnitFor(weightUnit: string): DistanceUnit {
  return weightUnit === 'lbs' ? 'mi' : 'km';
}

/** 5.4 → "05:24" (min/km); with unit='mi' the value is scaled to min/mi first. */
export function formatPace(minPerKm: number | null, unit: DistanceUnit = 'km'): string {
  if (minPerKm == null || !Number.isFinite(minPerKm) || minPerKm <= 0) return '-';
  const perUnit = unit === 'mi' ? minPerKm * (MI_M / 1000) : minPerKm;
  // Round total seconds first so 5.999 min/km → "06:00", not "05:60".
  const totalSec = Math.round(perUnit * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** metres → "5.02 km" / "640 m"; with unit='mi' → "3.12 mi" / "1640 ft". */
export function formatDistance(m: number | null, unit: DistanceUnit = 'km'): string {
  if (m == null) return '-';
  if (unit === 'mi') {
    const mi = m / MI_M;
    return mi >= 0.5 ? `${mi.toFixed(2)} mi` : `${Math.round(m * FT_M)} ft`;
  }
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function formatCardioDuration(seconds: number): string {
  // Round the total first so 3599.6s → "1:00:00", not "59:60".
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** Distance label for PB rows: 5000 → "5K", 21097 → "HALF", 42195 → "MARATHON". */
export function distanceLabel(m: number): string {
  if (m === 21097) return 'HALF';
  if (m === 42195) return 'MARATHON';
  if (m >= 1000) return `${(m / 1000).toFixed(m % 1000 ? 1 : 0)}K`;
  return `${m}M`;
}

// -- Heart-rate zones ---------------------------------------------------------

/**
 * Zone boundaries as % of max HR (Z1 <60%, Z2 60-70, Z3 70-80, Z4 80-90, Z5 90+).
 * maxHr defaults to 190 when no age is known.
 */
export const ZONE_LABELS = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'] as const;

export function hrZone(bpm: number, maxHr = 190): number {
  const pct = (bpm / maxHr) * 100;
  if (pct < 60) return 0;
  if (pct < 70) return 1;
  if (pct < 80) return 2;
  if (pct < 90) return 3;
  return 4;
}

/**
 * Split a workout's HR samples into minutes per zone. Samples are treated as
 * equally spaced across the session duration (Apple Watch samples ~every 5s).
 * Returns minutes [z1..z5], or null when no usable samples.
 */
export function hrZoneMinutes(
  bpmSamples: number[],
  durationSeconds: number,
  maxHr = 190
): [number, number, number, number, number] | null {
  const usable = bpmSamples.filter((b) => b > 30 && b < 220);
  if (usable.length < 3 || durationSeconds <= 0) return null;
  const perSampleMin = durationSeconds / 60 / usable.length;
  const zones: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const b of usable) zones[hrZone(b, maxHr)] += perSampleMin;
  return zones;
}

// -- Personal bests -----------------------------------------------------------

export interface DistancePB {
  activity: CardioActivity;
  distanceM: number;
  label: string;
  seconds: number;
  pace: number | null; // min/km
  date: string;
}

/**
 * Fastest session at each standard distance per activity. A session counts for
 * distance D when its distance is within [0.9D, 1.3D] - close enough to be a
 * genuine effort at that distance without crediting a marathon with a 5K PB.
 */
export function distancePBs(sessions: CardioSessionLike[]): DistancePB[] {
  const out: DistancePB[] = [];
  for (const a of ACTIVITIES) {
    for (const d of ACTIVITY_META[a].pbDistances) {
      let best: CardioSessionLike | null = null;
      for (const s of sessions) {
        if (s.activity !== a || !s.distance_m) continue;
        if (s.distance_m < d * 0.9 || s.distance_m > d * 1.3) continue;
        if (!best || s.duration_seconds < best.duration_seconds) best = s;
      }
      if (best) {
        out.push({
          activity: a,
          distanceM: d,
          label: distanceLabel(d),
          seconds: best.duration_seconds,
          pace: paceMinPerKm(best.distance_m, best.duration_seconds),
          date: best.started_at,
        });
      }
    }
  }
  return out;
}
