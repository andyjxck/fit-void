import type { SQLiteDatabase } from 'expo-sqlite';

import { addRoutineExercise, createRoutine } from './repo/routines';

// Exercise IDs from seed.ts - e0000000-0000-4000-8000-{12-digit zero-padded n}
const EX = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface ExampleRoutine {
  title: string;
  folder: string;
  exercises: { id: string; sets: number; reps: number[]; rest: number }[];
}

// -----------------------------------------------------------------------------
// Real, well-known programs. Sources:
//   StrongLifts 5×5 - stronglifts.com
//   Starting Strength - Mark Rippetoe, startingstrength.com
//   Greyskull LP - John Sheaffer (Johnny Pain)
//   PHUL - Brandon Campbell, muscleandstrength.com
//   Classic PPL - standard push/pull/legs split
// -----------------------------------------------------------------------------

const EXAMPLES: ExampleRoutine[] = [
  // -- StrongLifts 5×5 ------------------------------------------------------
  {
    title: 'StrongLifts 5×5 - Workout A',
    folder: 'Examples · StrongLifts 5×5',
    exercises: [
      // Squat 5×5, Bench 5×5, Barbell Row 5×5 - rest 3 min
      { id: EX(25), sets: 5, reps: [5, 5, 5, 5, 5], rest: 180 }, // Barbell Back Squat
      { id: EX(1), sets: 5, reps: [5, 5, 5, 5, 5], rest: 180 }, // Barbell Bench Press
      { id: EX(11), sets: 5, reps: [5, 5, 5, 5, 5], rest: 180 }, // Barbell Row
    ],
  },
  {
    title: 'StrongLifts 5×5 - Workout B',
    folder: 'Examples · StrongLifts 5×5',
    exercises: [
      // Squat 5×5, OHP 5×5, Deadlift 1×5 - rest 3 min (deadlift 1 set only)
      { id: EX(25), sets: 5, reps: [5, 5, 5, 5, 5], rest: 180 }, // Barbell Back Squat
      { id: EX(19), sets: 5, reps: [5, 5, 5, 5, 5], rest: 180 }, // Overhead Press
      { id: EX(9), sets: 1, reps: [5], rest: 240 }, // Conventional Deadlift (1×5)
    ],
  },

  // -- Starting Strength (Novice LP) -----------------------------------------
  {
    title: 'Starting Strength - Workout A',
    folder: 'Examples · Starting Strength',
    exercises: [
      // Squat 3×5, Press 3×5, Deadlift 1×5, Chin-ups 3×failure
      { id: EX(25), sets: 3, reps: [5, 5, 5], rest: 180 }, // Barbell Back Squat
      { id: EX(19), sets: 3, reps: [5, 5, 5], rest: 180 }, // Overhead Press
      { id: EX(9), sets: 1, reps: [5], rest: 240 }, // Conventional Deadlift (1×5)
      { id: EX(13), sets: 3, reps: [8, 8, 8], rest: 120 }, // Chin-Up (3×failure → 8 target)
    ],
  },
  {
    title: 'Starting Strength - Workout B',
    folder: 'Examples · Starting Strength',
    exercises: [
      // Squat 3×5, Bench 3×5, Barbell Row 3×5 (substituting power clean for most gym users)
      { id: EX(25), sets: 3, reps: [5, 5, 5], rest: 180 }, // Barbell Back Squat
      { id: EX(1), sets: 3, reps: [5, 5, 5], rest: 180 }, // Barbell Bench Press
      { id: EX(11), sets: 3, reps: [5, 5, 5], rest: 180 }, // Barbell Row (sub for Power Clean)
    ],
  },

  // -- Greyskull LP ---------------------------------------------------------
  {
    title: 'Greyskull LP - Day 1',
    folder: 'Examples · Greyskull LP',
    exercises: [
      // Bench 2×5 + 1×5+ (AMRAP), Squat 2×5 + 1×5+, Curls 2×10-15
      { id: EX(1), sets: 3, reps: [5, 5, 8], rest: 180 }, // Barbell Bench Press (last set AMRAP)
      { id: EX(25), sets: 3, reps: [5, 5, 8], rest: 180 }, // Barbell Back Squat (last set AMRAP)
      { id: EX(35), sets: 2, reps: [12, 12], rest: 60 }, // Barbell Curl
    ],
  },
  {
    title: 'Greyskull LP - Day 2',
    folder: 'Examples · Greyskull LP',
    exercises: [
      // OHP 2×5 + 1×5+, Deadlift 1×5+, Chin-ups 2×max
      { id: EX(19), sets: 3, reps: [5, 5, 8], rest: 180 }, // Overhead Press (last set AMRAP)
      { id: EX(9), sets: 1, reps: [8], rest: 240 }, // Conventional Deadlift (1×5+ AMRAP)
      { id: EX(13), sets: 2, reps: [8, 8], rest: 120 }, // Chin-Up
    ],
  },

  // -- PHUL (Power Hypertrophy Upper Lower) ---------------------------------
  {
    title: 'PHUL - Upper Power',
    folder: 'Examples · PHUL',
    exercises: [
      // Heavy upper day - 3-5 rep range, long rest
      { id: EX(1), sets: 4, reps: [4, 4, 4, 4], rest: 180 }, // Barbell Bench Press
      { id: EX(11), sets: 4, reps: [4, 4, 4, 4], rest: 180 }, // Barbell Row
      { id: EX(4), sets: 3, reps: [8, 8, 8], rest: 120 }, // Incline Dumbbell Press
      { id: EX(12), sets: 3, reps: [8, 8, 8], rest: 120 }, // Pull-Up
      { id: EX(19), sets: 3, reps: [6, 6, 6], rest: 120 }, // Overhead Press
      { id: EX(35), sets: 3, reps: [8, 8, 8], rest: 90 }, // Barbell Curl
      { id: EX(42), sets: 3, reps: [10, 10, 10], rest: 90 }, // Skullcrusher
    ],
  },
  {
    title: 'PHUL - Lower Power',
    folder: 'Examples · PHUL',
    exercises: [
      // Heavy lower day - 3-5 rep range, long rest
      { id: EX(25), sets: 4, reps: [4, 4, 4, 4], rest: 180 }, // Barbell Back Squat
      { id: EX(9), sets: 3, reps: [4, 4, 4], rest: 180 }, // Conventional Deadlift
      { id: EX(28), sets: 3, reps: [10, 10, 10], rest: 120 }, // Leg Press
      { id: EX(31), sets: 3, reps: [8, 8, 8], rest: 90 }, // Lying Leg Curl
      { id: EX(33), sets: 4, reps: [10, 10, 10, 10], rest: 60 }, // Standing Calf Raise
    ],
  },
  {
    title: 'PHUL - Upper Hypertrophy',
    folder: 'Examples · PHUL',
    exercises: [
      // Volume upper day - 8-12 rep range, moderate rest
      { id: EX(2), sets: 4, reps: [10, 10, 10, 10], rest: 90 }, // Incline Barbell Bench Press
      { id: EX(15), sets: 4, reps: [10, 10, 10, 10], rest: 90 }, // Seated Cable Row
      { id: EX(5), sets: 3, reps: [12, 12, 12], rest: 60 }, // Cable Fly
      { id: EX(16), sets: 3, reps: [10, 10, 10], rest: 90 }, // Single-Arm Dumbbell Row
      { id: EX(21), sets: 3, reps: [15, 15, 15], rest: 45 }, // Lateral Raise
      { id: EX(38), sets: 3, reps: [12, 12, 12], rest: 60 }, // Preacher Curl
      { id: EX(39), sets: 3, reps: [12, 12, 12], rest: 60 }, // Tricep Pushdown
    ],
  },
  {
    title: 'PHUL - Lower Hypertrophy',
    folder: 'Examples · PHUL',
    exercises: [
      // Volume lower day - 8-15 rep range, moderate rest
      { id: EX(26), sets: 4, reps: [10, 10, 10, 10], rest: 90 }, // Front Squat
      { id: EX(29), sets: 3, reps: [12, 12, 12], rest: 90 }, // Walking Lunge
      { id: EX(30), sets: 4, reps: [12, 12, 12, 12], rest: 60 }, // Leg Extension
      { id: EX(31), sets: 4, reps: [12, 12, 12, 12], rest: 60 }, // Lying Leg Curl
      { id: EX(33), sets: 4, reps: [15, 15, 15, 15], rest: 45 }, // Standing Calf Raise
    ],
  },

  // -- Classic PPL (6-day) --------------------------------------------------
  {
    title: 'Push Day',
    folder: 'Examples · PPL',
    exercises: [
      { id: EX(1), sets: 4, reps: [6, 6, 6, 6], rest: 150 }, // Barbell Bench Press
      { id: EX(2), sets: 3, reps: [8, 8, 8], rest: 120 }, // Incline Barbell Bench Press
      { id: EX(19), sets: 3, reps: [8, 8, 8], rest: 120 }, // Overhead Press
      { id: EX(21), sets: 3, reps: [12, 12, 12], rest: 60 }, // Lateral Raise
      { id: EX(39), sets: 3, reps: [12, 12, 12], rest: 60 }, // Tricep Pushdown
      { id: EX(6), sets: 3, reps: [10, 10, 10], rest: 60 }, // Chest Dip
    ],
  },
  {
    title: 'Pull Day',
    folder: 'Examples · PPL',
    exercises: [
      { id: EX(9), sets: 1, reps: [5], rest: 180 }, // Conventional Deadlift
      { id: EX(11), sets: 4, reps: [8, 8, 8, 8], rest: 120 }, // Barbell Row
      { id: EX(12), sets: 3, reps: [8, 8, 8], rest: 90 }, // Pull-Up
      { id: EX(14), sets: 3, reps: [10, 10, 10], rest: 90 }, // Lat Pulldown
      { id: EX(18), sets: 3, reps: [15, 15, 15], rest: 60 }, // Face Pull
      { id: EX(35), sets: 3, reps: [10, 10, 10], rest: 60 }, // Barbell Curl
      { id: EX(37), sets: 2, reps: [12, 12], rest: 45 }, // Hammer Curl
    ],
  },
  {
    title: 'Leg Day',
    folder: 'Examples · PPL',
    exercises: [
      { id: EX(25), sets: 4, reps: [6, 6, 6, 6], rest: 180 }, // Barbell Back Squat
      { id: EX(27), sets: 3, reps: [8, 8, 8], rest: 120 }, // Romanian Deadlift
      { id: EX(28), sets: 3, reps: [10, 10, 10], rest: 90 }, // Leg Press
      { id: EX(30), sets: 3, reps: [12, 12, 12], rest: 60 }, // Leg Extension
      { id: EX(31), sets: 3, reps: [12, 12, 12], rest: 60 }, // Lying Leg Curl
      { id: EX(33), sets: 4, reps: [15, 15, 15, 15], rest: 45 }, // Standing Calf Raise
    ],
  },
];

export async function seedExampleRoutines(db: SQLiteDatabase): Promise<void> {
  const t = new Date().toISOString();

  // Clean up old example routines from previous seed versions (folders without 'Examples ·' prefix)
  await db.runAsync(
    `UPDATE routines SET deleted_at = ?, updated_at = ?, dirty = 1
      WHERE folder_name IN ('PPL', 'Upper / Lower', '5×5') AND deleted_at IS NULL`,
    t,
    t
  );

  // Tombstone routine_exercises orphaned by a deleted routine so they can't
  // resurface. User routines sync their tombstones; template children stay
  // dirty = 0 because they never leave the device.
  await db.runAsync(
    `UPDATE routine_exercises SET deleted_at = ?, updated_at = ?, dirty = 1
      WHERE deleted_at IS NULL
        AND routine_id IN (SELECT id FROM routines WHERE deleted_at IS NOT NULL AND is_template = 0)`,
    t,
    t
  );
  await db.runAsync(
    `UPDATE routine_exercises SET deleted_at = ?, updated_at = ?
      WHERE deleted_at IS NULL
        AND routine_id IN (SELECT id FROM routines WHERE deleted_at IS NOT NULL AND is_template = 1)`,
    t,
    t
  );

  // Seed only when the examples are entirely absent - tombstones included.
  // Once seeded, a user's edit or deletion is permanent: never wipe, never
  // resurrect a deleted example, never reseed a partially removed set.
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM routines WHERE folder_name LIKE 'Examples ·%'`
  );
  if (row && row.n > 0) return;

  for (const r of EXAMPLES) {
    const routine = await createRoutine({ title: r.title, folder_name: r.folder });
    // Bundled examples are local-only templates: unowned, never pushed.
    await db.runAsync(
      `UPDATE routines SET is_template = 1, user_id = NULL, dirty = 0 WHERE id = ?`,
      routine.id
    );
    for (let i = 0; i < r.exercises.length; i++) {
      const ex = r.exercises[i];
      await addRoutineExercise({
        routine_id: routine.id,
        exercise_id: ex.id,
        order_index: i,
        rest_seconds: ex.rest,
        target_sets: ex.sets,
        target_reps: ex.reps,
      });
    }
  }
  // Template children never leave the device either.
  await db.runAsync(
    `UPDATE routine_exercises SET dirty = 0
      WHERE routine_id IN (SELECT id FROM routines WHERE is_template = 1)`
  );
}
