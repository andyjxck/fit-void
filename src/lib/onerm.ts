/**
 * Brzycki estimated 1RM:  weight * 36 / (37 - reps)
 * Valid for 1 <= reps <= 36. reps >= 37 degenerates - return the raw weight.
 */
export function brzycki(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  if (reps >= 37) return weightKg;
  return (weightKg * 36) / (37 - reps);
}
