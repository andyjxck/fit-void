import { getDb } from '@/db/client';
import { latestWeightKg } from '@/db/repo/measurements';
import { localDay } from '@/db/repo/nutrition';

import { muscleCategory, recoveryScore, type LiftProgress, type MuscleCategory, type MuscleSets, type RecentPR, type RecoveryInputs, type RecoveryResult } from './insightRules';

export * from './insightRules';

/**
 * Analytics engine for the Void tab. Everything here reads local SQLite and
 * turns raw sets into things a lifter actually cares about: am I getting
 * stronger, am I consistent, what's stalling, what am I neglecting.
 */

const COMPLETED_SETS = `
  FROM workout_sets s
  JOIN workouts w ON w.id = s.workout_id
  JOIN exercises e ON e.id = s.exercise_id
 WHERE s.is_completed = 1 AND s.deleted_at IS NULL AND s.set_type != 'warmup'
   AND w.is_completed = 1 AND w.deleted_at IS NULL AND w.archived_at IS NULL`;

const EPLEY = `s.weight_kg * (1 + COALESCE(s.reps, 0) / 30.0)`;

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();

// -- Strength --------------------------------------------------------------


export async function liftProgress(limit = 6): Promise<LiftProgress[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    exercise_id: string;
    name: string;
    best: number;
    recent: number | null;
    prior: number | null;
    sessions: number;
  }>(
    `SELECT s.exercise_id, e.name,
            MAX(${EPLEY}) AS best,
            MAX(CASE WHEN w.started_at >= ? THEN ${EPLEY} END) AS recent,
            MAX(CASE WHEN w.started_at >= ? AND w.started_at < ? THEN ${EPLEY} END) AS prior,
            COUNT(DISTINCT CASE WHEN w.started_at >= ? THEN w.id END) AS sessions
       ${COMPLETED_SETS}
         AND s.weight_kg > 0 AND s.reps > 0
       GROUP BY s.exercise_id
       ORDER BY best DESC
       LIMIT ?`,
    iso(30),
    iso(60),
    iso(30),
    iso(42),
    limit
  );
  return rows.map((r) => ({
    exerciseId: r.exercise_id,
    name: r.name,
    best: r.best,
    recent: r.recent ?? 0,
    prior: r.prior ?? 0,
    sessions: r.sessions,
  }));
}

/** Per-exercise best for the profile PB picker - reads real PRs from
 * personal_records (1rm / max_weight / max_volume), plus bodyweight
 * rep bests for moves with no recorded weight. */
export interface PersonalBest {
  exerciseId: string;
  name: string;
  recordType: '1rm' | 'max_weight' | 'max_volume' | 'max_reps';
  weight_kg: number;
  reps: number;
  label: string;
}

export async function personalBests(limit = 60): Promise<PersonalBest[]> {
  const db = await getDb();
  // One row per exercise × record_type - the all-time best value.
  const rows = await db.getAllAsync<{
    exercise_id: string;
    name: string;
    record_type: string;
    v: number;
  }>(
    `SELECT pr.exercise_id, e.name, pr.record_type, MAX(pr.value) AS v
       FROM personal_records pr
       JOIN exercises e ON e.id = pr.exercise_id
      WHERE pr.deleted_at IS NULL
        -- Hold/distance PRs aren't weight values - the social trophy case
        -- below assumes kg, so they're excluded here rather than misrendered.
        AND pr.record_type NOT IN ('max_hold_seconds', 'max_distance')
      GROUP BY pr.exercise_id, pr.record_type
      ORDER BY v DESC
      LIMIT ?`,
    limit
  );
  const out: PersonalBest[] = rows.map((r) => ({
    exerciseId: r.exercise_id,
    name: r.name,
    recordType: r.record_type as PersonalBest['recordType'],
    weight_kg: r.v,
    reps: 0,
    label:
      r.record_type === '1rm' ? 'est. 1RM'
      : r.record_type === 'max_weight' ? 'heaviest'
      : 'volume',
  }));
  // Bodyweight rep bests for exercises with no PR rows - restricted to actual
  // bodyweight equipment so a weightless bench-press set doesn't count.
  const have = new Set(rows.map((r) => r.exercise_id));
  const bw = await db.getAllAsync<{ exercise_id: string; name: string; v: number }>(
    `SELECT s.exercise_id, e.name, MAX(s.reps) AS v
       ${COMPLETED_SETS}
         AND e.equipment = 'bodyweight' AND s.weight_kg = 0 AND s.reps > 0
       GROUP BY s.exercise_id`
  );
  for (const r of bw) {
    if (have.has(r.exercise_id)) continue;
    out.push({
      exerciseId: r.exercise_id,
      name: r.name,
      recordType: 'max_reps',
      weight_kg: 0,
      reps: r.v,
      label: 'reps',
    });
  }
  return out;
}

/**
 * Top-5 est. 1RMs combined now vs 30 days ago - one number for "am I stronger".
 * When bodyweight is logged it's relative: sum of (e1RM ÷ bodyweight) × 100, a
 * dimensionless points score like other apps. Otherwise the raw kg sum.
 */
export async function strengthScore(): Promise<{ now: number; prior: number; relative: boolean }> {
  const lifts = await liftProgress(5);
  const now = lifts.reduce((s, l) => s + (l.recent || l.best), 0);
  const prior = lifts.reduce((s, l) => s + (l.prior || l.recent || l.best), 0);
  const bw = await latestWeightKg();
  if (!bw || bw <= 0) return { now, prior, relative: false };
  // Same bodyweight for both windows so the delta tracks strength, not weight drift.
  return {
    now: Math.round((now / bw) * 100),
    prior: Math.round((prior / bw) * 100),
    relative: true,
  };
}

// -- Volume & balance ------------------------------------------------------


export async function setsByMuscle(days = 7): Promise<MuscleSets[]> {
  const db = await getDb();
  return db.getAllAsync<MuscleSets>(
    `SELECT e.target_muscle AS muscle, COUNT(*) AS sets, MAX(w.started_at) AS lastAt
       ${COMPLETED_SETS}
         AND w.started_at >= ?
       GROUP BY e.target_muscle
       ORDER BY sets DESC`,
    iso(days)
  );
}

/** Muscles trained in the last 60d but not in the last `staleDays`. */
export async function neglectedMuscles(staleDays = 7): Promise<{ muscle: string; daysAgo: number }[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ muscle: string; lastAt: string }>(
    `SELECT e.target_muscle AS muscle, MAX(w.started_at) AS lastAt
       ${COMPLETED_SETS}
         AND w.started_at >= ?
       GROUP BY e.target_muscle`,
    iso(60)
  );
  const now = Date.now();
  return rows
    .map((r) => ({ muscle: r.muscle, daysAgo: Math.floor((now - new Date(r.lastAt).getTime()) / 86400000) }))
    .filter((r) => r.daysAgo >= staleDays)
    .sort((a, b) => b.daysAgo - a.daysAgo);
}

export async function categorySplit(days = 28): Promise<Record<MuscleCategory, number>> {
  const rows = await setsByMuscle(days);
  const out: Record<MuscleCategory, number> = { Push: 0, Pull: 0, Legs: 0, Core: 0 };
  for (const r of rows) out[muscleCategory(r.muscle)] += r.sets;
  return out;
}

// -- Consistency -----------------------------------------------------------

export async function workoutDates(days = 84): Promise<Set<string>> {
  const db = await getDb();
  // started_at is a UTC instant - convert to LOCAL YYYY-MM-DD keys to match
  // the day keys weekHits/weekStreak build (a UTC substr shifts the grid a
  // day for non-UTC users).
  const rows = await db.getAllAsync<{ started_at: string }>(
    `SELECT DISTINCT started_at
       FROM workouts
      WHERE is_completed = 1 AND deleted_at IS NULL AND archived_at IS NULL
        AND started_at >= ?`,
    iso(days)
  );
  return new Set(rows.map((r) => localDay(new Date(r.started_at))));
}

// -- PRs -------------------------------------------------------------------


export async function recentPRs(days = 30, limit = 8): Promise<RecentPR[]> {
  const db = await getDb();
  return db.getAllAsync<RecentPR>(
    `SELECT p.id, p.exercise_id, e.name, p.record_type AS recordType, p.value, p.achieved_at AS achievedAt
       FROM personal_records p
       JOIN exercises e ON e.id = p.exercise_id
      WHERE p.deleted_at IS NULL AND p.achieved_at >= ?
      ORDER BY p.achieved_at DESC
      LIMIT ?`,
    iso(days),
    limit
  );
}

// -- Recovery ----------------------------------------------------------------

/**
 * Gathers the recovery inputs from local tables and scores readiness.
 * Returns null when there's not enough real data to score - a number built
 * entirely from neutral defaults would be meaningless.
 */
export async function recoveryStatus(): Promise<RecoveryResult | null> {
  const db = await getDb();

  const lastW = await db.getFirstAsync<{ started_at: string; feel: number | null }>(
    `SELECT started_at, feel FROM workouts
      WHERE is_completed = 1 AND deleted_at IS NULL AND archived_at IS NULL
      ORDER BY started_at DESC LIMIT 1`
  );

  const sleep = await db.getFirstAsync<{ value: number }>(
    `SELECT value FROM body_measurements
      WHERE metric_type = 'sleep_hours' AND deleted_at IS NULL
        AND logged_at >= ?
      ORDER BY logged_at DESC LIMIT 1`,
    iso(2)
  );

  const hrs = await db.getAllAsync<{ value: number }>(
    `SELECT value FROM body_measurements
      WHERE metric_type = 'resting_hr' AND deleted_at IS NULL
        AND logged_at >= ?
      ORDER BY logged_at DESC LIMIT 15`,
    iso(14)
  );

  const vols = await db.getFirstAsync<{ week: number | null; prior: number | null }>(
    `SELECT
       SUM(CASE WHEN started_at >= ? THEN total_volume_kg END) AS week,
       SUM(CASE WHEN started_at >= ? AND started_at < ? THEN total_volume_kg END) AS prior
       FROM workouts
      WHERE is_completed = 1 AND deleted_at IS NULL AND archived_at IS NULL`,
    iso(7),
    iso(35),
    iso(7)
  );

  const inputs: RecoveryInputs = {
    daysSinceLastWorkout: lastW
      ? Math.floor((Date.now() - new Date(lastW.started_at).getTime()) / 86400000)
      : null,
    sleepHours: sleep?.value ?? null,
    restingHr: hrs[0]?.value ?? null,
    restingHrBaseline:
      hrs.length > 1 ? hrs.slice(1).reduce((a, h) => a + h.value, 0) / (hrs.length - 1) : null,
    weekVolumeKg: vols?.week ?? 0,
    avgWeekVolumeKg: (vols?.prior ?? 0) / 4,
    lastFeel: lastW?.feel ?? null,
  };

  // Insufficient data: a readiness score needs at least one completed session
  // plus one other real signal (sleep, resting HR, or volume history).
  const signals =
    (lastW != null ? 1 : 0) +
    (inputs.sleepHours != null ? 1 : 0) +
    (inputs.restingHr != null ? 1 : 0) +
    ((inputs.weekVolumeKg ?? 0) > 0 || (inputs.avgWeekVolumeKg ?? 0) > 0 ? 1 : 0);
  if (lastW == null || signals < 2) return null;

  return recoveryScore(inputs);
}

// -- Lifetime --------------------------------------------------------------

export interface Lifetime {
  workouts: number;
  sets: number;
  volumeKg: number;
  seconds: number;
}

export async function lifetime(): Promise<Lifetime> {
  const db = await getDb();
  const w = await db.getFirstAsync<{ n: number; vol: number | null; secs: number | null }>(
    `SELECT COUNT(*) AS n, SUM(total_volume_kg) AS vol, SUM(duration_seconds) AS secs
       FROM workouts
      WHERE is_completed = 1 AND deleted_at IS NULL AND archived_at IS NULL`
  );
  const s = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n ${COMPLETED_SETS}`);
  return {
    workouts: w?.n ?? 0,
    sets: s?.n ?? 0,
    volumeKg: w?.vol ?? 0,
    seconds: w?.secs ?? 0,
  };
}

