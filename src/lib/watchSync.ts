import { EventEmitter, requireNativeModule } from 'expo-modules-core';
import { AppState, Platform } from 'react-native';

import { hasCardioNear, logCardio } from '@/db/repo/cardio';
import { listExercises } from '@/db/repo/exercises';
import { all } from '@/db/repo/helpers';
import {
    liquidHistory,
    liquidTargetMl,
    liquidTotalsForDay,
    listLiquidsForDay,
    logLiquid,
} from '@/db/repo/liquids';
import { latestWeightKg } from '@/db/repo/measurements';
import {
    calorieHistory,
    dayTotals,
    listFoodForDay,
    logFood,
} from '@/db/repo/nutrition';
import { listRoutines } from '@/db/repo/routines';
import { listHistory, weekVolumeKg, workoutsThisWeek } from '@/db/repo/workouts';
import { ageFromBirthYear, bmr, calorieTarget, tdee } from '@/lib/body';
import { ACTIVITIES, distanceUnitFor, formatDistance, type CardioActivity } from '@/lib/cardio';
import { getExerciseImageUrl } from '@/lib/exerciseImages';
import { lookupBarcode } from '@/lib/foodLookup';
import { displayWeight, formatDuration, formatRecord, formatVolume } from '@/lib/format';
import { getDailyActivity, getHealthToday } from '@/lib/health';
import { kgToLbs, lbsToKg } from '@/lib/plates';
import { parseServing } from '@/lib/servingUnits';
import { useActiveWorkout, type ExerciseBlock, type LiveSet } from '@/store/activeWorkout';
import { notify } from '@/store/notify';
import { useSettings } from '@/store/settings';

interface WatchSyncNative {
  pushContext(json: string): void;
  sendToWatch(json: string): void;
  isReachable(): boolean;
}

const mod: WatchSyncNative | null =
  Platform.OS === 'ios' ? requireNativeModule<WatchSyncNative>('WatchSync') : null;

/** Mirrors WatchSnapshot in targets/watch/WatchSessionManager.swift. */
interface WatchSnapshot {
  v: number;
  today: {
    waterMl: number;
    waterTargetMl: number;
    kcal: number;
    kcalTarget: number;
    steps: number;
    stepsTarget: number;
  };
  routines: { id: string; name: string }[];
  /** Display unit for all weight values in this snapshot. */
  unit: 'kg' | 'lbs';
  /** Exercise picker catalog - favourites first. Weight values are display units. */
  exercises: { id: string; name: string; muscle: string; tt: string; img?: string }[];
  recentPRs: { id: string; exercise: string; label: string; when: string }[];
  stats: { label: string; value: string }[];
  lastWorkout?: { title: string; when: string; detail: string };
  /** One-shot reply to a typed barcode lookup, piggybacked on a push so old
   *  native builds without `sendToWatch` still deliver it. */
  barcodeResult?: {
    ok: boolean;
    kind: string;
    barcode: string;
    name?: string;
    brand?: string | null;
    serving?: string | null;
    kcal?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
    isDrink?: boolean;
  };
  /** Depth for the ring-tap detail pages. Optional - older watches decode
   *  without it. `d` is a single-letter weekday label, weeks oldest→newest. */
  detail?: {
    hydration: {
      targetMl: number;
      week: { d: string; v: number }[];
      entries: { name: string; ml: number }[];
    };
    nutrition: {
      protein: number;
      carbs: number;
      fat: number;
      week: { d: string; v: number }[];
      entries: { name: string; kcal: number }[];
    };
    activity?: {
      distM: number;
      activeKcal: number;
      exerciseMin: number;
      week: { d: string; v: number }[];
    };
  };
  workout?: {
    active: boolean;
    title: string;
    /** Session clock: watch renders elapsed = (pausedAtMs ?? now) - startedAtMs - pausedAccumMs. */
    startedAtMs: number;
    pausedAtMs?: number | null;
    pausedAccumMs: number;
    restEndsAt?: number;
    restLabel?: string;
    restDurationSec?: number;
    /** Frozen remainder when paused mid-rest (ms). */
    restRemainingMs?: number;
    sets: {
      id: string;
      blockKey: string;
      exercise: string;
      /** Thumbnail URL for the exercise, when one exists. */
      img?: string;
      /** Tracking type - decides which fields the watch edits. */
      tt: string;
      label: string;
      /** Display-unit values for watch steppers (null = unset). */
      w: number | null;
      reps: number | null;
      dur: number | null;
      dist: number | null;
      done: boolean;
    }[];
  };
}

/** One-line summary of a set's fields, matching the phone's row layout. */
function setLabel(s: LiveSet, block: ExerciseBlock, unit: 'kg' | 'lbs'): string {
  const w = s.weightKg ?? s.ghostWeightKg;
  const r = s.reps ?? s.ghostReps;
  const dur = s.durationSeconds;
  const dist = s.distanceM;
  const wText = w != null ? displayWeight(w, unit) : '-';
  const bwPrefix = block.equipment === 'bodyweight' && w != null ? '+' : '';
  switch (block.trackingType) {
    case 'cardio': {
      const parts = [dur != null ? formatDuration(dur) : '-'];
      if (dist != null) parts.push(formatDistance(dist, distanceUnitFor(unit)));
      return parts.join(' · ');
    }
    case 'hold':
      return dur != null ? formatDuration(dur) : '-';
    case 'carry': {
      const parts = [`${wText}${unit}`];
      if (dist != null) parts.push(formatDistance(dist, distanceUnitFor(unit)));
      else if (dur != null) parts.push(formatDuration(dur));
      return parts.join(' · ');
    }
    default:
      return `${bwPrefix}${wText}${unit} × ${r ?? '-'}`;
  }
}

/** "2h ago" / "3d ago" - compact relative time for watch rows. */
function ago(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}

async function recentPRs(unit: 'kg' | 'lbs') {
  const rows = await all<{ id: string; name: string; record_type: string; value: number; achieved_at: string }>(
    `SELECT pr.id, e.name, pr.record_type, pr.value, pr.achieved_at
       FROM personal_records pr JOIN exercises e ON e.id = pr.exercise_id
      WHERE pr.deleted_at IS NULL
      ORDER BY pr.achieved_at DESC LIMIT 6`
  );
  return rows.map((r) => ({
    id: r.id,
    exercise: r.name,
    label: formatRecord(r.record_type, r.value, unit),
    when: ago(r.achieved_at),
  }));
}

/** "2026-09-24" → single-letter weekday for watch week charts. */
const DAY_LETTERS = 'SMTWTFS';
function dayLetter(isoDay: string): string {
  return DAY_LETTERS[new Date(`${isoDay}T00:00:00`).getDay()] ?? '?';
}

async function buildSnapshot(): Promise<WatchSnapshot> {
  const s = useSettings.getState();
  const [
    water, food, weightKg, health, routines, prs, history, weekSessions,
    weekVol, exercises, waterWeek, waterEntries, kcalWeek, foodEntries, activityWeek,
  ] = await Promise.all([
    liquidTotalsForDay(),
    dayTotals(),
    latestWeightKg(),
    s.health_connected ? getHealthToday().catch(() => null) : Promise.resolve(null),
    listRoutines().catch(() => []),
    recentPRs(s.weight_unit).catch(() => []),
    listHistory(1).catch(() => []),
    workoutsThisWeek().catch(() => 0),
    weekVolumeKg().catch(() => 0),
    listExercises({ sort: 'favourites' }).catch(() => []),
    liquidHistory(7).catch((): { day: string; amount_ml: number }[] => []),
    listLiquidsForDay().catch((): import('@/db/repo/liquids').LiquidEntry[] => []),
    calorieHistory(7).catch((): { day: string; calories: number }[] => []),
    listFoodForDay().catch((): import('@/lib/types').NutritionEntry[] => []),
    s.health_connected
      ? getDailyActivity(7).catch((): import('@/lib/health').HealthDay[] => [])
      : Promise.resolve([]),
  ]);

  const age = ageFromBirthYear(s.birth_year);
  const bmrV =
    weightKg != null && s.height_cm != null && age != null && s.sex != null
      ? bmr(weightKg, s.height_cm, age, s.sex)
      : null;
  const kcalTarget =
    s.calorie_override ?? (bmrV != null ? calorieTarget(tdee(bmrV, s.activity_level), s.goal) : 0);

  const { workoutId, title, blocks, rest, startedAt, pausedAtMs, pausedAccumMs } = useActiveWorkout.getState();
  const lbs = s.weight_unit === 'lbs';
  const distDiv = lbs ? 1609.344 : 1000;
  const imgByExercise = new Map(
    exercises.map((e) => [e.id, getExerciseImageUrl(e.id, 0, e.github_image_id) ?? undefined])
  );
  let workout: WatchSnapshot['workout'];
  if (workoutId) {
    workout = {
      active: true,
      title,
      startedAtMs: startedAt ?? Date.now(),
      pausedAtMs,
      pausedAccumMs,
      restEndsAt: rest?.endsAt,
      restLabel: rest?.label,
      restDurationSec: rest?.durationSec,
      restRemainingMs: rest?.remainingMs,
      sets: blocks.flatMap((b) =>
        b.sets.map((st) => ({
          id: st.id,
          blockKey: b.key,
          exercise: b.name,
          img: imgByExercise.get(b.exerciseId),
          tt: b.trackingType,
          label: setLabel(st, b, s.weight_unit),
          w: st.weightKg != null ? (lbs ? kgToLbs(st.weightKg) : st.weightKg) : null,
          reps: st.reps ?? st.ghostReps,
          dur: st.durationSeconds,
          dist: st.distanceM != null ? st.distanceM / distDiv : null,
          done: st.isCompleted,
        }))
      ),
    };
  }

  const last = history[0];
  const stats: WatchSnapshot['stats'] = [
    { label: 'Sessions', value: `${weekSessions} this week` },
    { label: 'Volume', value: `${formatVolume(weekVol, s.weight_unit)} ${s.weight_unit}` },
  ];
  if (weightKg != null) {
    stats.push({ label: 'Weight', value: `${displayWeight(weightKg, s.weight_unit)} ${s.weight_unit}` });
  }

  return {
    v: 1,
    today: {
      waterMl: Math.round(water.amount_ml),
      waterTargetMl: Math.round(liquidTargetMl(weightKg, s.water_target_ml)),
      kcal: Math.round(food.calories),
      kcalTarget: Math.round(kcalTarget),
      steps: health?.steps ?? 0,
      stepsTarget: 10000,
    },
    routines: routines.slice(0, 12).map((r) => ({ id: r.id, name: r.title })),
    unit: s.weight_unit,
    exercises: exercises.slice(0, 150).map((e) => ({
      id: e.id,
      name: e.name,
      muscle: e.target_muscle,
      tt: e.tracking_type,
      img: imgByExercise.get(e.id),
    })),
    recentPRs: prs,
    stats,
    lastWorkout: last
      ? {
          title: last.title || 'Workout',
          when: ago(last.started_at),
          detail: `${last.set_count} sets · ${last.exercise_count} exercises${
            last.pr_count > 0 ? ` · ${last.pr_count} PRs` : ''
          }`,
        }
      : undefined,
    workout,
    detail: {
      hydration: {
        targetMl: Math.round(liquidTargetMl(weightKg, s.water_target_ml)),
        week: waterWeek.map((d) => ({ d: dayLetter(d.day), v: Math.round(d.amount_ml) })),
        entries: waterEntries.slice(0, 8).map((e) => ({
          name: e.name,
          ml: Math.round(e.amount_ml),
        })),
      },
      nutrition: {
        protein: Math.round(food.protein_g),
        carbs: Math.round(food.carbs_g),
        fat: Math.round(food.fat_g),
        week: kcalWeek.map((d) => ({ d: dayLetter(d.day), v: Math.round(d.calories) })),
        entries: foodEntries.slice(0, 8).map((e) => ({
          name: e.name,
          kcal: Math.round(e.calories),
        })),
      },
      ...(activityWeek.length > 0 && {
        activity: {
          distM: Math.round(activityWeek[activityWeek.length - 1]?.distanceM ?? 0),
          activeKcal: Math.round(activityWeek[activityWeek.length - 1]?.activeKcal ?? 0),
          exerciseMin: Math.round(activityWeek[activityWeek.length - 1]?.exerciseMin ?? 0),
          week: activityWeek.map((d) => ({ d: dayLetter(d.date), v: d.steps })),
        },
      }),
    },
  };
}

/** Barcode result queued for the next push - fallback channel for native
 *  builds that predate the `sendToWatch` module function. */
let pendingBarcodeResult: WatchSnapshot['barcodeResult'];

/** Push the latest snapshot to the watch (applicationContext - latest wins). */
export async function pushWatchSnapshot(): Promise<void> {
  if (!mod) return;
  try {
    const snap = await buildSnapshot();
    if (pendingBarcodeResult) {
      snap.barcodeResult = pendingBarcodeResult;
      pendingBarcodeResult = undefined;
    }
    mod.pushContext(JSON.stringify(snap));
  } catch {
    // watch unpaired or module missing - harmless
  }
}

function blockForSet(setId: string): ExerciseBlock | undefined {
  return useActiveWorkout.getState().blocks.find((b) => b.sets.some((s) => s.id === setId));
}

async function handleCommand(cmd: Record<string, unknown>): Promise<void> {
  const store = useActiveWorkout.getState();
  switch (cmd.cmd) {
    case 'logWater': {
      const ml = Number(cmd.ml);
      if (!Number.isFinite(ml) || ml <= 0 || ml > 2000) return;
      await logLiquid({ amount_ml: ml, kind: 'water' });
      notify('Water logged', { body: `${ml} ml from your watch`, tone: 'success' });
      break;
    }
    case 'completeSet':
    case 'uncompleteSet': {
      const block = blockForSet(String(cmd.setId ?? ''));
      if (!block) return;
      const setId = String(cmd.setId);
      if (cmd.cmd === 'completeSet') store.completeSet(block.key, setId);
      else store.uncompleteSet(block.key, setId);
      break;
    }
    /** Delta in display units - converted back to canonical kg/metres here. */
    case 'updateSet': {
      const setId = String(cmd.setId ?? '');
      const block = blockForSet(setId);
      if (!block) return;
      const field = String(cmd.field ?? '');
      const delta = Number(cmd.delta);
      if (!Number.isFinite(delta)) return;
      const unit = useSettings.getState().weight_unit;
      const lbs = unit === 'lbs';
      const set = block.sets.find((x) => x.id === setId);
      if (!set) return;
      if (field === 'w') {
        const cur = set.weightKg ?? set.ghostWeightKg ?? 0;
        const next = Math.max(0, cur + (lbs ? lbsToKg(delta) : delta));
        store.updateSet(block.key, setId, { weightKg: Math.round(next * 100) / 100 });
      } else if (field === 'reps') {
        const cur = set.reps ?? set.ghostReps ?? 0;
        store.updateSet(block.key, setId, { reps: Math.max(0, Math.round(cur + delta)) });
      } else if (field === 'dur') {
        const cur = set.durationSeconds ?? 0;
        store.updateSet(block.key, setId, { durationSeconds: Math.max(0, cur + delta) });
      } else if (field === 'dist') {
        const cur = set.distanceM ?? 0;
        const meters = lbs ? delta * 1609.344 : delta * 1000;
        store.updateSet(block.key, setId, { distanceM: Math.max(0, cur + meters) });
      }
      break;
    }
    case 'addExercise': {
      const exerciseId = String(cmd.exerciseId ?? '');
      if (exerciseId && store.workoutId) await store.addExercise(exerciseId);
      break;
    }
    /** Cardio activity orb tapped mid-workout: adds a cardio block whose
     *  sets the user then fills with time/distance like any other set. */
    case 'addCardioExercise': {
      const activity = String(cmd.activity ?? '');
      if (store.workoutId && (ACTIVITIES as string[]).includes(activity)) {
        await store.addCardioExercise(activity as CardioActivity);
      }
      break;
    }
    /** Finished cardio session from the watch. Mid-workout it lands as a
     *  completed cardio block; standalone it writes a cardio_sessions row -
     *  same as the /cardio/new form. dist arrives in display units. */
    case 'logCardio': {
      const activity = String(cmd.activity ?? '');
      if (!(ACTIVITIES as string[]).includes(activity)) return;
      const durationSeconds = Math.max(0, Math.round(Number(cmd.durationSec)));
      if (durationSeconds <= 0) return;
      const dist = Number(cmd.dist);
      const miles = useSettings.getState().weight_unit === 'lbs';
      const distanceM =
        Number.isFinite(dist) && dist > 0 ? dist * (miles ? 1609.344 : 1000) : null;
      const hr = Math.round(Number(cmd.avgHr));
      const avgHr = Number.isFinite(hr) && hr > 0 ? hr : null;
      if (store.workoutId) {
        await store.addCardioBlock({
          activity: activity as CardioActivity,
          distanceM,
          durationSeconds,
          avgHr,
        });
      } else {
        // WatchConnectivity retries queued messages - a redelivery of the
        // same session must not write a second row.
        if (!(await hasCardioNear(new Date().toISOString(), 120, activity as CardioActivity))) {
          await logCardio({
            activity: activity as CardioActivity,
            distance_m: distanceM,
            duration_seconds: durationSeconds,
            avg_hr: avgHr,
            user_id: useSettings.getState().supabase_user_id,
          });
        }
      }
      notify('Cardio logged', { body: 'From your watch', tone: 'success' });
      break;
    }
    case 'addSet': {
      const block = blockForSet(String(cmd.setId ?? ''));
      if (block) store.addSet(block.key);
      break;
    }
    case 'skipRest':
      store.skipRest();
      break;
    case 'togglePause':
      store.togglePause();
      break;
    case 'startWorkout':
      if (!store.workoutId) await store.startWorkout();
      break;
    case 'startRoutine': {
      const routineId = String(cmd.routineId ?? '');
      if (routineId && !store.workoutId) {
        await store.startWorkout({ routineId });
        notify('Workout started', { body: 'From your watch', tone: 'success' });
      }
      break;
    }
    /** Barcode typed on the watch - look it up and push the product back as
     *  a `barcodeResult` message the watch turns into a confirm card. */
    case 'lookupBarcode': {
      const code = String(cmd.code ?? '').replace(/\D/g, '');
      const kind = cmd.kind === 'drink' ? 'drink' : 'food';
      if (!code || !mod) return;
      const p = await lookupBarcode(code).catch(() => null);
      const result: WatchSnapshot['barcodeResult'] = p
        ? {
            ok: true,
            kind,
            barcode: p.barcode,
            name: p.name,
            brand: p.brand,
            serving: p.serving,
            kcal: p.calories,
            protein: p.protein_g,
            carbs: p.carbs_g,
            fat: p.fat_g,
            isDrink: p.is_drink,
          }
        : { ok: false, kind, barcode: code };
      // sendToWatch is instant but only exists on newer native builds; on
      // older ones the result rides inside the next snapshot push instead.
      if (typeof mod.sendToWatch === 'function') {
        mod.sendToWatch(JSON.stringify({ barcodeResult: result }));
      } else {
        pendingBarcodeResult = result;
        await pushWatchSnapshot();
      }
      return; // no other state changed - skip the usual snapshot push
    }
    /** Watch confirmed a scanned product. Foods log a nutrition row; drinks
     *  additionally shadow into liquid_entries (volume only, linked via
     *  nutrition_id) so hydration and kcal never double-count. */
    case 'logScanned': {
      const name = String(cmd.name ?? '').trim();
      if (!name) return;
      const userId = useSettings.getState().supabase_user_id;
      const isDrink = cmd.isDrink === true;
      const foodId = await logFood({
        name,
        calories: Number(cmd.kcal) || 0,
        protein_g: Number(cmd.protein) || 0,
        carbs_g: Number(cmd.carbs) || 0,
        fat_g: Number(cmd.fat) || 0,
        is_drink: isDrink,
        serving: cmd.serving ? String(cmd.serving) : null,
        barcode: cmd.barcode ? String(cmd.barcode) : null,
        source: 'barcode',
        user_id: userId,
      });
      if (isDrink) {
        const u = parseServing(cmd.serving ? String(cmd.serving) : null);
        const ml = u.basis === 'volume' ? Math.round(u.qty * u.mlPerUnit) : 330;
        const { drinkKind } = await import('@/lib/servingUnits');
        await logLiquid({
          amount_ml: ml,
          kind: drinkKind(name) as never,
          name,
          nutrition_id: foodId,
          user_id: userId,
        });
      }
      notify('Logged', { body: `${name} from your watch`, tone: 'success' });
      break;
    }
    case 'finishWorkout': {
      const summary = await store.finalize();
      if (summary) notify('Workout saved', { body: 'Finished from your watch', tone: 'success' });
      break;
    }
    case 'discardWorkout':
      await store.discard();
      break;
  }
  await pushWatchSnapshot();
}

/**
 * Start the phone↔watch pipe: pushes a fresh snapshot whenever the workout
 * store changes or the app foregrounds, and dispatches watch commands.
 * Call once from the root layout. Returns a teardown fn.
 */
export function initWatchSync(): () => void {
  if (!mod) return () => {};

  // The native proxy implements the emitter methods at runtime.
  type Events = { onCommand(e: { json: string }): void };
  const emitter = new EventEmitter<Events>(mod as never);
  const cmdSub = emitter.addListener('onCommand', (event) => {
    try {
      void handleCommand(JSON.parse(event.json) as Record<string, unknown>);
    } catch {
      // malformed payload - ignore
    }
  });

  const storeSub = useActiveWorkout.subscribe(() => {
    void pushWatchSnapshot();
  });
  const appSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void pushWatchSnapshot();
  });
  // Keeps today stats + rest countdown fresh even when no store fires.
  const interval = setInterval(() => void pushWatchSnapshot(), 60_000);

  void pushWatchSnapshot();

  return () => {
    cmdSub.remove();
    storeSub();
    appSub.remove();
    clearInterval(interval);
  };
}
