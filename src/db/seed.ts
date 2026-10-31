import type { SQLiteDatabase } from 'expo-sqlite';

import type { Equipment, TrackingType } from '@/lib/types';

/**
 * Default exercise library shipped with the app - offline-first means these
 * must exist before any network is involved. UUIDs are hardcoded so that a
 * cloud copy of the same library upserts by id instead of duplicating.
 */
const E = 'e0000000-0000-4000-8000-';

interface SeedExercise {
  id: string;
  name: string;
  muscle: string;
  secondary: string[];
  equipment: Equipment;
  trackingType: TrackingType;
}

const S = (
  n: number,
  name: string,
  muscle: string,
  secondary: string[],
  equipment: Equipment,
  trackingType: TrackingType = 'strength'
): SeedExercise => ({
  id: `${E}${String(n).padStart(12, '0')}`,
  name,
  muscle,
  secondary,
  equipment,
  trackingType,
});

const LIBRARY: SeedExercise[] = [
  // Chest
  S(1, 'Barbell Bench Press', 'Chest', ['Triceps', 'Shoulders'], 'barbell'),
  S(2, 'Incline Barbell Bench Press', 'Chest', ['Triceps', 'Shoulders'], 'barbell'),
  S(3, 'Dumbbell Bench Press', 'Chest', ['Triceps', 'Shoulders'], 'dumbbell'),
  S(4, 'Incline Dumbbell Press', 'Chest', ['Triceps', 'Shoulders'], 'dumbbell'),
  S(5, 'Cable Fly', 'Chest', ['Shoulders'], 'cable'),
  S(6, 'Chest Dip', 'Chest', ['Triceps', 'Shoulders'], 'bodyweight'),
  S(7, 'Push-Up', 'Chest', ['Triceps', 'Shoulders'], 'bodyweight'),
  S(8, 'Machine Chest Press', 'Chest', ['Triceps'], 'machine'),
  // Back
  S(9, 'Conventional Deadlift', 'Back', ['Glutes', 'Hamstrings', 'Traps'], 'barbell'),
  S(10, 'Sumo Deadlift', 'Back', ['Glutes', 'Hamstrings'], 'barbell'),
  S(11, 'Barbell Row', 'Back', ['Biceps', 'Lats'], 'barbell'),
  S(12, 'Pull-Up', 'Back', ['Biceps', 'Lats'], 'bodyweight'),
  S(13, 'Chin-Up', 'Back', ['Biceps'], 'bodyweight'),
  S(14, 'Lat Pulldown', 'Back', ['Biceps'], 'cable'),
  S(15, 'Seated Cable Row', 'Back', ['Biceps', 'Lats'], 'cable'),
  S(16, 'Single-Arm Dumbbell Row', 'Back', ['Biceps', 'Lats'], 'dumbbell'),
  S(17, 'T-Bar Row', 'Back', ['Biceps', 'Lats'], 'barbell'),
  S(18, 'Face Pull', 'Shoulders', ['Rear Delts', 'Traps'], 'cable'),
  // Shoulders
  S(19, 'Overhead Press', 'Shoulders', ['Triceps'], 'barbell'),
  S(20, 'Dumbbell Shoulder Press', 'Shoulders', ['Triceps'], 'dumbbell'),
  S(21, 'Lateral Raise', 'Shoulders', [], 'dumbbell'),
  S(22, 'Rear Delt Fly', 'Shoulders', ['Traps'], 'dumbbell'),
  S(23, 'Barbell Shrug', 'Traps', ['Shoulders'], 'barbell'),
  S(24, 'Machine Shoulder Press', 'Shoulders', ['Triceps'], 'machine'),
  // Legs
  S(25, 'Barbell Back Squat', 'Quads', ['Glutes', 'Hamstrings'], 'barbell'),
  S(26, 'Front Squat', 'Quads', ['Glutes', 'Core'], 'barbell'),
  S(27, 'Romanian Deadlift', 'Hamstrings', ['Glutes', 'Lower Back'], 'barbell'),
  S(28, 'Leg Press', 'Quads', ['Glutes'], 'machine'),
  S(29, 'Walking Lunge', 'Quads', ['Glutes', 'Hamstrings'], 'dumbbell'),
  S(30, 'Leg Extension', 'Quads', [], 'machine'),
  S(31, 'Lying Leg Curl', 'Hamstrings', [], 'machine'),
  S(32, 'Hip Thrust', 'Glutes', ['Hamstrings'], 'barbell'),
  S(33, 'Standing Calf Raise', 'Calves', [], 'machine'),
  S(34, 'Bulgarian Split Squat', 'Quads', ['Glutes'], 'dumbbell'),
  // Arms
  S(35, 'Barbell Curl', 'Biceps', ['Forearms'], 'barbell'),
  S(36, 'Dumbbell Curl', 'Biceps', ['Forearms'], 'dumbbell'),
  S(37, 'Hammer Curl', 'Biceps', ['Forearms'], 'dumbbell'),
  S(38, 'Preacher Curl', 'Biceps', [], 'barbell'),
  S(39, 'Tricep Pushdown', 'Triceps', [], 'cable'),
  S(40, 'Overhead Tricep Extension', 'Triceps', [], 'cable'),
  S(41, 'Close-Grip Bench Press', 'Triceps', ['Chest'], 'barbell'),
  S(42, 'Skullcrusher', 'Triceps', [], 'barbell'),
  // Core
  S(43, 'Plank', 'Core', [], 'bodyweight', 'hold'),
  S(44, 'Hanging Leg Raise', 'Core', ['Hip Flexors'], 'bodyweight'),
  S(45, 'Cable Crunch', 'Core', [], 'cable'),
  S(46, 'Ab Wheel Rollout', 'Core', [], 'other'),
];

export async function seedExercisesIfEmpty(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM exercises WHERE deleted_at IS NULL"
  );
  if (row && row.n > 0) return;

  const now = new Date().toISOString();
  // dirty = 0: the library is global cloud data (seeded by migration 010),
  // never pushed as user rows.
  const stmt = await db.prepareAsync(
    `INSERT OR IGNORE INTO exercises
       (id, created_by, name, target_muscle, secondary_muscles, equipment,
        tracking_type, instructions, is_custom, updated_at, dirty)
     VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, 0, ?, 0)`
  );
  try {
    for (const ex of LIBRARY) {
      await stmt.executeAsync(
        ex.id,
        ex.name,
        ex.muscle,
        JSON.stringify(ex.secondary),
        ex.equipment,
        ex.trackingType,
        now
      );
    }
  } finally {
    await stmt.finalizeAsync();
  }
}
