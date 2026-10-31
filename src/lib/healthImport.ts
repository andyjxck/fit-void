import { Platform } from 'react-native';

import { hasCardioNear, importCardio } from '@/db/repo/cardio';
import { hasLiquidExternalId, hasLiquidNear, logLiquid } from '@/db/repo/liquids';
import { listMeasurements, logMeasurement } from '@/db/repo/measurements';
import { localDay } from '@/db/repo/nutrition';
import { hrZoneMinutes } from './cardio';
import {
    getBodyFatHistory,
    getHKAuthStatus,
    getHRV,
    getRecentWorkouts,
    getRestingHeartRates,
    getSleepHours,
    getWaterHistory,
    getWeightHistory,
    getWorkoutHeartRates
} from './health';
import { withImportLock } from './importLock';
import { assertHealthImportAllowed, recordHealthImport } from './tiers';
import type { MetricType } from './types';

export interface ImportResult {
  cardio: number;
  sleep: number;
  restingHr: number;
  hrv: number;
  weight: number;
  bodyFat: number;
  hydration: number;
}

/** Local-day keys for deduping measurement imports. logged_at is a UTC
 *  instant - compare by the LOCAL day it lands on, not its UTC date. */
async function existingDays(metric: MetricType): Promise<Set<string>> {
  const rows = await listMeasurements(metric);
  return new Set(rows.map((r) => localDay(new Date(r.logged_at))));
}

/**
 * Pull cardio sessions + recovery metrics from the connected health platform.
 * Dedupes on external_id (cardio) and per-day (measurements), so it's safe to
 * call on every connect/focus.
 */
export function importHealthData(
  userId: string | null,
  opts: { days?: number; maxHr?: number } = {}
): Promise<ImportResult> {
  return withImportLock(async () => {
    // Free tier: a fixed number of pulls per calendar week; Pro is unlimited.
    // Throws HealthQuotaError - silent callers (focus/auto) just catch it.
    await assertHealthImportAllowed();
    const r = await runHealthImport(userId, opts);
    await recordHealthImport();
    return r;
  });
}

async function runHealthImport(
  userId: string | null,
  opts: { days?: number; maxHr?: number } = {}
): Promise<ImportResult> {
  const days = opts.days ?? 90;
  const maxHr = opts.maxHr ?? 190;
  const out: ImportResult = { cardio: 0, sleep: 0, restingHr: 0, hrv: 0, weight: 0, bodyFat: 0, hydration: 0 };

  // Cardio sessions - 90 days of workouts
  console.log('[dbg-health] import start, days=', days);
  void getHKAuthStatus();
  const workouts = await getRecentWorkouts(days);
  console.log('[dbg-health] workouts from platform:', workouts.length);
  for (const w of workouts) {
    // Same start + activity = already logged - HealthKit vendors dupes under
    // different UUIDs (watch + bridging apps), and other sources may have
    // landed first. external_id can't see either.
    if (await hasCardioNear(new Date(w.startedAt).toISOString(), 600, w.activity)) continue;
    const bpms = await getWorkoutHeartRates(w.startedAt, w.endAt);
    const zones = hrZoneMinutes(bpms, w.durationS, maxHr);
    const avg = bpms.length ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null;
    const max = bpms.length ? Math.round(Math.max(...bpms)) : null;
    const inserted = await importCardio({
      external_id: w.externalId,
      activity: w.activity,
      distance_m: w.distanceM,
      duration_seconds: w.durationS,
      avg_hr: avg,
      max_hr: max,
      zone_minutes: zones,
      calories: w.calories,
      source: w.externalId.startsWith('hk:') ? 'healthkit' : 'healthconnect',
      started_at: new Date(w.startedAt).toISOString(),
      user_id: userId,
    });
    if (inserted) out.cardio++;
  }

  // Resting HR - one row per day, skip days already logged
  const restingDays = await existingDays('resting_hr');
  for (const r of await getRestingHeartRates(30)) {
    const day = localDay(new Date(r.date));
    if (restingDays.has(day)) continue;
    restingDays.add(day);
    await logMeasurement({
      metric_type: 'resting_hr',
      value: r.bpm,
      logged_at: new Date(r.date).toISOString(),
      user_id: userId,
    });
    out.restingHr++;
  }

  // HRV - one row per day, skip days already logged
  const hrvDays = await existingDays('hrv');
  for (const r of await getHRV(30)) {
    const day = localDay(new Date(r.date));
    if (hrvDays.has(day)) continue;
    hrvDays.add(day);
    await logMeasurement({
      metric_type: 'hrv',
      value: r.ms,
      logged_at: new Date(r.date).toISOString(),
      user_id: userId,
    });
    out.hrv++;
  }

  // Sleep - one row per wake date, skip days already logged
  const sleepDays = await existingDays('sleep_hours');
  for (const s of await getSleepHours(14)) {
    const day = localDay(new Date(s.date));
    if (sleepDays.has(day)) continue;
    sleepDays.add(day);
    await logMeasurement({
      metric_type: 'sleep_hours',
      value: s.hours,
      logged_at: new Date(s.date).toISOString(),
      user_id: userId,
    });
    out.sleep++;
  }

  // Weight - one row per day, skip days already logged (manual or Aria/etc.)
  const weightDays = await existingDays('weight');
  for (const w of await getWeightHistory(90)) {
    const day = localDay(new Date(w.date));
    if (weightDays.has(day)) continue;
    weightDays.add(day);
    await logMeasurement({
      metric_type: 'weight',
      value: w.kg,
      logged_at: new Date(w.date).toISOString(),
      user_id: userId,
    });
    out.weight++;
  }

  // Body fat - one row per day, skip days already logged (manual or scale)
  const bfDays = await existingDays('body_fat');
  for (const b of await getBodyFatHistory(90)) {
    const day = localDay(new Date(b.date));
    if (bfDays.has(day)) continue;
    bfDays.add(day);
    await logMeasurement({
      metric_type: 'body_fat',
      value: b.pct,
      logged_at: new Date(b.date).toISOString(),
      user_id: userId,
    });
    out.bodyFat++;
  }

  // Water - dietary-water samples land as liquid_entries rows. external_id
  // dedupes re-imports; hasLiquidNear skips samples another source already
  // logged (Fitbit water can arrive via both HealthKit and Google Health -
  // no shared id, so same-day amount match within 15% is the guard).
  const source = Platform.OS === 'android' ? 'hc:' : 'hk:';
  for (const w of await getWaterHistory(14)) {
    const ext = `${source}${w.id}`;
    if (await hasLiquidExternalId(ext)) continue;
    const day = localDay(new Date(w.date));
    if (await hasLiquidNear(day, w.ml, ext)) continue;
    await logLiquid({
      amount_ml: w.ml,
      kind: 'water',
      name: 'Water',
      logged_on: day,
      external_id: ext,
      user_id: userId,
    });
    out.hydration++;
  }

  console.log('[dbg-health] import done:', JSON.stringify(out));
  return out;
}
