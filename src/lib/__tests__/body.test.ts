import { describe, expect, test } from 'bun:test';

import { bmi, bmiCategory, bmr, calorieTarget, cmToFtIn, macroTargets, proteinTarget, tdee } from '../body';

describe('bmi', () => {
  test('80kg @ 180cm → 24.7, healthy', () => {
    const v = bmi(80, 180);
    expect(v).toBe(24.7);
    expect(bmiCategory(v!).label).toBe('Healthy range');
  });

  test('invalid inputs → null', () => {
    expect(bmi(0, 180)).toBeNull();
    expect(bmi(80, 0)).toBeNull();
  });

  test('category boundaries', () => {
    expect(bmiCategory(18.4).tone).toBe('low');
    expect(bmiCategory(18.5).tone).toBe('ok');
    expect(bmiCategory(25).tone).toBe('high');
    expect(bmiCategory(30).label).toBe('Obese');
  });
});

describe('energy', () => {
  test('Mifflin-St Jeor: 80kg 180cm 30y male → 1780', () => {
    expect(bmr(80, 180, 30, 'male')).toBe(1780);
  });

  test('female offset is −161', () => {
    expect(bmr(80, 180, 30, 'female')).toBe(1614);
  });

  test('tdee multiplies by activity factor', () => {
    expect(tdee(1780, 'moderate')).toBe(2759);
  });

  test('calorie target applies goal delta with a 1200 floor', () => {
    expect(calorieTarget(2759, 'cut')).toBe(2259);
    expect(calorieTarget(2759, 'bulk')).toBe(3059);
    expect(calorieTarget(1400, 'cut')).toBe(1200);
  });

  test('protein target scales by bodyweight and goal', () => {
    expect(proteinTarget(80, 'maintain')).toBe(144);
    expect(proteinTarget(80, 'cut')).toBe(176);
  });

  test('macros: fat ≈25% of kcal, carbs fill the rest, never negative', () => {
    const m = macroTargets(2500, 150);
    expect(m.fat).toBe(69);
    expect(m.carbs).toBe(320);
    expect(macroTargets(1200, 250).carbs).toBe(0);
  });
});

describe('cmToFtIn', () => {
  test('180cm → 5\'11"', () => {
    expect(cmToFtIn(180)).toBe('5\'11"');
  });
  test('rounds 12in up to next foot', () => {
    expect(cmToFtIn(182.88)).toBe('6\'0"');
  });
});

import { weeklyWeightAverages } from '../body';

describe('weeklyWeightAverages', () => {
  test('averages entries within the same week', () => {
    const now = new Date();
    const today = now.toISOString();
    const r = weeklyWeightAverages(
      [
        { value: 80, logged_at: today },
        { value: 82, logged_at: today },
      ],
      4
    );
    expect(r[3]).toBe(81);
    expect(r[0]).toBeNull();
  });

  test('older weeks land in the right slot', () => {
    const nineDaysAgo = new Date(Date.now() - 9 * 86400000).toISOString();
    const r = weeklyWeightAverages([{ value: 90, logged_at: nineDaysAgo }], 4);
    expect(r.filter((v) => v === 90)).toHaveLength(1);
  });

  test('empty input → all null', () => {
    expect(weeklyWeightAverages([], 12).every((v) => v === null)).toBe(true);
  });
});
