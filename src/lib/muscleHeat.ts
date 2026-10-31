import { all } from '@/db/repo/helpers';
import { calorieHistory } from '@/db/repo/nutrition';

import { normalizeMuscle } from './muscleMap';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();

export interface MuscleHeatResult {
  /** canonical muscle → 0..1 intensity (max-volume muscle = 1). */
  heat: Map<string, number>;
  /** canonical muscle → raw volume kg (target full, secondary 50%). */
  volume: Map<string, number>;
  /** canonical muscle → completed working-set count (target muscle only). */
  setsByMuscle: Map<string, number>;
  /** per-day eaten calories for the same window, oldest first. */
  caloriesByDay: { day: string; calories: number }[];
  totalVolume: number;
  calories: number;
  sets: number;
}

/**
 * Volume score per muscle group from completed (non-warmup) sets in the last
 * `days` days. Target muscle earns full volume; secondaries earn 50%.
 */
export async function muscleHeat(days: number): Promise<MuscleHeatResult> {
  const rows = await all<{
    weight_kg: number | null;
    reps: number | null;
    target_muscle: string;
    secondary_muscles: string;
  }>(
    `SELECT s.weight_kg, s.reps, e.target_muscle, e.secondary_muscles
       FROM workout_sets s
       JOIN workouts w ON w.id = s.workout_id
       JOIN exercises e ON e.id = s.exercise_id
      WHERE s.is_completed = 1 AND s.deleted_at IS NULL AND s.set_type != 'warmup'
        AND w.is_completed = 1 AND w.deleted_at IS NULL AND w.archived_at IS NULL
        AND w.started_at >= ?`,
    iso(days)
  );

  const volume = new Map<string, number>();
  const setsByMuscle = new Map<string, number>();
  let totalVolume = 0;
  let sets = 0;
  for (const r of rows) {
    const w = r.weight_kg ?? 0;
    const rep = r.reps ?? 0;
    if (w <= 0 || rep <= 0) continue;
    const v = w * rep;
    totalVolume += v;
    sets++;
    const target = normalizeMuscle(r.target_muscle);
    setsByMuscle.set(target, (setsByMuscle.get(target) ?? 0) + 1);
    volume.set(target, (volume.get(target) ?? 0) + v);
    let secondary: string[] = [];
    try {
      secondary = JSON.parse(r.secondary_muscles || '[]');
    } catch {
      // malformed JSON - ignore secondaries
    }
    for (const s of secondary) {
      const m = normalizeMuscle(s);
      if (m === target) continue;
      volume.set(m, (volume.get(m) ?? 0) + v * 0.5);
    }
  }

  const max = Math.max(1, ...volume.values());
  const heat = new Map<string, number>();
  for (const [m, v] of volume) heat.set(m, v / max);

  const calRows = await calorieHistory(days);
  const calories = calRows.reduce((a, b) => a + b.calories, 0);

  return { heat, volume, setsByMuscle, caloriesByDay: calRows, totalVolume, calories, sets };
}
