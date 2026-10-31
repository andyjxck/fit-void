import { brzycki } from '@/lib/onerm';
import type { PersonalRecord, SetType, Workout, WorkoutSet } from '@/lib/types';

import { getDb } from '../client';
import { all, first, ownerId, run, touch, uuid } from './helpers';

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

interface WorkoutRow {
  id: string;
  user_id: string | null;
  routine_id: string | null;
  title: string;
  notes: string | null;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  total_volume_kg: number;
  is_completed: number;
  feel: number | null;
}

const toWorkout = (r: WorkoutRow): Workout => ({ ...r, is_completed: r.is_completed === 1 });

interface SetRow {
  id: string;
  workout_id: string;
  exercise_id: string;
  superset_id: string | null;
  set_order: number;
  set_type: SetType;
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  meta: string | null;
  is_completed: number;
  updated_at: string;
}

const toSet = (r: SetRow): WorkoutSet => ({ ...r, is_completed: r.is_completed === 1 });

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

export async function createWorkout(input: {
  title: string;
  routine_id?: string | null;
  user_id?: string | null;
  started_at?: string;
}): Promise<Workout> {
  const id = uuid();
  const t = touch();
  await run(
    `INSERT INTO workouts
       (id, user_id, routine_id, title, started_at, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    id,
    input.user_id ?? (await ownerId()),
    input.routine_id ?? null,
    input.title,
    input.started_at ?? t,
    t
  );
  return (await getWorkout(id))!;
}

export async function getWorkout(id: string): Promise<Workout | null> {
  const r = await first<WorkoutRow>(
    'SELECT * FROM workouts WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL',
    id
  );
  return r ? toWorkout(r) : null;
}

/** The most recent still-open workout, used for app-kill recovery. */
export async function getActiveWorkout(): Promise<Workout | null> {
  const r = await first<WorkoutRow>(
    `SELECT * FROM workouts
      WHERE is_completed = 0 AND deleted_at IS NULL AND archived_at IS NULL
      ORDER BY started_at DESC LIMIT 1`
  );
  return r ? toWorkout(r) : null;
}

export async function listWorkouts(limit = 50): Promise<Workout[]> {
  const rows = await all<WorkoutRow>(
    `SELECT * FROM workouts
      WHERE is_completed = 1 AND deleted_at IS NULL AND archived_at IS NULL
      ORDER BY started_at DESC LIMIT ?`,
    limit
  );
  return rows.map(toWorkout);
}

export async function workoutsThisWeek(): Promise<number> {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  const r = await first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM workouts
      WHERE is_completed = 1 AND deleted_at IS NULL AND archived_at IS NULL AND started_at >= ?`,
    d.toISOString()
  );
  return r?.n ?? 0;
}

/** Total volume (kg) lifted this week (Mon-Sun). */
export async function weekVolumeKg(): Promise<number> {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  const r = await first<{ v: number | null }>(
    `SELECT COALESCE(SUM(total_volume_kg), 0) AS v FROM workouts
      WHERE is_completed = 1 AND deleted_at IS NULL AND archived_at IS NULL AND started_at >= ?`,
    d.toISOString()
  );
  return r?.v ?? 0;
}

/** Weekday indices (Mon=0) with at least one completed session this week. */
export async function workoutDaysThisWeek(): Promise<Set<number>> {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  const rows = await all<{ started_at: string }>(
    `SELECT started_at FROM workouts
      WHERE is_completed = 1 AND deleted_at IS NULL AND archived_at IS NULL AND started_at >= ?`,
    d.toISOString()
  );
  return new Set(rows.map((r) => (new Date(r.started_at).getDay() + 6) % 7));
}

export interface HistoryEntry extends Workout {
  set_count: number;
  exercise_count: number;
  pr_count: number;
}

/** Logbook entry: a completed workout OR a standalone cardio session. */
export interface LogCardioEntry {
  kind: 'cardio';
  id: string;
  activity: string;
  started_at: string;
  duration_seconds: number;
  distance_m: number | null;
  avg_hr: number | null;
  calories: number | null;
  source: string;
}
export type LogEntry = (HistoryEntry & { kind: 'workout' }) | LogCardioEntry;

function toCardioEntry(r: Omit<LogCardioEntry, 'kind'>): LogCardioEntry {
  return { kind: 'cardio', ...r };
}

function mergeLogEntries(w: HistoryEntry[], c: LogCardioEntry[], limit?: number): LogEntry[] {
  const out: LogEntry[] = [
    ...w.map((x) => ({ ...x, kind: 'workout' as const })),
    ...c,
  ].sort((a, b) => b.started_at.localeCompare(a.started_at));
  return limit != null ? out.slice(0, limit) : out;
}

export async function listHistory(limit = 60): Promise<HistoryEntry[]> {
  return all<HistoryEntry>(
    `SELECT w.*,
            (SELECT COUNT(*) FROM workout_sets s
              WHERE s.workout_id = w.id AND s.is_completed = 1 AND s.deleted_at IS NULL) AS set_count,
            (SELECT COUNT(DISTINCT s2.exercise_id) FROM workout_sets s2
              WHERE s2.workout_id = w.id AND s2.deleted_at IS NULL) AS exercise_count,
            (SELECT COUNT(*) FROM personal_records pr
              WHERE pr.workout_id = w.id AND pr.deleted_at IS NULL) AS pr_count
       FROM workouts w
      WHERE w.is_completed = 1 AND w.deleted_at IS NULL AND w.archived_at IS NULL
      ORDER BY w.started_at DESC LIMIT ?`,
    limit
  );
}

/** Calendar heatmap: workout count grouped by local date (YYYY-MM-DD). */
export async function volumeByDay(days = 42): Promise<Record<string, number>> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const rows = await all<{ day: string; n: number }>(
    `SELECT date(started_at, 'localtime') AS day, COUNT(*) AS n
       FROM workouts
      WHERE is_completed = 1 AND deleted_at IS NULL AND archived_at IS NULL AND started_at >= ?
      GROUP BY day`,
    since.toISOString()
  );
  return Object.fromEntries(rows.map((r) => [r.day, r.n]));
}

/** Training-session count per day for a month (YYYY-MM): workouts plus
 *  standalone cardio_sessions, so cardio-only days still mark the calendar. */
export async function workoutCountByMonth(monthPrefix: string): Promise<Record<string, number>> {
  const rows = await all<{ day: string; n: number }>(
    `SELECT day, COUNT(*) AS n FROM (
        SELECT date(started_at, 'localtime') AS day FROM workouts
         WHERE is_completed = 1 AND deleted_at IS NULL AND archived_at IS NULL
           AND strftime('%Y-%m', started_at, 'localtime') = ?
        UNION ALL
        SELECT date(started_at, 'localtime') AS day FROM cardio_sessions
         WHERE deleted_at IS NULL
           AND strftime('%Y-%m', started_at, 'localtime') = ?
      ) GROUP BY day`,
    monthPrefix,
    monthPrefix
  );
  return Object.fromEntries(rows.map((r) => [r.day, r.n]));
}

/** PR count per day for a specific month (YYYY-MM prefix). */
export async function prCountByMonth(monthPrefix: string): Promise<Record<string, number>> {
  const rows = await all<{ day: string; n: number }>(
    `SELECT date(achieved_at, 'localtime') AS day, COUNT(*) AS n
       FROM personal_records
      WHERE deleted_at IS NULL AND strftime('%Y-%m', achieved_at, 'localtime') = ?
      GROUP BY day`,
    monthPrefix
  );
  return Object.fromEntries(rows.map((r) => [r.day, r.n]));
}

/** List workouts for a specific date (YYYY-MM-DD). */
export async function listWorkoutsForDate(date: string): Promise<HistoryEntry[]> {
  return all<HistoryEntry>(
    `SELECT w.*,
            (SELECT COUNT(*) FROM workout_sets s
              WHERE s.workout_id = w.id AND s.is_completed = 1 AND s.deleted_at IS NULL) AS set_count,
            (SELECT COUNT(DISTINCT s2.exercise_id) FROM workout_sets s2
              WHERE s2.workout_id = w.id AND s2.deleted_at IS NULL) AS exercise_count,
            (SELECT COUNT(*) FROM personal_records pr
              WHERE pr.workout_id = w.id AND pr.deleted_at IS NULL) AS pr_count
       FROM workouts w
      WHERE w.is_completed = 1 AND w.deleted_at IS NULL AND w.archived_at IS NULL AND date(w.started_at, 'localtime') = ?
      ORDER BY w.started_at DESC`,
    date
  );
}

const CARDIO_LOG_COLS =
  'id, activity, started_at, duration_seconds, distance_m, avg_hr, calories, source';

/** Merged history for the logbook list view: workouts + standalone cardio. */
export async function listLogHistory(limit = 60): Promise<LogEntry[]> {
  const [w, c] = await Promise.all([
    listHistory(limit),
    all<Omit<LogCardioEntry, 'kind'>>(
      `SELECT ${CARDIO_LOG_COLS} FROM cardio_sessions
        WHERE deleted_at IS NULL ORDER BY started_at DESC LIMIT ?`,
      limit
    ),
  ]);
  return mergeLogEntries(w, c.map(toCardioEntry), limit);
}

/** Everything logged on one day (YYYY-MM-DD): workouts + cardio sessions. */
export async function listDayLog(date: string): Promise<LogEntry[]> {
  const [w, c] = await Promise.all([
    listWorkoutsForDate(date),
    all<Omit<LogCardioEntry, 'kind'>>(
      `SELECT ${CARDIO_LOG_COLS} FROM cardio_sessions
        WHERE deleted_at IS NULL AND date(started_at, 'localtime') = ?
        ORDER BY started_at DESC`,
      date
    ),
  ]);
  return mergeLogEntries(w, c.map(toCardioEntry));
}

export async function completeWorkout(
  id: string,
  patch: { completed_at: string; duration_seconds: number; total_volume_kg: number; notes?: string | null }
) {
  const t = touch();
  await run(
    `UPDATE workouts
        SET is_completed = 1, completed_at = ?, duration_seconds = ?,
            total_volume_kg = ?, notes = COALESCE(?, notes),
            updated_at = ?, dirty = 1
      WHERE id = ?`,
    patch.completed_at,
    patch.duration_seconds,
    patch.total_volume_kg,
    patch.notes ?? null,
    t,
    id
  );
}

/** Session feel rating (1-5), set from the post-workout summary. */
export async function setWorkoutFeel(id: string, feel: number | null) {
  await run(
    `UPDATE workouts SET feel = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    feel,
    touch(),
    id
  );
}

/** Retrospectively log a completed workout with sets in one transaction. */
export async function logManualWorkout(input: {
  title: string;
  started_at: string;
  completed_at: string;
  duration_seconds: number;
  user_id?: string | null;
  exercises: Array<{
    exercise_id: string;
    sets: Array<{
      weight_kg: number | null;
      reps: number | null;
      set_type?: 'normal' | 'warmup' | 'drop' | 'failure';
      is_completed?: boolean;
    }>;
  }>;
}): Promise<string> {
  const db = await getDb();
  const t = touch();
  const workoutId = uuid();
  let totalVolume = 0;
  const setRows: Array<{
    id: string;
    exercise_id: string;
    set_type: string;
    weight_kg: number | null;
    reps: number | null;
    is_completed: number;
  }> = [];
  for (const ex of input.exercises) {
    for (const s of ex.sets) {
      const w = s.weight_kg ?? 0;
      const r = s.reps ?? 0;
      if (s.is_completed !== false && w > 0 && r > 0) {
        totalVolume += w * r;
      }
      setRows.push({
        id: uuid(),
        exercise_id: ex.exercise_id,
        set_type: s.set_type ?? 'normal',
        weight_kg: s.weight_kg,
        reps: s.reps,
        is_completed: s.is_completed === false ? 0 : 1,
      });
    }
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO workouts
         (id, user_id, routine_id, title, started_at, completed_at, duration_seconds,
          total_volume_kg, is_completed, updated_at, dirty)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 1, ?, 1)`,
      workoutId,
      input.user_id ?? (await ownerId()),
      input.title,
      input.started_at,
      input.completed_at,
      input.duration_seconds,
      totalVolume,
      t
    );
    const stmt = await db.prepareAsync(
      `INSERT INTO workout_sets
         (id, workout_id, exercise_id, superset_id, set_order, set_type,
          weight_kg, reps, rpe, is_completed, updated_at, dirty)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, 1)`
    );
    try {
      let order = 0;
      for (const s of setRows) {
        await stmt.executeAsync(
          s.id,
          workoutId,
          s.exercise_id,
          order++,
          s.set_type,
          s.weight_kg,
          s.reps,
          s.is_completed,
          t
        );
      }
    } finally {
      await stmt.finalizeAsync();
    }

    // PRs - same evaluation as the live-workout finalizer. Manual entry is
    // strength-only (weight x reps) so only these three record types apply.
    for (const ex of input.exercises) {
      let bestE1rm = 0;
      let maxWeight = 0;
      let exVolume = 0;
      for (const s of ex.sets) {
        if (s.is_completed === false) continue;
        const w = s.weight_kg ?? 0;
        const r = s.reps ?? 0;
        exVolume += w * r;
        if (w > maxWeight) maxWeight = w;
        const e1rm = w > 0 && r > 0 ? brzycki(w, r) : 0;
        if (e1rm > bestE1rm) bestE1rm = e1rm;
      }
      const prev = await bestPRs(ex.exercise_id);
      const tryPR = async (type: string, value: number) => {
        if (value > 0 && value > (prev[type] ?? 0)) {
          await insertPR({
            exercise_id: ex.exercise_id,
            record_type: type,
            value,
            achieved_at: input.completed_at,
            workout_id: workoutId,
            user_id: input.user_id,
          });
        }
      };
      await tryPR('1rm', bestE1rm);
      await tryPR('max_weight', maxWeight);
      await tryPR('max_volume', exVolume);
    }
  });

  return workoutId;
}

export async function deleteWorkout(id: string) {
  // Archive instead of soft-deleting - kept for 28 days before permanent purge.
  // PRs set by this workout stop counting as current bests while archived;
  // restoreWorkout brings them back.
  const t = touch();
  await run(
    `UPDATE workouts SET archived_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    t,
    t,
    id
  );
  await run(
    `UPDATE personal_records SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE workout_id = ? AND deleted_at IS NULL`,
    t,
    t,
    id
  );
}

const ARCHIVE_DAYS = 28;

/** Permanently delete workouts archived more than ARCHIVE_DAYS days ago. */
export async function purgeExpiredArchives(): Promise<void> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const expired = await all<{ id: string }>(
    `SELECT id FROM workouts WHERE archived_at IS NOT NULL AND archived_at < ? AND deleted_at IS NULL`,
    cutoff
  );
  if (expired.length === 0) return;
  const t = touch();
  await db.withTransactionAsync(async () => {
    for (const w of expired) {
      await db.runAsync(
        `UPDATE workouts SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
        t,
        t,
        w.id
      );
      await db.runAsync(
        `UPDATE workout_sets SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE workout_id = ? AND deleted_at IS NULL`,
        t,
        t,
        w.id
      );
    }
  });
}

export interface ArchivedWorkout {
  id: string;
  title: string;
  started_at: string;
  completed_at: string | null;
  archived_at: string;
  duration_seconds: number | null;
  total_volume_kg: number;
  days_left: number;
}

export async function listArchivedWorkouts(): Promise<ArchivedWorkout[]> {
  await purgeExpiredArchives();
  const rows = await all<{
    id: string;
    title: string;
    started_at: string;
    completed_at: string | null;
    archived_at: string;
    duration_seconds: number | null;
    total_volume_kg: number;
  }>(
    `SELECT id, title, started_at, completed_at, archived_at, duration_seconds, total_volume_kg
       FROM workouts
      WHERE archived_at IS NOT NULL AND deleted_at IS NULL
      ORDER BY archived_at DESC`
  );
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    days_left: Math.max(
      0,
      ARCHIVE_DAYS - Math.floor((now - new Date(r.archived_at).getTime()) / (24 * 60 * 60 * 1000))
    ),
  }));
}

export async function restoreWorkout(id: string): Promise<void> {
  const t = touch();
  // Bring back only the PRs tombstoned by THIS archive (their deleted_at is
  // the workout's archived_at) - never resurrect an independently deleted PR.
  await run(
    `UPDATE personal_records SET deleted_at = NULL, updated_at = ?, dirty = 1
      WHERE workout_id = ? AND deleted_at = (SELECT archived_at FROM workouts WHERE id = ?)`,
    t,
    id,
    id
  );
  await run(
    `UPDATE workouts SET archived_at = NULL, updated_at = ?, dirty = 1 WHERE id = ?`,
    t,
    id
  );
}

export async function permanentlyDeleteWorkout(id: string): Promise<void> {
  const db = await getDb();
  const t = touch();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE workouts SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      t,
      t,
      id
    );
    await db.runAsync(
      `UPDATE workout_sets SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE workout_id = ? AND deleted_at IS NULL`,
      t,
      t,
      id
    );
    await db.runAsync(
      `UPDATE personal_records SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE workout_id = ? AND deleted_at IS NULL`,
      t,
      t,
      id
    );
  });
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

export async function getWorkoutSets(workoutId: string): Promise<WorkoutSet[]> {
  const rows = await all<SetRow>(
    `SELECT * FROM workout_sets
      WHERE workout_id = ? AND deleted_at IS NULL
      ORDER BY set_order ASC`,
    workoutId
  );
  return rows.map(toSet);
}

export interface SetInsert {
  id: string;
  exercise_id: string;
  superset_id: string | null;
  set_order: number;
  set_type: SetType;
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  duration_seconds?: number | null;
  distance_m?: number | null;
  avg_hr?: number | null;
  meta?: string | null;
  is_completed: boolean;
}

/** Replaces all sets for a workout inside a single transaction. */
export async function replaceWorkoutSets(workoutId: string, sets: SetInsert[]) {
  const db = await getDb();
  const t = touch();
  await db.withTransactionAsync(async () => {
    // Tombstone every live row first - sets absent from `sets` stay deleted,
    // and the tombstone (deleted_at + dirty) propagates to the cloud so the
    // row can't resurrect on the next pull.
    await db.runAsync(
      'UPDATE workout_sets SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE workout_id = ? AND deleted_at IS NULL',
      t,
      t,
      workoutId
    );
    const stmt = await db.prepareAsync(
      `INSERT INTO workout_sets
         (id, workout_id, exercise_id, superset_id, set_order, set_type,
          weight_kg, reps, rpe, duration_seconds, distance_m, avg_hr, meta,
          is_completed, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         workout_id = excluded.workout_id,
         exercise_id = excluded.exercise_id,
         superset_id = excluded.superset_id,
         set_order = excluded.set_order,
         set_type = excluded.set_type,
         weight_kg = excluded.weight_kg,
         reps = excluded.reps,
         duration_seconds = excluded.duration_seconds,
         distance_m = excluded.distance_m,
         avg_hr = excluded.avg_hr,
         meta = excluded.meta,
         rpe = excluded.rpe,
         is_completed = excluded.is_completed,
         deleted_at = NULL,
         updated_at = excluded.updated_at,
         dirty = 1`
    );
    try {
      for (const s of sets) {
        await stmt.executeAsync(
          s.id,
          workoutId,
          s.exercise_id,
          s.superset_id,
          s.set_order,
          s.set_type,
          s.weight_kg,
          s.reps,
          s.rpe,
          s.duration_seconds ?? null,
          s.distance_m ?? null,
          s.avg_hr ?? null,
          s.meta ?? null,
          s.is_completed ? 1 : 0,
          t
        );
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });
}

/** Persist live edits to a single set (used by hydrate/dirty tracking). */
export async function upsertSet(s: SetInsert & { workout_id: string }) {
  const t = touch();
  await run(
    `INSERT INTO workout_sets
       (id, workout_id, exercise_id, superset_id, set_order, set_type,
        weight_kg, reps, rpe, duration_seconds, distance_m, avg_hr, meta,
        is_completed, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
       superset_id = excluded.superset_id, set_order = excluded.set_order,
       set_type = excluded.set_type, weight_kg = excluded.weight_kg,
       reps = excluded.reps, rpe = excluded.rpe,
       duration_seconds = excluded.duration_seconds,
       distance_m = excluded.distance_m, avg_hr = excluded.avg_hr,
       meta = excluded.meta,
       is_completed = excluded.is_completed,
       updated_at = excluded.updated_at, dirty = 1`,
    s.id, s.workout_id, s.exercise_id, s.superset_id, s.set_order, s.set_type,
    s.weight_kg, s.reps, s.rpe, s.duration_seconds ?? null, s.distance_m ?? null,
    s.avg_hr ?? null, s.meta ?? null, s.is_completed ? 1 : 0, t
  );
}

/**
 * Ghost-set memory: the sets from the most recent completed session that
 * included this exercise, keyed by set_order.
 */
export async function lastPerformedSets(
  exerciseId: string
): Promise<{ set_order: number; weight_kg: number | null; reps: number | null; set_type: SetType }[]> {
  return all(
    `SELECT s.set_order, s.weight_kg, s.reps, s.set_type
       FROM workout_sets s
      WHERE s.exercise_id = ? AND s.is_completed = 1 AND s.deleted_at IS NULL
        AND s.workout_id = (
          SELECT s2.workout_id FROM workout_sets s2
            JOIN workouts w2 ON w2.id = s2.workout_id
           WHERE s2.exercise_id = ? AND s2.is_completed = 1 AND s2.deleted_at IS NULL
             AND w2.is_completed = 1 AND w2.deleted_at IS NULL AND w2.archived_at IS NULL
           ORDER BY w2.started_at DESC LIMIT 1
        )
      ORDER BY s.set_order ASC`,
    exerciseId,
    exerciseId
  );
}

// ---------------------------------------------------------------------------
// Personal records
// ---------------------------------------------------------------------------

export async function getPRs(exerciseId?: string): Promise<PersonalRecord[]> {
  if (exerciseId) {
    return all<PersonalRecord>(
      `SELECT * FROM personal_records
        WHERE exercise_id = ? AND deleted_at IS NULL
        ORDER BY achieved_at DESC`,
      exerciseId
    );
  }
  return all<PersonalRecord>(
    `SELECT * FROM personal_records WHERE deleted_at IS NULL ORDER BY achieved_at DESC`
  );
}

/** Current best value per record_type for an exercise. */
export async function bestPRs(exerciseId: string): Promise<Partial<Record<string, number>>> {
  const rows = await all<{ record_type: string; v: number }>(
    `SELECT record_type, MAX(value) AS v FROM personal_records
      WHERE exercise_id = ? AND deleted_at IS NULL
      GROUP BY record_type`,
    exerciseId
  );
  return Object.fromEntries(rows.map((r) => [r.record_type, r.v]));
}

export async function insertPR(input: {
  exercise_id: string;
  record_type: string;
  value: number;
  achieved_at: string;
  workout_id: string;
  user_id?: string | null;
}): Promise<string> {
  const id = uuid();
  await run(
    `INSERT INTO personal_records
       (id, user_id, exercise_id, record_type, value, achieved_at, workout_id, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    id,
    input.user_id ?? (await ownerId()),
    input.exercise_id,
    input.record_type,
    input.value,
    input.achieved_at,
    input.workout_id,
    touch()
  );
  return id;
}

/** e1RM history for the exercise-detail progression graph. */
export async function oneRMHistory(
  exerciseId: string
): Promise<{ achieved_at: string; value: number }[]> {
  return all(
    `SELECT achieved_at, value FROM personal_records
      WHERE exercise_id = ? AND record_type = '1rm' AND deleted_at IS NULL
      ORDER BY achieved_at ASC`,
    exerciseId
  );
}

/**
 * Completed sets still missing avg_hr, from workouts finished since `sinceIso`.
 * A set's updated_at ≈ its completion instant (sets persist on toggle), which
 * is what the retro-backfill bins HR samples against.
 */
export async function setsMissingHr(sinceIso: string): Promise<
  {
    set_id: string;
    set_completed_at: string;
    workout_id: string;
    workout_start: string;
    workout_end: string;
  }[]
> {
  return all(
    `SELECT ws.id AS set_id, ws.updated_at AS set_completed_at,
            w.id AS workout_id, w.started_at AS workout_start, w.completed_at AS workout_end
       FROM workout_sets ws
       JOIN workouts w ON w.id = ws.workout_id
      WHERE ws.is_completed = 1
        AND ws.avg_hr IS NULL
        AND ws.deleted_at IS NULL
        AND w.is_completed = 1
        AND w.completed_at IS NOT NULL
        AND w.completed_at >= ?
      ORDER BY w.completed_at DESC`,
    sinceIso
  );
}

/** Write a backfilled HR reading onto a set (marks dirty so it syncs). */
export async function setAvgHr(setId: string, bpm: number): Promise<void> {
  await run(
    `UPDATE workout_sets SET avg_hr = ?, updated_at = ?, dirty = 1
      WHERE id = ? AND avg_hr IS NULL`,
    Math.round(bpm),
    touch(),
    setId
  );
}
