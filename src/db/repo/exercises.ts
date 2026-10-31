import type { Equipment, Exercise, TrackingType } from '@/lib/types';

import { all, first, ownerId, run, softDelete, touch, uuid } from './helpers';

interface ExerciseRow {
  id: string;
  created_by: string | null;
  name: string;
  target_muscle: string;
  secondary_muscles: string;
  equipment: Equipment;
  tracking_type: TrackingType;
  instructions: string | null;
  is_custom: number;
  is_favourite: number;
  github_image_id: string | null;
}

const toExercise = (r: ExerciseRow): Exercise => ({
  id: r.id,
  created_by: r.created_by,
  name: r.name,
  target_muscle: r.target_muscle,
  secondary_muscles: JSON.parse(r.secondary_muscles || '[]'),
  equipment: r.equipment,
  tracking_type: r.tracking_type ?? 'strength',
  instructions: r.instructions,
  is_custom: r.is_custom === 1,
  is_favourite: r.is_favourite === 1,
  github_image_id: r.github_image_id,
});

const BASE = 'SELECT * FROM exercises WHERE deleted_at IS NULL';

export async function listExercises(filter?: {
  muscle?: string;
  equipment?: Equipment;
  query?: string;
  favouritesOnly?: boolean;
  sort?: 'name' | 'muscle' | 'favourites';
}): Promise<Exercise[]> {
  let sql = BASE;
  const params: (string | null)[] = [];
  if (filter?.muscle) {
    sql += ' AND target_muscle = ?';
    params.push(filter.muscle);
  }
  if (filter?.equipment) {
    sql += ' AND equipment = ?';
    params.push(filter.equipment);
  }
  if (filter?.query) {
    sql += ' AND name LIKE ?';
    params.push(`%${filter.query}%`);
  }
  if (filter?.favouritesOnly) {
    sql += ' AND is_favourite = 1';
  }
  switch (filter?.sort) {
    case 'muscle':
      sql += ' ORDER BY target_muscle ASC, name ASC';
      break;
    case 'favourites':
      sql += ' ORDER BY is_favourite DESC, name ASC';
      break;
    default:
      sql += ' ORDER BY name ASC';
      break;
  }
  return (await all<ExerciseRow>(sql, ...params)).map(toExercise);
}

export async function getExercise(id: string): Promise<Exercise | null> {
  const r = await first<ExerciseRow>(`${BASE} AND id = ?`, id);
  return r ? toExercise(r) : null;
}

export async function listMuscles(): Promise<string[]> {
  const rows = await all<{ target_muscle: string }>(
    `SELECT DISTINCT target_muscle FROM exercises WHERE deleted_at IS NULL ORDER BY target_muscle`
  );
  return rows.map((r) => r.target_muscle);
}

export async function createExercise(input: {
  name: string;
  target_muscle: string;
  secondary_muscles?: string[];
  equipment: Equipment;
  tracking_type?: TrackingType;
  instructions?: string;
  user_id?: string | null;
  github_image_id?: string | null;
}): Promise<Exercise> {
  const id = uuid();
  const t = touch();
  await run(
    `INSERT INTO exercises
       (id, created_by, name, target_muscle, secondary_muscles, equipment,
        tracking_type, instructions, is_custom, is_favourite, github_image_id, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, 1)`,
    id,
    input.user_id ?? (await ownerId()),
    input.name.trim(),
    input.target_muscle,
    JSON.stringify(input.secondary_muscles ?? []),
    input.equipment,
    input.tracking_type ?? 'strength',
    input.instructions?.trim() ?? null,
    input.github_image_id ?? null,
    t
  );
  return (await getExercise(id))!;
}

/** Re-tag how a set is logged (strength/cardio/hold/carry). */
export async function updateExerciseTrackingType(
  id: string,
  tracking_type: TrackingType
): Promise<void> {
  const t = touch();
  await run(
    `UPDATE exercises SET tracking_type = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    tracking_type,
    t,
    id
  );
}

export async function deleteExercise(id: string) {
  const t = touch();
  // Cascade: routine slots and favourites can't outlive the exercise -
  // getRoutineExercises doesn't join exercises.deleted_at, so without this a
  // deleted custom exercise lingers as an 'Exercise' placeholder in routines.
  await run(
    `UPDATE routine_exercises SET deleted_at = ?, updated_at = ?, dirty = 1
      WHERE exercise_id = ? AND deleted_at IS NULL`,
    t, t, id
  );
  await run(
    `UPDATE exercise_favourites SET deleted_at = ?, updated_at = ?, dirty = 1
      WHERE exercise_id = ? AND deleted_at IS NULL`,
    t, t, id
  );
  await softDelete('exercises', id);
}

export async function toggleFavourite(id: string): Promise<void> {
  const t = touch();
  const row = await first<{ is_favourite: number }>(
    `SELECT is_favourite FROM exercises WHERE id = ?`,
    id
  );
  if (!row) return;
  const next = row.is_favourite === 1 ? 0 : 1;
  await run(
    `UPDATE exercises SET is_favourite = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    next,
    t,
    id
  );
  // Per-user state lives in exercise_favourites so it syncs without writing
  // to the shared library row.
  const existing = await first<{ id: string }>(
    `SELECT id FROM exercise_favourites
      WHERE exercise_id = ? AND COALESCE(user_id, '') = COALESCE(?, '')`,
    id,
    await ownerId()
  );
  if (existing) {
    await run(
      `UPDATE exercise_favourites
        SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      next === 1 ? null : t,
      t,
      existing.id
    );
  } else if (next === 1) {
    await run(
      `INSERT INTO exercise_favourites (id, user_id, exercise_id, updated_at, dirty)
       VALUES (?, ?, ?, ?, 1)`,
      uuid(),
      await ownerId(),
      id,
      t
    );
  }
}
