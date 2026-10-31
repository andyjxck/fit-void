/**
 * Body composition & energy maths. Pure functions - all inputs metric
 * (kg / cm / years), conversions happen at the display layer.
 */

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'athlete';
export type Goal = 'cut' | 'maintain' | 'bulk';

export const ACTIVITY: Record<ActivityLevel, { label: string; factor: number; hint: string }> = {
  sedentary: { label: 'Sedentary', factor: 1.2, hint: 'Desk job, little exercise' },
  light: { label: 'Light', factor: 1.375, hint: '1-3 sessions / week' },
  moderate: { label: 'Moderate', factor: 1.55, hint: '3-5 sessions / week' },
  active: { label: 'Active', factor: 1.725, hint: '6-7 hard sessions / week' },
  athlete: { label: 'Athlete', factor: 1.9, hint: 'Twice daily or physical job' },
};

export const GOALS: Record<Goal, { label: string; delta: number; hint: string }> = {
  cut: { label: 'Cut', delta: -500, hint: '≈ 0.5 kg / week loss' },
  maintain: { label: 'Maintain', delta: 0, hint: 'Hold weight, build strength' },
  bulk: { label: 'Bulk', delta: 300, hint: '≈ 0.25 kg / week gain' },
};

export function bmi(weightKg: number, heightCm: number): number | null {
  if (weightKg <= 0 || heightCm <= 0) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

/**
 * Deurenberg BMI-based body-fat estimate (%). Needs only BMI, age and sex -
 * all already on file. It's a population-level estimate, not a measurement;
 * a manual entry (calipers/DEXA/scale) always takes priority over it.
 */
export function estimateBodyFat(bmiValue: number, age: number, sex: Sex): number | null {
  if (bmiValue <= 0 || age <= 0) return null;
  const v = 1.2 * bmiValue + 0.23 * age - 10.8 * (sex === 'male' ? 1 : 0) - 5.4;
  if (!Number.isFinite(v) || v <= 0 || v >= 70) return null;
  return Math.round(v * 10) / 10;
}

export function bmiCategory(v: number): { label: string; tone: 'low' | 'ok' | 'high' } {
  if (v < 18.5) return { label: 'Underweight', tone: 'low' };
  if (v < 25) return { label: 'Healthy range', tone: 'ok' };
  if (v < 30) return { label: 'Overweight', tone: 'high' };
  return { label: 'Obese', tone: 'high' };
}

/** Mifflin-St Jeor resting energy expenditure (kcal / day). */
export function bmr(weightKg: number, heightCm: number, age: number, sex: Sex): number | null {
  if (weightKg <= 0 || heightCm <= 0 || age <= 0) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(sex === 'male' ? base + 5 : base - 161);
}

export function tdee(bmrKcal: number, level: ActivityLevel): number {
  return Math.round(bmrKcal * ACTIVITY[level].factor);
}

export function calorieTarget(tdeeKcal: number, goal: Goal): number {
  // Never recommend below a sane floor.
  return Math.max(1200, tdeeKcal + GOALS[goal].delta);
}

/** Protein target for lifters - 1.6-2.2 g/kg; we use 1.8 on maintain, higher on a cut. */
export function proteinTarget(weightKg: number, goal: Goal): number {
  const perKg = goal === 'cut' ? 2.2 : goal === 'bulk' ? 1.8 : 1.8;
  return Math.round(weightKg * perKg);
}

/** Split remaining calories after protein: fat ~25% of total, rest carbs. */
export function macroTargets(kcal: number, proteinG: number): { protein: number; carbs: number; fat: number } {
  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((kcal - proteinG * 4 - fat * 9) / 4));
  return { protein: proteinG, carbs, fat };
}

export function ageFromBirthYear(year: number | null | undefined): number | null {
  if (!year) return null;
  const a = new Date().getFullYear() - year;
  return a > 0 && a < 120 ? a : null;
}

export const cmToFtIn = (cm: number): string => {
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn - ft * 12);
  return inch === 12 ? `${ft + 1}'0"` : `${ft}'${inch}"`;
};

/** Weekly average bodyweight for the last `weeks` weeks (oldest first).
 * Entries are { value, logged_at }; weeks with no weigh-ins are null. */
export function weeklyWeightAverages(
  entries: { value: number; logged_at: string }[],
  weeks = 12
): (number | null)[] {
  const monday = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x.getTime();
  };
  const thisWeek = monday(new Date());
  const out: (number | null)[] = Array.from({ length: weeks }, () => null);
  const sums: number[] = Array.from({ length: weeks }, () => 0);
  const counts: number[] = Array.from({ length: weeks }, () => 0);
  for (const e of entries) {
    const wk = Math.floor((thisWeek - monday(new Date(e.logged_at))) / (7 * 86400000));
    const idx = weeks - 1 - wk;
    if (idx >= 0 && idx < weeks) {
      sums[idx] += e.value;
      counts[idx]++;
    }
  }
  for (let i = 0; i < weeks; i++) out[i] = counts[i] ? sums[i] / counts[i] : null;
  return out;
}
