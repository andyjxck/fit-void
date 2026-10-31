import { hasCardioNear, importCardio } from '@/db/repo/cardio';
import { hasLiquidExternalId, hasLiquidNear, logLiquid } from '@/db/repo/liquids';
import { listMeasurements, logMeasurement } from '@/db/repo/measurements';
import { hasFoodExternalId, localDay, logFood } from '@/db/repo/nutrition';
import { setAvgHr, setsMissingHr } from '@/db/repo/workouts';
import { googleExerciseToCardio } from './cardio';
import {
    getGoogleBodyFat,
    getGoogleExercises,
    getGoogleFoodLogs,
    getGoogleHRV,
    getGoogleHydration,
    getGoogleIntradayHR,
    getGoogleRestingHR,
    getGoogleSleep,
    getGoogleWeights,
    isGoogleHealthConnected
} from './googleHealth';
import { withImportLock } from './importLock';
import { assertHealthImportAllowed, recordHealthImport } from './tiers';
import type { MetricType } from './types';

export interface GoogleHealthImportResult {
  cardio: number;
  sleep: number;
  restingHr: number;
  hrv: number;
  weight: number;
  bodyFat: number;
  hydration: number;
  food: number;
}

async function existingDays(metric: MetricType): Promise<Set<string>> {
  const rows = await listMeasurements(metric);
  return new Set(rows.map((r) => localDay(new Date(r.logged_at))));
}

/**
 * Pull workouts + vitals from the Google Health API (covers Fitbit and Pixel
 * Watch devices). ghealth:<id> dedupes re-imports; hasCardioNear skips
 * sessions already imported from HealthKit / Health Connect so a workout
 * bridged through Apple Health doesn't double-count. Idempotent per focus.
 */
export function importGoogleHealthData(
  userId: string | null,
  opts: { days?: number } = {}
): Promise<GoogleHealthImportResult> {
  return withImportLock(async () => {
    await assertHealthImportAllowed();
    const r = await runGoogleHealthImport(userId, opts);
    await recordHealthImport();
    return r;
  });
}

async function runGoogleHealthImport(
  userId: string | null,
  opts: { days?: number } = {}
): Promise<GoogleHealthImportResult> {
  const days = opts.days ?? 90;
  const out: GoogleHealthImportResult = {
    cardio: 0, sleep: 0, restingHr: 0, hrv: 0, weight: 0, bodyFat: 0, hydration: 0, food: 0,
  };
  console.log('[dbg-ghealth] import start');
  if (!(await isGoogleHealthConnected())) {
    console.log('[dbg-ghealth] not connected - bailing');
    return out;
  }

  // Workouts - skip when another source already logged the same session.
  // Each section fails soft: one bad reader must not kill the rest.
  try {
    for (const ex of await getGoogleExercises(days)) {
      const activity = googleExerciseToCardio(ex.exerciseType);
      if (await hasCardioNear(ex.startIso, 600, activity)) continue;
      const inserted = await importCardio({
        external_id: `ghealth:${ex.id}`,
        activity,
        distance_m: ex.distanceM,
        duration_seconds: ex.durationS,
        avg_hr: ex.avgHr,
        max_hr: null,
        calories: ex.calories,
        source: 'googlehealth',
        started_at: ex.startIso,
        notes: ex.displayName !== ex.exerciseType ? ex.displayName : undefined,
        user_id: userId,
      });
      if (inserted) out.cardio++;
    }
  } catch (e) {
    console.warn('[ghealth] exercise import failed', e);
  }

  // Resting HR - one row per day
  try {
    const restingDays = await existingDays('resting_hr');
    for (const r of await getGoogleRestingHR(30)) {
      if (restingDays.has(r.date)) continue;
      restingDays.add(r.date);
      await logMeasurement({
        metric_type: 'resting_hr',
        value: r.bpm,
        logged_at: new Date(`${r.date}T12:00:00`).toISOString(),
        user_id: userId,
      });
      out.restingHr++;
    }
  } catch (e) {
    console.warn('[ghealth] resting HR import failed', e);
  }

  // HRV - one row per day
  try {
    const hrvDays = await existingDays('hrv');
    for (const r of await getGoogleHRV(30)) {
      if (hrvDays.has(r.date)) continue;
      hrvDays.add(r.date);
      await logMeasurement({
        metric_type: 'hrv',
        value: r.ms,
        logged_at: new Date(`${r.date}T12:00:00`).toISOString(),
        user_id: userId,
      });
      out.hrv++;
    }
  } catch (e) {
    console.warn('[ghealth] HRV import failed', e);
  }

  // Sleep - one row per wake day
  try {
    const sleepDays = await existingDays('sleep_hours');
    for (const s of await getGoogleSleep(14)) {
      if (sleepDays.has(s.date)) continue;
      sleepDays.add(s.date);
      await logMeasurement({
        metric_type: 'sleep_hours',
        value: s.hours,
        logged_at: s.loggedAt,
        user_id: userId,
      });
      out.sleep++;
    }
  } catch (e) {
    console.warn('[ghealth] sleep import failed', e);
  }

  // Weight - one row per day (manual entries / Aria scale)
  try {
    const weightDays = await existingDays('weight');
    for (const w of await getGoogleWeights(days)) {
      if (weightDays.has(w.date)) continue;
      weightDays.add(w.date);
      await logMeasurement({
        metric_type: 'weight',
        value: w.kg,
        logged_at: w.loggedAt,
        user_id: userId,
      });
      out.weight++;
    }
  } catch (e) {
    console.warn('[ghealth] weight import failed', e);
  }

  // Body fat - Aria scale readings, one per day, manual entries win
  try {
    const bfDays = await existingDays('body_fat');
    for (const b of await getGoogleBodyFat(90)) {
      const day = localDay(new Date(b.at));
      if (bfDays.has(day)) continue;
      bfDays.add(day);
      await logMeasurement({
        metric_type: 'body_fat',
        value: b.pct,
        logged_at: b.at,
        user_id: userId,
      });
      out.bodyFat++;
    }
  } catch (e) {
    console.warn('[ghealth] body fat import failed', e);
  }

  // Hydration - Fitbit water logs land as liquid_entries rows. hasLiquidNear
  // skips drinks already imported via HealthKit (same glass, other source).
  try {
    for (const h of await getGoogleHydration(14)) {
      const ext = `ghealth:${h.id}`;
      if (await hasLiquidExternalId(ext)) continue;
      if (await hasLiquidNear(h.day, h.ml, ext)) continue;
      await logLiquid({
        amount_ml: h.ml,
        kind: 'water',
        name: 'Water',
        logged_on: h.day,
        external_id: ext,
        user_id: userId,
      });
      out.hydration++;
    }
  } catch (e) {
    console.warn('[ghealth] hydration import failed', e);
  }

  // Food - Fitbit meal logs land as nutrition_entries rows
  try {
    for (const f of await getGoogleFoodLogs(30)) {
      const ext = `ghealth:${f.id}`;
      if (await hasFoodExternalId(ext)) continue;
      await logFood({
        name: f.name,
        calories: f.kcal,
        protein_g: f.proteinG,
        carbs_g: f.carbsG,
        fat_g: f.fatG,
        serving: f.mealType ? f.mealType.toLowerCase() : null,
        source: 'googlehealth',
        external_id: ext,
        logged_on: f.day,
        user_id: userId,
      });
      out.food++;
    }
  } catch (e) {
    console.warn('[ghealth] food import failed', e);
  }

  // Retro per-set HR backfill: the Fitbit→cloud sync often lags past workout
  // finalize, so on each import sweep recent workouts for sets still missing
  // avg_hr and bin the now-arrived intraday samples against each set's
  // completion time. Capped at 5 workouts/sweep to respect rate limits.
  try {
    const sinceIso = new Date(Date.now() - 48 * 3600_000).toISOString();
    const missing = await setsMissingHr(sinceIso);
    const byWorkout = new Map<string, typeof missing>();
    for (const m of missing) {
      const list = byWorkout.get(m.workout_id) ?? [];
      list.push(m);
      byWorkout.set(m.workout_id, list);
    }
    for (const sets of [...byWorkout.values()].slice(0, 5)) {
      const w = sets[0];
      const samples = await getGoogleIntradayHR(w.workout_start, w.workout_end);
      if (samples.length === 0) continue;
      for (const s of sets) {
        const end = new Date(s.set_completed_at).getTime();
        const win = samples.filter((x) => x.at > end - 90_000 && x.at <= end + 15_000);
        if (win.length > 0) {
          await setAvgHr(s.set_id, win.reduce((a, x) => a + x.bpm, 0) / win.length);
        }
      }
    }
  } catch (e) {
    console.warn('[ghealth] set HR backfill failed', e);
  }

  console.log('[dbg-ghealth] import done:', JSON.stringify(out));
  return out;
}
