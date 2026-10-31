import { Platform } from 'react-native';

/**
 * Health platform integration.
 *   iOS     → Apple Health / HealthKit via react-native-health
 *   Android → Health Connect via react-native-health-connect
 *
 * All native calls are guarded so the app still runs in Expo Go / simulators
 * where the native module isn't available.
 */

// Static import - dynamic import() doesn't work reliably with RN native modules
import { NativeModules } from 'react-native';
import AppleHealthKitLib from 'react-native-health';
import * as HealthConnect from 'react-native-health-connect';

// react-native-health's index.js builds its export via
// Object.assign({}, NativeModules.AppleHealthKit, {Constants}) - under the New
// Architecture the module is a lazy proxy whose methods aren't enumerable, so
// the copied object loses every native method. Use the raw module for calls
// and the package's Constants object for enums.
const AppleHealthKit = (NativeModules as Record<string, any>).AppleHealthKit;
const HKConstants = (AppleHealthKitLib as { Constants?: any })?.Constants;

import { hcExerciseToCardio, hkActivityToCardio, type CardioActivity } from './cardio';

type HealthKit = typeof AppleHealthKit;

export type HealthStatus = 'unavailable' | 'notauthorized' | 'authorized';

export interface HealthAuthResult {
  status: HealthStatus;
  error?: string;
}

const HC_RECORDS = [
  'ExerciseSession',
  'Distance',
  'HeartRate',
  'SleepSession',
  'RestingHeartRate',
  'Weight',
  'Steps',
  'ActiveCaloriesBurned',
  'TotalCaloriesBurned',
  'FloorsClimbed',
  'HeartRateVariabilityRmssd',
  'Vo2Max',
  'Hydration',
  'BodyFat',
] as const;

/** Generic promisified call into the raw AppleHealthKit module. */
function hkCall<T>(method: string, options: Record<string, unknown>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const fn = AppleHealthKit?.[method];
      if (typeof fn !== 'function') {
        resolve(null);
        return;
      }
      fn(options, (err: unknown, res: T) => resolve(err ? null : res));
    } catch {
      resolve(null);
    }
  });
}

/** Check if a health platform is available on this device. */
export async function isHealthAvailable(): Promise<boolean> {
  if (Platform.OS === 'android') {
    try {
      return (await HealthConnect.getSdkStatus()) === 3; // SDK_AVAILABLE
    } catch {
      return false;
    }
  }
  if (Platform.OS !== 'ios') return false;
  return new Promise((resolve) => {
    try {
      if (!AppleHealthKit || typeof AppleHealthKit.isAvailable !== 'function') {
        resolve(false);
        return;
      }
      AppleHealthKit.isAvailable((err: unknown, available: boolean) => {
        resolve(!err && available);
      });
    } catch {
      resolve(false);
    }
  });
}

/** Request health authorization for weight, workouts, HR, sleep and energy data. */
export async function requestHealthAuth(): Promise<HealthAuthResult> {
  if (Platform.OS === 'android') {
    try {
      const ok = await HealthConnect.initialize();
      if (!ok) return { status: 'unavailable', error: 'Health Connect SDK not available' };
      const granted = await HealthConnect.requestPermission(
        HC_RECORDS.map((r) => ({ accessType: 'read', recordType: r }))
      );
      return { status: granted.length > 0 ? 'authorized' : 'notauthorized' };
    } catch (e) {
      return { status: 'notauthorized', error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (Platform.OS !== 'ios') return { status: 'unavailable' };

  const perms = {
    permissions: {
      read: [
        HKConstants.Permissions.Weight,
        HKConstants.Permissions.BodyMass,
        HKConstants.Permissions.ActiveEnergyBurned,
        HKConstants.Permissions.BasalEnergyBurned,
        HKConstants.Permissions.StepCount,
        HKConstants.Permissions.Workout,
        HKConstants.Permissions.Height,
        HKConstants.Permissions.HeartRate,
        HKConstants.Permissions.RestingHeartRate,
        HKConstants.Permissions.SleepAnalysis,
        HKConstants.Permissions.DistanceWalkingRunning,
        HKConstants.Permissions.DistanceCycling,
        HKConstants.Permissions.FlightsClimbed,
        HKConstants.Permissions.AppleExerciseTime,
        HKConstants.Permissions.AppleStandTime,
        HKConstants.Permissions.HeartRateVariability,
        HKConstants.Permissions.Vo2Max,
        HKConstants.Permissions.Water,
        HKConstants.Permissions.BodyFatPercentage,
        HKConstants.Permissions.DateOfBirth,
        HKConstants.Permissions.BiologicalSex,
      ],
      write: [
        HKConstants.Permissions.Weight,
        HKConstants.Permissions.Workout,
      ],
    },
  };

  return new Promise((resolve) => {
    try {
      if (!AppleHealthKit || typeof AppleHealthKit.initHealthKit !== 'function') {
        resolve({ status: 'unavailable', error: 'AppleHealthKit native module missing' });
        return;
      }
      AppleHealthKit.initHealthKit(perms, (err: string) => {
        if (err) {
          resolve({ status: 'notauthorized', error: String(err) });
          return;
        }
        resolve({ status: 'authorized' });
      });
    } catch (e) {
      resolve({ status: 'notauthorized', error: e instanceof Error ? e.message : String(e) });
    }
  });
}

/** Debug probe: HealthKit auth status (0=notDetermined, 1=denied, 2=authorized).
 *  Read types always report notDetermined by design; WRITE types report truthfully. */
export async function getHKAuthStatus(): Promise<void> {
  if (Platform.OS !== 'ios' || typeof AppleHealthKit?.getAuthStatus !== 'function') return;
  try {
    AppleHealthKit.getAuthStatus(
      {
        permissions: {
          read: [HKConstants.Permissions.Workout, HKConstants.Permissions.RestingHeartRate, HKConstants.Permissions.SleepAnalysis],
          write: [HKConstants.Permissions.Workout, HKConstants.Permissions.Weight],
        },
      },
      (err: unknown, res: unknown) =>
        console.log('[dbg-hk] authStatus err:', JSON.stringify(err), 'res:', JSON.stringify(res))
    );
  } catch (e) {
    console.log('[dbg-hk] authStatus threw', e);
  }
}

/** Get the latest weight sample from Apple Health (in kg). */
export async function getLatestWeightKg(): Promise<{ value: number; date: string } | null> {
  if (Platform.OS !== 'ios') return null;

  const startDate = new Date(Date.now() - 365 * 86400000).toISOString();
  return new Promise((resolve) => {
    try {
      AppleHealthKit.getWeightSamples(
        { unit: HKConstants.Units.gram, startDate, ascending: false, limit: 1 },
        (err: string, results: { value: number; startDate: string; endDate: string }[]) => {
          if (err || !results || results.length === 0) {
            resolve(null);
            return;
          }
          const sample = results[0];
          resolve({ value: sample.value / 1000, date: sample.startDate });
        }
      );
    } catch {
      resolve(null);
    }
  });
}

/** Write a weight sample to Apple Health (value in kg). */
export async function saveWeightToHealth(weightKg: number, date?: Date): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;

  const d = (date ?? new Date()).toISOString();
  return new Promise((resolve) => {
    try {
      AppleHealthKit.saveWeight(
        { value: weightKg * 1000, unit: HKConstants.Units.gram, startDate: d, endDate: d },
        (err: string) => resolve(!err)
      );
    } catch {
      resolve(false);
    }
  });
}

/** Get today's active energy burned (in kcal). */
export async function getActiveEnergyToday(): Promise<number> {
  if (Platform.OS !== 'ios') return 0;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return new Promise((resolve) => {
    try {
      AppleHealthKit.getActiveEnergyBurned(
        { startDate: start.toISOString(), endDate: new Date().toISOString(), unit: HKConstants.Units.calorie },
        (err: string, results: { value: number }[]) => {
          if (err || !results) {
            resolve(0);
            return;
          }
          resolve(results.reduce((sum, r) => sum + r.value, 0));
        }
      );
    } catch {
      resolve(0);
    }
  });
}

/** Get today's step count. */
export async function getStepsToday(): Promise<number> {
  if (Platform.OS !== 'ios') return 0;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return new Promise((resolve) => {
    try {
      AppleHealthKit.getStepCount(
        { startDate: start.toISOString(), endDate: new Date().toISOString() },
        (err: string, results: { value: number }) => {
          resolve(err || !results ? 0 : results.value);
        }
      );
    } catch {
      resolve(0);
    }
  });
}

// -- Import surfaces ----------------------------------------------------------

export interface HealthWorkout {
  externalId: string;
  activity: CardioActivity;
  distanceM: number | null;
  durationS: number;
  calories: number | null;
  startedAt: string;
  endAt: string;
}

const MILE_TO_M = 1609.34;

/** Recent health-platform workouts, normalized for cardio import. */
export async function getRecentWorkouts(days = 90): Promise<HealthWorkout[]> {
  const startDate = new Date(Date.now() - days * 86400000).toISOString();
  const endDate = new Date().toISOString();

  if (Platform.OS === 'android') {
    try {
      const res = await HealthConnect.readRecords('ExerciseSession', {
        timeRangeFilter: { operator: 'between', startTime: startDate, endTime: endDate },
      });
      const out: HealthWorkout[] = [];
      for (const r of res.records) {
        const activity = hcExerciseToCardio(r.exerciseType);
        const endAt = r.endTime;
        const startedAt = r.startTime;
        const durationS = Math.round(
          (new Date(endAt).getTime() - new Date(startedAt).getTime()) / 1000
        );
        let distanceM: number | null = null;
        try {
          const dist = await HealthConnect.readRecords('Distance', {
            timeRangeFilter: { operator: 'between', startTime: startedAt, endTime: endAt },
          });
          const m = dist.records.reduce((a, d) => a + (d.distance?.inMeters ?? 0), 0);
          if (m > 0) distanceM = m;
        } catch {
          // distance permission not granted - keep null
        }
        out.push({
          externalId: `hc:${r.metadata?.id ?? r.startTime}`,
          activity,
          distanceM,
          durationS,
          calories: null,
          startedAt,
          endAt,
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  if (Platform.OS !== 'ios') return [];
  return new Promise((resolve) => {
    try {
      AppleHealthKit.getAnchoredWorkouts(
        { startDate, endDate, type: HKConstants.Observers.Workout },
        (err: unknown, results: { data?: {
          id: string;
          activityName: string;
          distance: number; // miles
          duration: number; // seconds
          calories: number;
          start: string;
          end: string;
        }[] }) => {
          if (err || !results?.data) {
            console.log('[dbg-hk] getAnchoredWorkouts failed:', JSON.stringify(err), 'hasRes:', !!results);
            resolve([]);
            return;
          }
          console.log('[dbg-hk] getAnchoredWorkouts ok, rows:', results.data.length);
          resolve(
            results.data.map((w) => ({
              externalId: `hk:${w.id}`,
              activity: hkActivityToCardio(w.activityName),
              distanceM: w.distance > 0 ? w.distance * MILE_TO_M : null,
              durationS: Math.round(w.duration),
              calories: w.calories > 0 ? Math.round(w.calories) : null,
              startedAt: w.start,
              endAt: w.end,
            }))
          );
        }
      );
    } catch {
      resolve([]);
    }
  });
}

/** Timestamped HR samples in a window - powers per-set HR backfill. */
export async function getWorkoutHRSamples(
  startIso: string,
  endIso: string
): Promise<{ bpm: number; at: number }[]> {
  if (Platform.OS === 'android') {
    try {
      const res = await HealthConnect.readRecords('HeartRate', {
        timeRangeFilter: { operator: 'between', startTime: startIso, endTime: endIso },
      });
      return res.records.flatMap((r) =>
        r.samples.map((s) => ({ bpm: s.beatsPerMinute, at: new Date(s.time).getTime() }))
      );
    } catch {
      return [];
    }
  }
  if (Platform.OS !== 'ios') return [];
  return new Promise((resolve) => {
    try {
      AppleHealthKit.getHeartRateSamples(
        { startDate: startIso, endDate: endIso, ascending: true, limit: 2000 },
        (err: string, results: { value: number; startDate: string }[]) => {
          resolve(
            err || !results
              ? []
              : results.map((r) => ({ bpm: r.value, at: new Date(r.startDate).getTime() }))
          );
        }
      );
    } catch {
      resolve([]);
    }
  });
}

/** HR samples (bpm) recorded during a workout window - feeds zone splits. */
export async function getWorkoutHeartRates(startIso: string, endIso: string): Promise<number[]> {
  return (await getWorkoutHRSamples(startIso, endIso)).map((s) => s.bpm);
}

/** Daily HRV readings (ms RMSSD) for the last `days` days. */
export async function getHRV(days = 30): Promise<{ date: string; ms: number }[]> {
  const startDate = new Date(Date.now() - days * 86400000).toISOString();
  const endDate = new Date().toISOString();

  if (Platform.OS === 'android') {
    try {
      const res = await HealthConnect.readRecords('HeartRateVariabilityRmssd', {
        timeRangeFilter: { operator: 'between', startTime: startDate, endTime: endDate },
      });
      return res.records.map((r) => ({ date: r.time, ms: Math.round(r.heartRateVariabilityMillis) }));
    } catch {
      return [];
    }
  }
  if (Platform.OS !== 'ios') return [];
  const rows = await hkCall<{ value: number; startDate: string }[]>(
    'getHeartRateVariabilitySamples',
    { startDate, endDate, ascending: false }
  );
  return (rows ?? []).map((r) => ({ date: r.startDate, ms: Math.round(r.value) }));
}

/** Daily resting heart-rate readings (bpm) for the last `days` days. */
export async function getRestingHeartRates(days = 30): Promise<{ date: string; bpm: number }[]> {
  const startDate = new Date(Date.now() - days * 86400000).toISOString();
  const endDate = new Date().toISOString();

  if (Platform.OS === 'android') {
    try {
      const res = await HealthConnect.readRecords('RestingHeartRate', {
        timeRangeFilter: { operator: 'between', startTime: startDate, endTime: endDate },
      });
      return res.records.map((r) => ({ date: r.time, bpm: Math.round(r.beatsPerMinute) }));
    } catch {
      return [];
    }
  }
  if (Platform.OS !== 'ios') return [];
  return new Promise((resolve) => {
    try {
      AppleHealthKit.getRestingHeartRateSamples(
        { startDate, endDate, ascending: false },
        (err: string, results: { value: number; startDate: string }[]) => {
          if (err || !results) {
            resolve([]);
            return;
          }
          resolve(results.map((r) => ({ date: r.startDate, bpm: Math.round(r.value) })));
        }
      );
    } catch {
      resolve([]);
    }
  });
}

/** Weight samples (kg) for the last `days` days - newest first on iOS. */
export async function getWeightHistory(days = 90): Promise<{ date: string; kg: number }[]> {
  const startDate = new Date(Date.now() - days * 86400000).toISOString();
  const endDate = new Date().toISOString();

  if (Platform.OS === 'android') {
    try {
      const res = await HealthConnect.readRecords('Weight', {
        timeRangeFilter: { operator: 'between', startTime: startDate, endTime: endDate },
      });
      return res.records
        .map((r) => ({ date: r.time, kg: Math.round(r.weight.inKilograms * 100) / 100 }))
        .filter((r) => r.kg > 0);
    } catch {
      return [];
    }
  }
  if (Platform.OS !== 'ios') return [];
  return new Promise((resolve) => {
    try {
      AppleHealthKit.getWeightSamples(
        { unit: HKConstants.Units.gram, startDate, endDate, ascending: false, limit: 500 },
        (err: string, results: { value: number; startDate: string }[]) => {
          if (err || !results) {
            resolve([]);
            return;
          }
          resolve(
            results
              .map((r) => ({ date: r.startDate, kg: Math.round((r.value / 1000) * 100) / 100 }))
              .filter((r) => r.kg > 0)
          );
        }
      );
    } catch {
      resolve([]);
    }
  });
}

/**
 * Apple Health characteristics - birth year, biological sex, latest height.
 * iOS only; Health Connect doesn't expose identity characteristics.
 */
export async function getHealthCharacteristics(): Promise<{
  birthYear: number | null;
  sex: 'male' | 'female' | null;
  heightCm: number | null;
}> {
  const out = { birthYear: null as number | null, sex: null as 'male' | 'female' | null, heightCm: null as number | null };
  if (Platform.OS !== 'ios') return out;

  const dob = await new Promise<{ value?: string; age?: number } | null>((resolve) => {
    try {
      (AppleHealthKit as any).getDateOfBirth({}, (err: string, r: { value?: string; age?: number }) => {
        resolve(err ? null : r);
      });
    } catch {
      resolve(null);
    }
  });
  if (dob?.value) {
    const year = new Date(dob.value).getFullYear();
    if (year > 1900 && year <= new Date().getFullYear()) out.birthYear = year;
  } else if (dob?.age) {
    out.birthYear = new Date().getFullYear() - dob.age;
  }

  const sexRes = await new Promise<{ value?: string } | null>((resolve) => {
    try {
      (AppleHealthKit as any).getBiologicalSex({}, (err: string, r: { value?: string }) => {
        resolve(err ? null : r);
      });
    } catch {
      resolve(null);
    }
  });
  const sv = sexRes?.value?.toLowerCase();
  if (sv === 'male' || sv === 'female') out.sex = sv;

  const h = await new Promise<{ value?: number } | null>((resolve) => {
    try {
      (AppleHealthKit as any).getLatestHeight(
        { unit: HKConstants.Units.meter },
        (err: string, r: { value?: number }) => resolve(err ? null : r)
      );
    } catch {
      resolve(null);
    }
  });
  if (h?.value && h.value > 0.5 && h.value < 2.6) {
    out.heightCm = Math.round(h.value * 1000) / 10;
  }

  return out;
}

/** Body-fat percentage samples for the last `days` days (smart scales etc.). */
export async function getBodyFatHistory(days = 90): Promise<{ date: string; pct: number }[]> {
  const startDate = new Date(Date.now() - days * 86400000).toISOString();
  const endDate = new Date().toISOString();

  if (Platform.OS === 'android') {
    try {
      const res = await HealthConnect.readRecords('BodyFat', {
        timeRangeFilter: { operator: 'between', startTime: startDate, endTime: endDate },
      });
      return res.records
        .map((r: any) => ({ date: r.time, pct: r.percentage?.inPercent ?? 0 }))
        .filter((r: any) => r.pct > 0 && r.pct <= 100);
    } catch {
      return [];
    }
  }
  if (Platform.OS !== 'ios') return [];
  return new Promise((resolve) => {
    try {
      (AppleHealthKit as any).getBodyFatPercentageSamples(
        { startDate, endDate, ascending: false, limit: 500 },
        (err: string, results: { value: number; startDate: string }[]) => {
          if (err || !results) {
            resolve([]);
            return;
          }
          resolve(
            results
              .map((r) => ({
                date: r.startDate,
                // HealthKit stores percent as a 0-1 fraction.
                pct: Math.round((r.value <= 1 ? r.value * 100 : r.value) * 10) / 10,
              }))
              .filter((r) => r.pct > 0 && r.pct <= 100)
          );
        }
      );
    } catch {
      resolve([]);
    }
  });
}

/** Dietary water samples for the last `days` days, with per-sample ids for dedupe. */
export async function getWaterHistory(days = 14): Promise<{ id: string; date: string; ml: number }[]> {
  const startDate = new Date(Date.now() - days * 86400000).toISOString();
  const endDate = new Date().toISOString();

  if (Platform.OS === 'android') {
    try {
      const res = await HealthConnect.readRecords('Hydration', {
        timeRangeFilter: { operator: 'between', startTime: startDate, endTime: endDate },
      });
      return res.records
        .map((r: any) => ({
          id: r.metadata?.id ?? r.startTime,
          date: r.startTime,
          ml: Math.round((r.volume?.inLiters ?? 0) * 1000),
        }))
        .filter((r: any) => r.ml > 0);
    } catch {
      return [];
    }
  }
  if (Platform.OS !== 'ios') return [];
  return new Promise((resolve) => {
    try {
      (AppleHealthKit as any).getWaterSamples(
        { startDate, endDate, ascending: false, limit: 1000 },
        (err: string, results: { id?: string; value: number; startDate: string }[]) => {
          if (err || !results) {
            resolve([]);
            return;
          }
          resolve(
            results
              .map((r, i) => ({
                id: r.id ?? `${r.startDate}:${i}`,
                date: r.startDate,
                ml: Math.round(r.value * 1000),
              }))
              .filter((r) => r.ml > 0)
          );
        }
      );
    } catch {
      resolve([]);
    }
  });
}

/** Hours asleep per night for the last `days` days, keyed by wake date. */
export async function getSleepHours(days = 14): Promise<{ date: string; hours: number }[]> {
  const startDate = new Date(Date.now() - days * 86400000).toISOString();
  const endDate = new Date().toISOString();

  if (Platform.OS === 'android') {
    try {
      const res = await HealthConnect.readRecords('SleepSession', {
        timeRangeFilter: { operator: 'between', startTime: startDate, endTime: endDate },
      });
      const ASLEEP_STAGES = new Set([2, 4, 5, 6]); // SLEEPING, LIGHT, DEEP, REM
      return res.records.map((r) => {
        let seconds: number;
        if (r.stages && r.stages.length > 0) {
          seconds = r.stages
            .filter((s) => ASLEEP_STAGES.has(s.stage))
            .reduce((a, s) => a + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 1000, 0);
        } else {
          seconds = (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 1000;
        }
        return { date: r.endTime, hours: Math.round((seconds / 3600) * 10) / 10 };
      });
    } catch {
      return [];
    }
  }

  if (Platform.OS !== 'ios') return [];
  return new Promise((resolve) => {
    try {
      AppleHealthKit.getSleepSamples(
        { startDate, endDate },
        (err: string, results: { value: unknown; startDate: string; endDate: string }[]) => {
          if (err || !results) {
            resolve([]);
            return;
          }
          // Sum asleep-stage durations per wake date (date the sample ends).
          const ASLEEP = new Set(['ASLEEP', 'CORE', 'DEEP', 'REM', 'UNSPECIFIED']);
          const byDay = new Map<string, number>();
          for (const s of results) {
            if (!ASLEEP.has(String(s.value))) continue;
            const day = s.endDate.slice(0, 10);
            const sec = (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 1000;
            byDay.set(day, (byDay.get(day) ?? 0) + sec);
          }
          resolve(
            [...byDay.entries()]
              .map(([day, sec]) => ({ date: `${day}T12:00:00.000Z`, hours: Math.round((sec / 3600) * 10) / 10 }))
              .filter((d) => d.hours > 0)
          );
        }
      );
    } catch {
      resolve([]);
    }
  });
}

/** Today's heart rate bucketed by hour (average bpm per hour). For the cardio
 * vitals chart - returns only hours that have samples. */
export async function getTodayHeartRate(): Promise<{ hour: number; bpm: number }[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startDate = start.toISOString();
  const endDate = new Date().toISOString();

  let samples: { time: string; bpm: number }[] = [];
  if (Platform.OS === 'android') {
    try {
      const res = await HealthConnect.readRecords('HeartRate', {
        timeRangeFilter: { operator: 'between', startTime: startDate, endTime: endDate },
      });
      samples = res.records.flatMap((r) =>
        r.samples.map((s) => ({ time: s.time, bpm: s.beatsPerMinute }))
      );
    } catch {
      return [];
    }
  } else if (Platform.OS === 'ios') {
    samples = await new Promise<{ time: string; bpm: number }[]>((resolve) => {
      try {
        AppleHealthKit.getHeartRateSamples(
          { startDate, endDate, ascending: true, limit: 5000 },
          (err: string, results: { value: number; startDate: string }[]) => {
            if (err || !results) {
              resolve([]);
              return;
            }
            resolve(results.map((r) => ({ time: r.startDate, bpm: r.value })));
          }
        );
      } catch {
        resolve([]);
      }
    });
  } else {
    return [];
  }

  const buckets = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    if (!(s.bpm > 30 && s.bpm < 220)) continue;
    const h = new Date(s.time).getHours();
    const b = buckets.get(h) ?? { sum: 0, n: 0 };
    b.sum += s.bpm;
    b.n++;
    buckets.set(h, b);
  }
  return [...buckets.entries()]
    .map(([hour, b]) => ({ hour, bpm: Math.round(b.sum / b.n) }))
    .sort((a, b) => a.hour - b.hour);
}

// -- Daily activity series ---------------------------------------------------

export interface HealthDay {
  date: string; // YYYY-MM-DD
  steps: number;
  distanceM: number;
  activeKcal: number;
  basalKcal: number;
  exerciseMin: number;
}

export interface HealthToday extends HealthDay {
  standHours: number;
  flights: number;
  hrvMs: number | null;
  vo2max: number | null;
}

const DAY_MIN = 1440;

/** Local YYYY-MM-DD key - HealthKit returns local-tz ISO strings, so day buckets
 * must be keyed by local date, not UTC. */
function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyDays(days: number, start: Date): HealthDay[] {
  const out: HealthDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push({ date: localDayKey(d), steps: 0, distanceM: 0, activeKcal: 0, basalKcal: 0, exerciseMin: 0 });
  }
  return out;
}

/** Per-day steps / distance / active+basal kcal / exercise minutes, oldest → newest. */
export async function getDailyActivity(days = 7): Promise<HealthDay[]> {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  const startDate = start.toISOString();
  const endDate = now.toISOString();
  const byDay = new Map(emptyDays(days, start).map((d) => [d.date, d]));

  if (Platform.OS === 'android') {
    try {
      const tr = { timeRangeFilter: { operator: 'between' as const, startTime: startDate, endTime: endDate } };
      const [steps, dist, active, total] = await Promise.all([
        HealthConnect.readRecords('Steps', tr).catch(() => ({ records: [] as never[] })),
        HealthConnect.readRecords('Distance', tr).catch(() => ({ records: [] as never[] })),
        HealthConnect.readRecords('ActiveCaloriesBurned', tr).catch(() => ({ records: [] as never[] })),
        HealthConnect.readRecords('TotalCaloriesBurned', tr).catch(() => ({ records: [] as never[] })),
      ]);
      // Health Connect startTime is a UTC instant - bucket by the LOCAL day,
      // same convention as the iOS path and byDay's localDayKey labels.
      const day = (iso: string) => byDay.get(localDayKey(new Date(iso)));
      for (const r of steps.records) {
        const d = day(r.startTime);
        if (d) d.steps += r.count;
      }
      for (const r of dist.records) {
        const d = day(r.startTime);
        if (d) d.distanceM += r.distance?.inMeters ?? 0;
      }
      for (const r of active.records) {
        const d = day(r.startTime);
        if (d) d.activeKcal += r.energy?.inKilocalories ?? 0;
      }
      for (const r of total.records) {
        const d = day(r.startTime);
        if (d) d.basalKcal += r.energy?.inKilocalories ?? 0;
      }
      for (const d of byDay.values()) {
        d.steps = Math.round(d.steps);
        d.activeKcal = Math.round(d.activeKcal);
        d.basalKcal = Math.max(0, Math.round(d.basalKcal - d.activeKcal));
      }
      return [...byDay.values()];
    } catch {
      return [...byDay.values()];
    }
  }

  if (Platform.OS !== 'ios') return [...byDay.values()];

  const opts = { startDate, endDate, ascending: true, period: DAY_MIN };
  type Bucket = { value: number; startDate: string };
  const [steps, dist, active, basal, exercise] = await Promise.all([
    hkCall<Bucket[]>('getDailyStepCountSamples', opts),
    hkCall<Bucket[]>('getDailyDistanceWalkingRunningSamples', { ...opts, unit: 'meter' }),
    hkCall<Bucket[]>('getActiveEnergyBurned', { ...opts, unit: 'kilocalorie' }),
    hkCall<Bucket[]>('getBasalEnergyBurned', { ...opts, unit: 'kilocalorie' }),
    hkCall<Bucket[]>('getAppleExerciseTime', { ...opts, unit: 'minute' }),
  ]);
  const fill = (rows: Bucket[] | null, key: keyof Omit<HealthDay, 'date'>) => {
    for (const r of rows ?? []) {
      const d = byDay.get(r.startDate.slice(0, 10));
      if (d) d[key] += r.value;
    }
  };
  fill(steps, 'steps');
  fill(dist, 'distanceM');
  fill(active, 'activeKcal');
  fill(basal, 'basalKcal');
  fill(exercise, 'exerciseMin');
  for (const d of byDay.values()) {
    d.steps = Math.round(d.steps);
    d.activeKcal = Math.round(d.activeKcal);
    d.basalKcal = Math.round(d.basalKcal);
    d.exerciseMin = Math.round(d.exerciseMin);
  }
  return [...byDay.values()];
}

/** Today's activity snapshot + extra vitals (stand, flights, HRV, VO2 max). */
export async function getHealthToday(): Promise<HealthToday | null> {
  const [today] = await getDailyActivity(1).then((d) => d.slice(-1));
  const base: HealthToday = {
    ...(today ?? { date: '', steps: 0, distanceM: 0, activeKcal: 0, basalKcal: 0, exerciseMin: 0 }),
    standHours: 0,
    flights: 0,
    hrvMs: null,
    vo2max: null,
  };

  if (Platform.OS === 'android') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const tr = { timeRangeFilter: { operator: 'between' as const, startTime: start.toISOString(), endTime: new Date().toISOString() } };
    try {
      const [floors, hrv, vo2] = await Promise.all([
        HealthConnect.readRecords('FloorsClimbed', tr).catch(() => ({ records: [] as never[] })),
        HealthConnect.readRecords('HeartRateVariabilityRmssd', {
          timeRangeFilter: { operator: 'between' as const, startTime: new Date(Date.now() - 3 * 86400000).toISOString(), endTime: new Date().toISOString() },
        }).catch(() => ({ records: [] as never[] })),
        HealthConnect.readRecords('Vo2Max', tr).catch(() => ({ records: [] as never[] })),
      ]);
      base.flights = Math.round(floors.records.reduce((a, r) => a + r.floors, 0));
      const lastHrv = hrv.records[hrv.records.length - 1];
      if (lastHrv) base.hrvMs = Math.round(lastHrv.heartRateVariabilityMillis);
      const lastVo2 = vo2.records[vo2.records.length - 1];
      if (lastVo2) base.vo2max = Math.round(lastVo2.vo2MillilitersPerMinuteKilogram * 10) / 10;
    } catch {
      // partial data is fine
    }
    return base;
  }

  if (Platform.OS !== 'ios') return null;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startDate = start.toISOString();
  const endDate = new Date().toISOString();

  const [stand, flights, hrv, vo2] = await Promise.all([
    hkCall<{ value: number }[]>('getAppleStandTime', { startDate, endDate, period: DAY_MIN, unit: 'count' }),
    hkCall<{ value: number }>('getFlightsClimbed', { date: startDate }),
    hkCall<{ value: number; startDate: string }[]>('getHeartRateVariabilitySamples', {
      startDate: new Date(Date.now() - 3 * 86400000).toISOString(),
      endDate,
      ascending: false,
      limit: 1,
    }),
    hkCall<{ value: number; startDate: string }[]>('getVo2MaxSamples', {
      startDate: new Date(Date.now() - 180 * 86400000).toISOString(),
      endDate,
      ascending: false,
      limit: 1,
    }),
  ]);

  if (stand?.length) base.standHours = Math.round(stand.reduce((a, s) => a + s.value, 0));
  if (flights) base.flights = Math.round(flights.value);
  if (hrv?.length) base.hrvMs = Math.round(hrv[0].value);
  if (vo2?.length) base.vo2max = Math.round(vo2[0].value * 10) / 10;
  return base;
}
