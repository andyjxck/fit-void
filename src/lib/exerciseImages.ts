/**
 * Maps our seeded exercise IDs (from src/db/seed.ts) to image IDs from
 * the free-exercise-db (https://github.com/yuhonas/free-exercise-db).
 *
 * Image URLs follow the pattern:
 *   https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/{id}/0.jpg
 *
 * The `0.jpg` is the start position, `1.jpg` is the end position.
 */

const IMG_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

// Our exercise IDs are e0000000-0000-4000-8000-{12-digit zero-padded n}
// The number corresponds to the order in seed.ts
const EX = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Maps our exercise ID → free-exercise-db image ID. */
const IMAGE_MAP: Record<string, string> = {
  // Chest
  [EX(1)]: 'Barbell_Bench_Press_-_Medium_Grip',
  [EX(2)]: 'Barbell_Incline_Bench_Press_-_Medium_Grip',
  [EX(3)]: 'Dumbbell_Bench_Press',
  [EX(4)]: 'Incline_Dumbbell_Press',
  [EX(5)]: 'Cable_Crossover',
  [EX(6)]: 'Dips_-_Chest_Version',
  [EX(7)]: 'Pushups',
  [EX(8)]: 'Machine_Bench_Press',
  // Back
  [EX(9)]: 'Barbell_Deadlift',
  [EX(10)]: 'Sumo_Deadlift',
  [EX(11)]: 'Bent_Over_Barbell_Row',
  [EX(12)]: 'Pullups',
  [EX(13)]: 'Chin-Up',
  [EX(14)]: 'Wide-Grip_Lat_Pulldown',
  [EX(15)]: 'Seated_Cable_Rows',
  [EX(16)]: 'One-Arm_Dumbbell_Row',
  [EX(17)]: 'T-Bar_Row_with_Handle',
  [EX(18)]: 'Face_Pull',
  // Shoulders
  [EX(19)]: 'Standing_Military_Press',
  [EX(20)]: 'Dumbbell_Shoulder_Press',
  [EX(21)]: 'Side_Lateral_Raise',
  [EX(22)]: 'Bent_Over_Dumbbell_Rear_Delt_Raise_With_Head_On_Bench',
  [EX(23)]: 'Barbell_Shrug',
  [EX(24)]: 'Machine_Shoulder_Military_Press',
  // Legs
  [EX(25)]: 'Barbell_Squat',
  [EX(26)]: 'Front_Barbell_Squat',
  [EX(27)]: 'Romanian_Deadlift',
  [EX(28)]: 'Leg_Press',
  [EX(29)]: 'Barbell_Walking_Lunge',
  [EX(30)]: 'Leg_Extensions',
  [EX(31)]: 'Lying_Leg_Curls',
  [EX(32)]: 'Barbell_Hip_Thrust',
  [EX(33)]: 'Standing_Calf_Raises',
  [EX(34)]: 'Split_Squat_with_Dumbbells',
  // Arms
  [EX(35)]: 'Barbell_Curl',
  [EX(36)]: 'Dumbbell_Bicep_Curl',
  [EX(37)]: 'Alternate_Hammer_Curl',
  [EX(38)]: 'Preacher_Curl',
  [EX(39)]: 'Triceps_Pushdown',
  [EX(40)]: 'Cable_Rope_Overhead_Triceps_Extension',
  [EX(41)]: 'Close-Grip_Barbell_Bench_Press',
  [EX(42)]: 'EZ-Bar_Skullcrusher',
  // Core
  [EX(43)]: 'Plank',
  [EX(44)]: 'Hanging_Leg_Raise',
  [EX(45)]: 'Cable_Crunch',
  [EX(46)]: 'Ab_Roller',
};

/** Returns the image URL for an exercise, or null if no image is available. */
export function getExerciseImageUrl(exerciseId: string, position: 0 | 1 = 0, githubImageId?: string | null): string | null {
  // Custom exercises use their stored github_image_id
  if (githubImageId) {
    return `${IMG_BASE}/${githubImageId}/${position}.jpg`;
  }
  const imgId = IMAGE_MAP[exerciseId];
  if (!imgId) return null;
  return `${IMG_BASE}/${imgId}/${position}.jpg`;
}

/** Returns both start (0) and end (1) image URLs for an exercise. */
export function getExerciseImages(exerciseId: string, githubImageId?: string | null): { start: string | null; end: string | null } {
  const imgId = githubImageId || IMAGE_MAP[exerciseId];
  if (!imgId) return { start: null, end: null };
  return {
    start: `${IMG_BASE}/${imgId}/0.jpg`,
    end: `${IMG_BASE}/${imgId}/1.jpg`,
  };
}
