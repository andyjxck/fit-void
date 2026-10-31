import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { create } from 'zustand';

import { getDb } from '@/db/client';
import { logCardio } from '@/db/repo/cardio';
import { createExercise, getExercise, listExercises } from '@/db/repo/exercises';
import { softDelete } from '@/db/repo/helpers';
import { latestWeightKg } from '@/db/repo/measurements';
import { getRoutineExercises } from '@/db/repo/routines';
import {
    bestPRs,
    completeWorkout,
    createWorkout,
    getActiveWorkout as fetchActiveWorkout,
    getWorkoutSets,
    insertPR,
    lastPerformedSets,
    replaceWorkoutSets,
    upsertSet,
} from '@/db/repo/workouts';
import { syncNow } from '@/db/sync';
import { ACTIVITY_EXTRAS, ACTIVITY_META, formatExtras, hkActivityToCardio, mergeCardioExtras, type CardioActivity } from '@/lib/cardio';
import { getGoogleIntradayHR } from '@/lib/googleHealth';
import { getWorkoutHRSamples } from '@/lib/health';
import { brzycki } from '@/lib/onerm';
import { lbsToKg } from '@/lib/plates';
import {
    deleteSessionSet,
    leaveSession,
    pushSessionSet,
    type SessionMember,
    type SessionSet,
} from '@/lib/routineSession';
import type { Equipment, RecordType, RoutineExercise, SetType, TrackingType } from '@/lib/types';
import { generateWarmups } from '@/lib/warmup';

import { notify } from './notify';
import { useSettings } from './settings';

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export interface LiveSet {
  id: string;
  setOrder: number; // global insertion sequence across the workout
  setType: SetType;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  /** Hold time (hold), or cardio/carry duration. */
  durationSeconds: number | null;
  /** Cardio or carry distance, metres. */
  distanceM: number | null;
  /** Optional heart rate for cardio/hold sets. */
  avgHr: number | null;
  /** Optional per-set extras (incline_pct, resistance, stroke_rate...). */
  meta?: Record<string, number>;
  isCompleted: boolean;
  /** Epoch ms when the set was marked complete - bins health HR samples per set. */
  completedAtMs?: number;
  ghostWeightKg: number | null; // previous session's values, rendered ghosted
  ghostReps: number | null;
}

export interface ExerciseBlock {
  key: string;
  exerciseId: string;
  name: string;
  equipment: Equipment;
  trackingType: TrackingType;
  supersetId: string | null;
  restSeconds: number;
  sets: LiveSet[];
}

export interface RestState {
  endsAt: number; // epoch ms
  durationSec: number;
  label: string;
  /** Remaining ms captured when the workout was paused mid-rest. */
  remainingMs?: number;
}

export interface FinalizeSummary {
  workoutId: string;
  title: string;
  completedAt: string;
  durationSec: number;
  volumeKg: number;
  setCount: number;
  exerciseCount: number;
  prs: { exerciseName: string; recordType: string; value: number }[];
  exercises: {
    name: string;
    setCount: number;
    bestWeightKg: number | null;
    bestReps: number | null;
    bestE1rm: number;
    /** Longest hold, or cardio/carry duration - null for ordinary strength sets. */
    bestDurationSeconds: number | null;
    /** Farthest cardio/carry distance - null for ordinary strength sets. */
    bestDistanceM: number | null;
    /** Mean RPE across completed sets, when any were rated. */
    avgRpe: number | null;
    /** Formatted merged extras ("INCLINE 12% · STROKE 28spm") - cardio only. */
    extrasText: string | null;
  }[];
}

interface ActiveWorkoutStore {
  workoutId: string | null;
  routineId: string | null;
  title: string;
  startedAt: number | null; // epoch ms
  blocks: ExerciseBlock[];
  rest: RestState | null;
  /** Epoch ms when the workout was paused - null while running. */
  pausedAtMs: number | null;
  /** Total ms spent paused across all pause/resume cycles. */
  pausedAccumMs: number;
  hydrated: boolean;

  /** Collab session this workout belongs to - null for solo workouts. */
  sessionId: string | null;
  /** Other members' live sets, exercise_id -> rows (my own sets excluded). */
  partnerSets: Record<string, SessionSet[]>;
  /** user_id -> display label for partner rows. */
  partnerNames: Record<string, string>;
  /** Members' chosen tabs: user_id -> tab routine id (null = main list). */
  partnerTabs: Record<string, string | null>;

  startWorkout: (opts?: {
    routineId?: string;
    title?: string;
    /** Collab session to attach: mirrors my sets live and adopts the shared
     *  session clock as the workout's startedAt. */
    session?: { id: string; startedAtMs: number | null };
  }) => Promise<void>;
  /** Feed from subscribeSession - refreshes partner sets/tabs/names. */
  applySessionFeed: (members: SessionMember[], sets: SessionSet[], me: string | null) => void;
  /** Detach from the session (leave member row). Called on finalize/discard. */
  detachSession: () => void;
  addExercise: (exerciseId: string) => Promise<void>;
  /** Cardio logged via /cardio/new inside a live workout: lands as a
   *  completed cardio set so it persists with the workout and only writes
   *  to cardio_sessions when the workout finishes. */
  addCardioBlock: (input: {
    activity: CardioActivity;
    distanceM: number | null;
    durationSeconds: number;
    avgHr: number | null;
    meta?: Record<string, number>;
  }) => Promise<void>;
  /** Adds a cardio activity (run, row, ...) as an ordinary exercise block
   *  with blank sets - the user fills duration/distance/HR like any set. */
  addCardioExercise: (activity: CardioActivity) => Promise<void>;
  removeBlock: (blockKey: string) => void;
  addSet: (blockKey: string, setType?: SetType) => void;
  updateSet: (
    blockKey: string,
    setId: string,
    patch: Partial<Pick<LiveSet, 'weightKg' | 'reps' | 'rpe' | 'setType' | 'durationSeconds' | 'distanceM' | 'avgHr' | 'meta'>>
  ) => void;
  completeSet: (blockKey: string, setId: string) => void;
  uncompleteSet: (blockKey: string, setId: string) => void;
  deleteSet: (blockKey: string, setId: string) => void;
  insertWarmups: (blockKey: string) => void;
  toggleSuperset: (blockKey: string) => void;
  startRest: (seconds: number, label?: string) => void;
  adjustRest: (deltaSec: number) => void;
  skipRest: () => void;
  /** Pause/resume the whole workout: freezes the rest countdown and stops
   *  the session clock (finalize subtracts accumulated paused time). */
  togglePause: () => void;
  setTitle: (title: string) => void;
  finalize: () => Promise<FinalizeSummary | null>;
  discard: () => Promise<void>;
  hydrate: () => Promise<boolean>;
}

const uuid = () => Crypto.randomUUID();
const DEFAULT_REST = 120;
const DEFAULT_TARGET_SETS = 3;

function blankSet(setOrder: number): LiveSet {
  return {
    id: uuid(),
    setOrder,
    setType: 'normal',
    weightKg: null,
    reps: null,
    rpe: null,
    durationSeconds: null,
    distanceM: null,
    avgHr: null,
    isCompleted: false,
    ghostWeightKg: null,
    ghostReps: null,
  };
}

/** Effective weight for display/plate math: real value, else ghost. */
export const effectiveWeight = (s: LiveSet) => s.weightKg ?? s.ghostWeightKg;
export const effectiveReps = (s: LiveSet) => s.reps ?? s.ghostReps;

/** Bar weight in canonical kg, from profile preference (display unit). */
function barWeightKg(): number {
  const { weight_unit, default_bar_weight } = useSettings.getState();
  return weight_unit === 'lbs' ? lbsToKg(default_bar_weight) : default_bar_weight;
}

export const useActiveWorkout = create<ActiveWorkoutStore>((set, get) => {
  /** Persist a set row in the background; never blocks the UI. In a collab
   *  session the same values mirror to routine_session_sets so partners see
   *  them live. */
  const persistSet = (block: ExerciseBlock, s: LiveSet) => {
    const { workoutId, sessionId } = get();
    if (!workoutId) return;
    void upsertSet({
      id: s.id,
      workout_id: workoutId,
      exercise_id: block.exerciseId,
      superset_id: block.supersetId,
      set_order: s.setOrder,
      set_type: s.setType,
      weight_kg: s.weightKg,
      reps: s.reps,
      rpe: s.rpe,
      duration_seconds: s.durationSeconds,
      distance_m: s.distanceM,
      avg_hr: s.avgHr,
      meta: s.meta ? JSON.stringify(s.meta) : null,
      is_completed: s.isCompleted,
    });
    if (sessionId) {
      void pushSessionSet(sessionId, {
        exercise_id: block.exerciseId,
        set_order: s.setOrder,
        set_type: s.setType,
        weight_kg: s.weightKg,
        reps: s.reps,
        rpe: s.rpe,
        duration_seconds: s.durationSeconds,
        distance_m: s.distanceM,
        done: s.isCompleted,
      });
    }
  };

  /** Remove a mirrored live set (session only - local deletes stay local). */
  const unmirror = (exerciseId: string, setOrder: number) => {
    const { sessionId } = get();
    if (sessionId) void deleteSessionSet(sessionId, exerciseId, setOrder);
  };

  const findBlock = (blocks: ExerciseBlock[], key: string) =>
    blocks.find((b) => b.key === key);

  /** Find-or-create the cardio exercise backing an activity ("Run", "Row"...)
   *  so workout cardio renders like any other block and lands in
   *  cardio_sessions via the finalize path. */
  const findCardioExercise = async (activity: CardioActivity) => {
    const label = ACTIVITY_META[activity].label;
    const matches = await listExercises({ query: label });
    return (
      matches.find(
        (e) => e.tracking_type === 'cardio' && e.name.toLowerCase() === label.toLowerCase()
      ) ??
      matches.find((e) => e.name.toLowerCase() === label.toLowerCase()) ??
      (await createExercise({
        name: label,
        target_muscle: 'Cardio',
        equipment: 'other',
        tracking_type: 'cardio',
      }))
    );
  };

  /** Next global set_order. */
  const nextOrder = (blocks: ExerciseBlock[]) =>
    blocks.reduce((m, b) => Math.max(m, ...b.sets.map((s) => s.setOrder)), 0) + 1;

  /** Ghost template for a block's next set: mirror the last set's values. */
  const ghostFrom = (s?: LiveSet): Pick<LiveSet, 'ghostWeightKg' | 'ghostReps'> => ({
    ghostWeightKg: s ? effectiveWeight(s) : null,
    ghostReps: s ? effectiveReps(s) : null,
  });

  return {
    workoutId: null,
    routineId: null,
    title: 'Workout',
    startedAt: null,
    blocks: [],
    rest: null,
    pausedAtMs: null,
    pausedAccumMs: 0,
    hydrated: false,
    sessionId: null,
    partnerSets: {},
    partnerNames: {},
    partnerTabs: {},

    applySessionFeed: (members, sets, me) => {
      const partnerSets: Record<string, SessionSet[]> = {};
      const partnerNames: Record<string, string> = {};
      const partnerTabs: Record<string, string | null> = {};
      for (const m of members) {
        if (m.user_id === me) continue;
        partnerNames[m.user_id] = m.display_name ?? m.username ?? 'Partner';
        partnerTabs[m.user_id] = m.tab_routine_id;
      }
      for (const s of sets) {
        if (s.user_id === me) continue;
        (partnerSets[s.exercise_id] ??= []).push(s);
      }
      set({ partnerSets, partnerNames, partnerTabs });
    },

    detachSession: () => {
      const { sessionId } = get();
      if (sessionId) void leaveSession(sessionId);
      set({ sessionId: null, partnerSets: {}, partnerNames: {}, partnerTabs: {} });
    },

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    startWorkout: async (opts) => {
      const profile = useSettings.getState();
      const userId = profile.supabase_user_id;
      const bw = await latestWeightKg();

      let title = opts?.title ?? 'Workout';
      let blocks: ExerciseBlock[] = [];

      if (opts?.routineId) {
        const routineExercises = await getRoutineExercises(opts.routineId);
        const exerciseRows = await Promise.all(
          routineExercises.map((re) => getExercise(re.exercise_id))
        );
        blocks = await Promise.all(
          routineExercises.map(async (re, i) => {
            const ex = exerciseRows[i];
            const prev = await lastPerformedSets(re.exercise_id);
            const sets: LiveSet[] = Array.from({ length: re.target_sets }, (_, j) => ({
              ...blankSet(j + 1),
              // Routine-set values win (the user pre-filled them); history fills the rest.
              setType: re.target_types[j] ?? 'normal',
              // Bodyweight sets persist combined (bw + added) - the ghost shows
              // the ADDED portion only so the field label stays honest.
              ghostWeightKg: re.target_weights[j] ??
                (prev[j]?.weight_kg != null && ex?.equipment === 'bodyweight' && bw != null
                  ? Math.max(0, prev[j].weight_kg! - bw)
                  : prev[j]?.weight_kg) ??
                null,
              ghostReps: ex?.tracking_type === 'strength'
                ? re.target_reps[j] ?? prev[j]?.reps ?? 10
                : null,
            }));
            return {
              key: uuid(),
              exerciseId: re.exercise_id,
              name: ex?.name ?? 'Exercise',
              equipment: ex?.equipment ?? 'other',
              trackingType: ex?.tracking_type ?? 'strength',
              supersetId: re.superset_id,
              restSeconds: re.rest_seconds || DEFAULT_REST,
              sets,
            };
          })
        );
      }

      const workout = await createWorkout({
        title,
        routine_id: opts?.routineId ?? null,
        user_id: userId,
      });

      // Re-sequence set orders globally so block order survives hydration.
      let order = 1;
      for (const b of blocks) for (const s of b.sets) s.setOrder = order++;

      set({
        workoutId: workout.id,
        routineId: opts?.routineId ?? null,
        title,
        // Collab sessions share one clock: everyone runs off started_at.
        startedAt: opts?.session?.startedAtMs ?? Date.now(),
        blocks,
        rest: null,
        pausedAtMs: null,
        pausedAccumMs: 0,
        hydrated: true,
        sessionId: opts?.session?.id ?? null,
      });
      // Persist initial sets so app-kill recovery restores the full layout.
      for (const b of blocks) for (const s of b.sets) persistSet(b, s);
    },

    hydrate: async () => {
      const workout = await fetchActiveWorkout();
      if (!workout) {
        set({ hydrated: true });
        return false;
      }
      const rows = await getWorkoutSets(workout.id);

      // Routine template data restores rest timers + ghost targets that
      // aren't persisted on set rows. Matched to blocks by exercise order so
      // a duplicated exercise still gets its own routine entry.
      const routineQueue = new Map<string, RoutineExercise[]>();
      if (workout.routine_id) {
        for (const re of await getRoutineExercises(workout.routine_id)) {
          routineQueue.set(re.exercise_id, [...(routineQueue.get(re.exercise_id) ?? []), re]);
        }
      }

      // Blocks are runs of consecutive rows sharing an exercise_id - the same
      // exercise can legitimately appear twice, so never merge by exercise.
      const bw = await latestWeightKg();
      const blocks: ExerciseBlock[] = [];
      let curRe: RoutineExercise | null = null;
      let curPrev: Awaited<ReturnType<typeof lastPerformedSets>> = [];
      let curBodyweight = false;
      for (const r of rows) {
        let block = blocks[blocks.length - 1];
        if (!block || block.exerciseId !== r.exercise_id) {
          const ex = await getExercise(r.exercise_id);
          curRe = routineQueue.get(r.exercise_id)?.shift() ?? null;
          curPrev = await lastPerformedSets(r.exercise_id);
          curBodyweight = ex?.equipment === 'bodyweight';
          block = {
            key: uuid(),
            exerciseId: r.exercise_id,
            name: ex?.name ?? 'Exercise',
            equipment: ex?.equipment ?? 'other',
            trackingType: ex?.tracking_type ?? 'strength',
            supersetId: r.superset_id,
            restSeconds: curRe?.rest_seconds || DEFAULT_REST,
            sets: [],
          };
          blocks.push(block);
        }
        const j = block.sets.length;
        block.sets.push({
          id: r.id,
          setOrder: r.set_order,
          setType: r.set_type,
          weightKg: r.weight_kg,
          reps: r.reps,
          rpe: r.rpe,
          durationSeconds: r.duration_seconds,
          distanceM: r.distance_m,
          avgHr: r.avg_hr,
          meta: r.meta ? (JSON.parse(r.meta) as Record<string, number>) : undefined,
          isCompleted: r.is_completed,
          // Hydrated sets have no in-memory stamp; the row's last write
          // approximates when the set was completed for HR backfill.
          completedAtMs: r.is_completed ? Date.parse(r.updated_at) : undefined,
          // Same precedence as startWorkout/addExercise: routine target wins,
          // then the previous session's logged values. Bodyweight sets store
          // combined (bw + added) so the ghost subtracts current bw.
          ghostWeightKg: curRe?.target_weights[j] ??
            (curPrev[j]?.weight_kg != null && curBodyweight && bw != null
              ? Math.max(0, curPrev[j].weight_kg! - bw)
              : curPrev[j]?.weight_kg) ??
            null,
          ghostReps: block.trackingType === 'strength'
            ? curRe?.target_reps[j] ?? curPrev[j]?.reps ?? 10
            : null,
        });
      }
      blocks.sort(
        (a, b) => Math.min(...a.sets.map((s) => s.setOrder)) - Math.min(...b.sets.map((s) => s.setOrder))
      );
      set({
        workoutId: workout.id,
        routineId: workout.routine_id,
        title: workout.title,
        startedAt: new Date(workout.started_at).getTime(),
        blocks,
        rest: null,
        pausedAtMs: null,
        pausedAccumMs: 0,
        hydrated: true,
      });
      return true;
    },

    discard: async () => {
      const { workoutId } = get();
      if (workoutId) {
        const db = await getDb();
        await db.runAsync(
          `UPDATE workout_sets SET deleted_at = ?, dirty = 1 WHERE workout_id = ?`,
          new Date().toISOString(),
          workoutId
        );
        await softDelete('workouts', workoutId);
      }
      get().detachSession();
      set({ workoutId: null, routineId: null, title: 'Workout', startedAt: null, blocks: [], rest: null, pausedAtMs: null, pausedAccumMs: 0 });
    },

    // ------------------------------------------------------------------
    // Exercises / sets
    // ------------------------------------------------------------------

    addExercise: async (exerciseId) => {
      const { blocks, workoutId } = get();
      if (!workoutId) return;
      // One live block per exercise - a second block for the same exercise
      // would merge back into the first on hydration anyway.
      if (blocks.some((b) => b.exerciseId === exerciseId)) return;
      const ex = await getExercise(exerciseId);
      if (!ex) return;
      const prev = await lastPerformedSets(exerciseId);
      const bw = ex.equipment === 'bodyweight' ? await latestWeightKg() : null;
      const count = Math.max(prev.length, DEFAULT_TARGET_SETS);
      const start = nextOrder(blocks);
      const sets: LiveSet[] = Array.from({ length: count }, (_, j) => ({
        ...blankSet(start + j),
        // Stored weight_kg for bodyweight sets is bw + added - ghost shows
        // the added portion only.
        ghostWeightKg: prev[j]?.weight_kg != null && bw != null
          ? Math.max(0, prev[j].weight_kg! - bw)
          : prev[j]?.weight_kg ?? null,
        // Pre-determined default: last session's reps, else 10. Only
        // strength sets use reps - a cardio/hold/carry ghost would commit
        // a junk reps value at finalize.
        ghostReps: ex.tracking_type === 'strength' ? prev[j]?.reps ?? 10 : null,
      }));
      const block: ExerciseBlock = {
        key: uuid(),
        exerciseId,
        name: ex.name,
        equipment: ex.equipment,
        trackingType: ex.tracking_type,
        supersetId: null,
        restSeconds: DEFAULT_REST,
        sets,
      };
      set({ blocks: [...blocks, block] });
      for (const s of sets) persistSet(block, s);
    },

    addCardioBlock: async ({ activity, distanceM, durationSeconds, avgHr, meta }) => {
      const { blocks, workoutId } = get();
      if (!workoutId) return;
      const exercise = await findCardioExercise(activity);
      const doneSet: LiveSet = {
        ...blankSet(nextOrder(blocks)),
        durationSeconds,
        distanceM,
        avgHr,
        meta,
        isCompleted: true,
      };
      const existing = blocks.find((b) => b.exerciseId === exercise.id);
      if (existing) {
        // Second session of the same activity appends to its block rather
        // than spawning a duplicate block.
        set({
          blocks: blocks.map((b) =>
            b.key === existing.key ? { ...b, sets: [...b.sets, doneSet] } : b
          ),
        });
        persistSet(existing, doneSet);
        return;
      }
      const block: ExerciseBlock = {
        key: uuid(),
        exerciseId: exercise.id,
        name: exercise.name,
        equipment: exercise.equipment,
        trackingType: 'cardio',
        supersetId: null,
        restSeconds: 0,
        sets: [doneSet],
      };
      set({ blocks: [...blocks, block] });
      persistSet(block, doneSet);
    },

    addCardioExercise: async (activity) => {
      const exercise = await findCardioExercise(activity);
      await get().addExercise(exercise.id);
    },

    removeBlock: (blockKey) => {
      const { blocks } = get();
      const block = findBlock(blocks, blockKey);
      if (!block) return;
      set({ blocks: blocks.filter((b) => b.key !== blockKey) });
      for (const s of block.sets) unmirror(block.exerciseId, s.setOrder);
      const db = getDb();
      void db.then((d) =>
        Promise.all(
          block.sets.map((s) =>
            d.runAsync(
              'UPDATE workout_sets SET deleted_at = ?, dirty = 1 WHERE id = ?',
              new Date().toISOString(),
              s.id
            )
          )
        )
      );
    },

    addSet: (blockKey, setType = 'normal') => {
      const { blocks } = get();
      const next = blocks.map((b) => {
        if (b.key !== blockKey) return b;
        const last = b.sets[b.sets.length - 1];
        const s: LiveSet = {
          ...blankSet(nextOrder(blocks)),
          setType,
          ...ghostFrom(last),
        };
        persistSet(b, s);
        return { ...b, sets: [...b.sets, s] };
      });
      set({ blocks: next });
    },

    updateSet: (blockKey, setId, patch) => {
      const { blocks } = get();
      const next = blocks.map((b) => {
        if (b.key !== blockKey) return b;
        const sets = b.sets.map((s) => {
          if (s.id !== setId) return s;
          const merged = { ...s, ...patch };
          // Only a real entered value retires the ghost - clearing the field
          // back to empty keeps the previous-session hint.
          if (patch.weightKg != null) merged.ghostWeightKg = null;
          if (patch.reps != null) merged.ghostReps = null;
          persistSet(b, merged);
          return merged;
        });
        return { ...b, sets };
      });
      set({ blocks: next });
    },

    deleteSet: (blockKey, setId) => {
      const { blocks } = get();
      const block = blocks.find((b) => b.key === blockKey);
      if (!block || block.sets.length <= 1) return; // minimum one set per exercise
      const removed = block.sets.find((s) => s.id === setId);
      const next = blocks.map((b) =>
        b.key === blockKey ? { ...b, sets: b.sets.filter((s) => s.id !== setId) } : b
      );
      set({ blocks: next });
      if (removed) unmirror(block.exerciseId, removed.setOrder);
      void getDb().then((d) =>
        d.runAsync(
          'UPDATE workout_sets SET deleted_at = ?, dirty = 1 WHERE id = ?',
          new Date().toISOString(),
          setId
        )
      );
    },

    // ------------------------------------------------------------------
    // Completion - ghost commit + rest trigger
    // ------------------------------------------------------------------

    completeSet: (blockKey, setId) => {
      const { blocks } = get();
      const blockIdx = blocks.findIndex((b) => b.key === blockKey);
      if (blockIdx < 0) return;
      const block = blocks[blockIdx];
      const target = block.sets.find((s) => s.id === setId);
      if (!target || target.isCompleted) return;

      // Ghost commit: tapping ✓ with no input locks in previous-session values.
      const committed: LiveSet = {
        ...target,
        weightKg: target.weightKg ?? target.ghostWeightKg,
        reps: target.reps ?? target.ghostReps,
        ghostWeightKg: null,
        ghostReps: null,
        isCompleted: true,
        completedAtMs: Date.now(),
      };
      const next = blocks.map((b, i) =>
        i === blockIdx
          ? { ...b, sets: b.sets.map((s) => (s.id === setId ? committed : s)) }
          : b
      );
      set({ blocks: next });
      persistSet(block, committed);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Superset rule: rest fires only when the LAST member of the superset
      // group (A1→B1→A2→B2, the highest block index) completes a set.
      let shouldRest = true;
      if (block.supersetId) {
        const group = next
          .map((b, i) => ({ b, i }))
          .filter(({ b }) => b.supersetId === block.supersetId);
        shouldRest = group.every(({ i }) => i <= blockIdx);
      }
      if (shouldRest && block.restSeconds > 0) {
        get().startRest(block.restSeconds, block.name);
      }
    },

    uncompleteSet: (blockKey, setId) => {
      const { blocks } = get();
      const next = blocks.map((b) => {
        if (b.key !== blockKey) return b;
        const sets = b.sets.map((s) => {
          if (s.id !== setId) return s;
          const merged = { ...s, isCompleted: false, completedAtMs: undefined };
          persistSet(b, merged);
          return merged;
        });
        return { ...b, sets };
      });
      set({ blocks: next });
    },

    // ------------------------------------------------------------------
    // Warmup generator
    // ------------------------------------------------------------------

    insertWarmups: (blockKey) => {
      const { blocks } = get();
      const block = findBlock(blocks, blockKey);
      if (!block) return;
      // Second press removes the generated ramp.
      const kept = block.sets.filter((s) => s.setType !== 'warmup');
      if (kept.length < block.sets.length) {
        const cleared = { ...block, sets: kept };
        set({ blocks: blocks.map((b) => (b.key === blockKey ? cleared : b)) });
        for (const s of block.sets) {
          if (s.setType === 'warmup') {
            void softDelete('workout_sets', s.id);
            unmirror(block.exerciseId, s.setOrder);
          }
        }
        return;
      }

      const working = block.sets.find((s) => s.setType === 'normal' && !s.isCompleted)
        ?? block.sets.find((s) => s.setType === 'normal');
      const workKg = working ? effectiveWeight(working) : null;
      if (!workKg) return;

      const { weight_unit } = useSettings.getState();
      const ramp = generateWarmups(workKg, barWeightKg(), weight_unit);
      if (ramp.length === 0 || kept.length === 0) return;

      // Start the ramp at this block's own first set_order so renumbering
      // stays inside the block's slice of the global sequence (hydrate
      // re-sorts blocks by their minimum set_order).
      const order = Math.min(...kept.map((s) => s.setOrder));
      const warmups: LiveSet[] = ramp.map((w, i) => ({
        ...blankSet(order + i),
        setType: 'warmup' as SetType,
        weightKg: w.weightKg,
        reps: w.reps,
      }));
      const updatedBlock = {
        ...block,
        sets: [...warmups, ...kept].map((s, i) => ({ ...s, setOrder: order + i })),
      };
      const next = blocks.map((b) => (b.key === blockKey ? updatedBlock : b));
      set({ blocks: next });
      for (const s of updatedBlock.sets) persistSet(updatedBlock, s);
    },

    // ------------------------------------------------------------------
    // Supersets - link this block with the next one
    // ------------------------------------------------------------------

    toggleSuperset: (blockKey) => {
      const { blocks } = get();
      const idx = blocks.findIndex((b) => b.key === blockKey);
      if (idx < 0) return;
      const block = blocks[idx];

      // Persist the link on every set row so superset groups survive
      // app-kill hydration (the id lives on workout_sets.superset_id).
      const persistLink = (b: ExerciseBlock, supersetId: string | null) => {
        const t = new Date().toISOString();
        void getDb().then((d) =>
          Promise.all(
            b.sets.map((s) =>
              d.runAsync(
                'UPDATE workout_sets SET superset_id = ?, updated_at = ?, dirty = 1 WHERE id = ?',
                supersetId,
                t,
                s.id
              )
            )
          )
        );
      };

      if (block.supersetId) {
        // Clear the shared group id on every member - leaving it on the
        // partner would keep it "linked" to nothing.
        const group = block.supersetId;
        set({
          blocks: blocks.map((b) => (b.supersetId === group ? { ...b, supersetId: null } : b)),
        });
        for (const b of blocks) if (b.supersetId === group) persistLink(b, null);
        return;
      }
      // Join the next block's group if it has one; else create a pair.
      const neighbor = blocks[idx + 1];
      if (!neighbor) return;
      const supersetId = neighbor.supersetId ?? uuid();
      set({
        blocks: blocks.map((b) =>
          b.key === blockKey || b.key === neighbor.key ? { ...b, supersetId } : b
        ),
      });
      persistLink(block, supersetId);
      persistLink(neighbor, supersetId);
    },

    // ------------------------------------------------------------------
    // Rest HUD
    // ------------------------------------------------------------------

    startRest: (seconds, label = 'Rest') => {
      set({
        rest: { endsAt: Date.now() + seconds * 1000, durationSec: seconds, label },
      });
    },

    adjustRest: (deltaSec) => {
      const { rest } = get();
      if (!rest) return;
      const endsAt = Math.max(Date.now(), rest.endsAt + deltaSec * 1000);
      set({ rest: { ...rest, endsAt, durationSec: Math.max(1, rest.durationSec + deltaSec) } });
    },

    skipRest: () => set({ rest: null }),

    togglePause: () => {
      const { workoutId, pausedAtMs, pausedAccumMs, rest } = get();
      if (!workoutId) return;
      const now = Date.now();
      if (pausedAtMs == null) {
        set({
          pausedAtMs: now,
          rest: rest ? { ...rest, remainingMs: Math.max(0, rest.endsAt - now) } : rest,
        });
      } else {
        set({
          pausedAccumMs: pausedAccumMs + (now - pausedAtMs),
          pausedAtMs: null,
          rest: rest?.remainingMs != null
            ? { ...rest, endsAt: now + rest.remainingMs, remainingMs: undefined }
            : rest,
        });
      }
    },

    setTitle: (title) => set({ title }),

    // ------------------------------------------------------------------
    // Finalizer - prune, PRs, tonnage, duration, persist, sync
    // ------------------------------------------------------------------

    finalize: async () => {
      const { workoutId, startedAt, blocks, title, pausedAtMs, pausedAccumMs } = get();
      if (!workoutId || !startedAt) return null;

      // The whole session is logged - every exercise stays in history. Sets
      // that were completed or have entered data are marked done (ghosts fill
      // missing fields); untouched sets persist as is_completed=0 placeholders
      // so the exercise still appears in the log without stats.
      const done = blocks.map((b) => ({
        ...b,
        sets: b.sets.map((s) => {
          const engaged =
            s.isCompleted || s.weightKg != null || s.reps != null ||
            s.durationSeconds != null || s.distanceM != null;
          return engaged
            ? {
                ...s,
                weightKg: s.weightKg ?? s.ghostWeightKg,
                reps: s.reps ?? s.ghostReps,
                isCompleted: true,
              }
            : s;
        }),
      }));

      // Zero completed sets anywhere → let the caller confirm discard.
      if (!done.some((b) => b.sets.some((s) => s.isCompleted))) return null;

      const completedAt = new Date();

      // Auto-fill per-set avg HR from the health platform before the block
      // loop reads it (cardio sessions, breakdowns, persisted sets all see
      // the backfilled value). Samples in the ~90s ending at each set's
      // completion capture the effort + immediate spike. Manual entries win.
      const settingsNow = useSettings.getState();
      if (settingsNow.health_connected || settingsNow.fitbit_connected) {
        try {
          let hrSamples = settingsNow.health_connected
            ? await getWorkoutHRSamples(
                new Date(startedAt).toISOString(),
                completedAt.toISOString()
              )
            : [];
          // Google Health path: intraday HR for the workout window (covers
          // Fitbit/Pixel devices; better than waiting on Apple Health writes).
          if (settingsNow.fitbit_connected) {
            const gh = await getGoogleIntradayHR(
              new Date(startedAt).toISOString(),
              completedAt.toISOString()
            );
            if (gh.length > 0) {
              hrSamples = [...hrSamples, ...gh].sort((a, b) => a.at - b.at);
            }
          }
          if (hrSamples.length > 0) {
            for (const b of done) {
              for (const s of b.sets) {
                if (!s.isCompleted || s.avgHr != null) continue;
                const end = s.completedAtMs ?? completedAt.getTime();
                const win = hrSamples.filter((x) => x.at > end - 90_000 && x.at <= end + 15_000);
                if (win.length > 0) {
                  s.avgHr = Math.round(win.reduce((a, x) => a + x.bpm, 0) / win.length);
                }
              }
            }
          }
        } catch {
          // Health unavailable mid-flight - HR stays unset rather than blocking finalize.
        }
      }

      const pauseMs =
        pausedAccumMs + (pausedAtMs ? completedAt.getTime() - pausedAtMs : 0);
      const durationSec = Math.max(0, Math.round((completedAt.getTime() - startedAt - pauseMs) / 1000));
      const bodyweightKg = await latestWeightKg();
      let volumeKg = 0;
      let setCount = 0;
      let bwMissing = false;

      const newPRs: FinalizeSummary['prs'] = [];
      const exerciseBreakdown: FinalizeSummary['exercises'] = [];

      for (const b of done) {
        // Bodyweight exercises: the weight field is ADDED load - the real
        // load moved is bodyweight + added. Persisted into weight_kg so
        // volume/e1RM/PRs and every downstream query just work.
        const addedBw =
          b.trackingType === 'strength' && b.equipment === 'bodyweight'
            ? (bodyweightKg ?? 0)
            : 0;
        if (b.equipment === 'bodyweight' && b.trackingType === 'strength' && bodyweightKg == null) {
          bwMissing = true;
        }
        let bestE1rm = 0;
        let maxWeight = 0;
        let bestReps: number | null = null;
        let bestWeightKg: number | null = null;
        let bestDurationSeconds: number | null = null;
        let bestDistanceM: number | null = null;
        let exVolume = 0;
        let completedSets = 0;
        let rpeSum = 0;
        let rpeCount = 0;
        for (const s of b.sets) {
          if (!s.isCompleted) continue;
          completedSets++;
          setCount++;
          if (s.rpe != null) {
            rpeSum += s.rpe;
            rpeCount++;
          }

          if (s.durationSeconds != null && (bestDurationSeconds == null || s.durationSeconds > bestDurationSeconds)) {
            bestDurationSeconds = s.durationSeconds;
          }
          if (s.distanceM != null && (bestDistanceM == null || s.distanceM > bestDistanceM)) {
            bestDistanceM = s.distanceM;
          }

          // Strength/carry both track weight; only strength counts toward
          // total tonnage and e1RM (a carry's "reps" don't exist).
          if (b.trackingType === 'strength') {
            const w = (s.weightKg ?? 0) + addedBw;
            const r = s.reps ?? 0;
            volumeKg += w * r;
            exVolume += w * r;
            const e1rm = w > 0 && r > 0 ? brzycki(w, r) : 0;
            if (e1rm > bestE1rm) {
              bestE1rm = e1rm;
              bestWeightKg = w;
              bestReps = r;
            }
            if (w > maxWeight) maxWeight = w;
          } else if (b.trackingType === 'carry') {
            const w = s.weightKg ?? 0;
            if (w > maxWeight) { maxWeight = w; bestWeightKg = w; }
          }
        }
        // Extras merge once - feeds the cardio_sessions row AND the
        // breakdown line so both show the same numbers.
        const cardioMerged =
          b.trackingType === 'cardio'
            ? mergeCardioExtras(
                b.sets.filter((s) => s.isCompleted),
                ACTIVITY_EXTRAS[hkActivityToCardio(b.name)]
              )
            : null;
        if (b.trackingType === 'cardio' && completedSets > 0) {
          // One cardio_sessions row per exercise block - a 3x500m rowing
          // interval set is ONE session on the Cardio tab, not three.
          const cardioSets = b.sets.filter((s) => s.isCompleted);
          const totalDist = cardioSets.reduce((a, s) => a + (s.distanceM ?? 0), 0);
          const totalDur = cardioSets.reduce((a, s) => a + (s.durationSeconds ?? 0), 0);
          const hrs = cardioSets.map((s) => s.avgHr).filter((h): h is number => h != null);
          if (totalDur > 0 || totalDist > 0) {
            const activity = hkActivityToCardio(b.name);
            // Awaited (not void): a cardio write failing must surface as a
            // notify, never silently drop the session.
            try {
              await logCardio({
                activity,
                distance_m: totalDist > 0 ? totalDist : null,
                duration_seconds: totalDur,
                avg_hr: hrs.length ? Math.round(hrs.reduce((a, h) => a + h, 0) / hrs.length) : null,
                max_hr: hrs.length ? Math.max(...hrs) : null,
                meta: cardioMerged,
                started_at: new Date(startedAt).toISOString(),
              });
            } catch (e) {
              notify('Cardio session not saved', {
                body: `${b.name}: ${e instanceof Error ? e.message : String(e)}`,
                tone: 'error',
              });
            }
          }
        }
        exerciseBreakdown.push({
          name: b.name,
          setCount: completedSets,
          bestWeightKg,
          bestReps,
          bestE1rm,
          bestDurationSeconds,
          bestDistanceM,
          avgRpe: rpeCount ? Math.round((rpeSum / rpeCount) * 10) / 10 : null,
          extrasText: cardioMerged
            ? formatExtras(cardioMerged, hkActivityToCardio(b.name))
            : null,
        });

        const prev = await bestPRs(b.exerciseId);
        const achieved = completedAt.toISOString();
        const tryPR = async (type: RecordType, value: number) => {
          if (value > 0 && value > (prev[type] ?? 0)) {
            await insertPR({
              exercise_id: b.exerciseId,
              record_type: type,
              value,
              achieved_at: achieved,
              workout_id: workoutId,
            });
            newPRs.push({ exerciseName: b.name, recordType: type, value });
          }
        };
        if (b.trackingType === 'strength') {
          await tryPR('1rm', bestE1rm);
          await tryPR('max_weight', maxWeight);
          await tryPR('max_volume', exVolume);
        } else if (b.trackingType === 'carry') {
          await tryPR('max_weight', maxWeight);
          if (bestDistanceM != null) await tryPR('max_distance', bestDistanceM);
          if (bestDurationSeconds != null) await tryPR('max_hold_seconds', bestDurationSeconds);
        } else if (b.trackingType === 'hold') {
          if (bestDurationSeconds != null) await tryPR('max_hold_seconds', bestDurationSeconds);
        } else if (b.trackingType === 'cardio') {
          if (bestDistanceM != null) await tryPR('max_distance', bestDistanceM);
        }
      }

      await replaceWorkoutSets(
        workoutId,
        done.flatMap((b) => {
          const addedBw =
            b.trackingType === 'strength' && b.equipment === 'bodyweight'
              ? (bodyweightKg ?? 0)
              : 0;
          return b.sets.map((s) => ({
            id: s.id,
            exercise_id: b.exerciseId,
            superset_id: b.supersetId,
            set_order: s.setOrder,
            set_type: s.setType,
            // Engaged bodyweight sets persist bw + added; placeholders keep
            // whatever the user typed (usually null).
            weight_kg: s.isCompleted ? (s.weightKg ?? 0) + addedBw : s.weightKg,
            reps: s.reps,
            rpe: s.rpe,
            duration_seconds: s.durationSeconds,
            distance_m: s.distanceM,
            avg_hr: s.avgHr,
            meta: s.meta ? JSON.stringify(s.meta) : null,
            // `done` already marked engaged sets complete; untouched
            // placeholders must persist as is_completed = 0.
            is_completed: s.isCompleted,
          }));
        })
      );
      await completeWorkout(workoutId, {
        completed_at: completedAt.toISOString(),
        duration_seconds: durationSec,
        total_volume_kg: Math.round(volumeKg * 100) / 100,
      });

      if (bwMissing) {
        notify('Bodyweight not set', {
          body: 'Log your weight on the Body tab so pull-ups and dips count their full load.',
          tone: 'info',
        });
      }

      get().detachSession();
      set({ workoutId: null, routineId: null, title: 'Workout', startedAt: null, blocks: [], rest: null, pausedAtMs: null, pausedAccumMs: 0 });
      void syncNow(); // fire-and-forget; serialized + guest-safe

      return {
        workoutId,
        title,
        completedAt: completedAt.toISOString(),
        durationSec,
        volumeKg: Math.round(volumeKg * 100) / 100,
        setCount,
        exerciseCount: done.filter((b) => b.sets.some((s) => s.isCompleted)).length,
        prs: newPRs,
        exercises: exerciseBreakdown,
      };
    },
  };
});

/** True when a workout is live - used by the tab bar to show a resume pill. */
export const useWorkoutLive = () => useActiveWorkout((s) => s.workoutId !== null);
