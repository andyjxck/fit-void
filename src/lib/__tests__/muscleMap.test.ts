import { describe, expect, test } from 'bun:test';

import { MUSCLE_GROUPS, MUSCLE_REGIONS, normalizeMuscle } from '../muscleMap';

describe('normalizeMuscle', () => {
  test('passes canonical groups through unchanged', () => {
    for (const m of MUSCLE_GROUPS) expect(normalizeMuscle(m)).toBe(m);
  });

  test('maps common aliases to canonical groups', () => {
    expect(normalizeMuscle('Core')).toBe('Abs');
    expect(normalizeMuscle('Lats')).toBe('Back');
    expect(normalizeMuscle('Lower Back')).toBe('Back');
    expect(normalizeMuscle('Rear Delts')).toBe('Shoulders');
    expect(normalizeMuscle('Hip Flexors')).toBe('Abs');
    expect(normalizeMuscle('Calf')).toBe('Calves');
    expect(normalizeMuscle('bicep')).toBe('Biceps');
    expect(normalizeMuscle(' triceps ')).toBe('Triceps');
  });

  test('fuzzy-matches substrings case-insensitively', () => {
    expect(normalizeMuscle('pectoralis')).toBe('Chest');
    expect(normalizeMuscle('QUADRICEPS')).toBe('Quads');
    expect(normalizeMuscle('abdominals')).toBe('Abs');
  });

  test('lateral delts are shoulders, not back', () => {
    // "lateral" contains 'lat' - the delt/shoulder rule must win.
    expect(normalizeMuscle('Lateral delts')).toBe('Shoulders');
    expect(normalizeMuscle('Lateral deltoid')).toBe('Shoulders');
    expect(normalizeMuscle('Lats')).toBe('Back');
    expect(normalizeMuscle('latissimus dorsi')).toBe('Back');
  });

  test('ab has a word boundary: abductors are glutes, not abs', () => {
    expect(normalizeMuscle('Abductors')).toBe('Glutes');
    expect(normalizeMuscle('ab')).toBe('Abs');
    expect(normalizeMuscle('ab wheel')).toBe('Abs');
  });

  test('returns the input unchanged when no match', () => {
    expect(normalizeMuscle('Neck')).toBe('Neck');
  });
});

describe('MUSCLE_REGIONS', () => {
  test('every region references a canonical muscle group', () => {
    const canon = new Set<string>(MUSCLE_GROUPS);
    for (const r of MUSCLE_REGIONS) expect(canon.has(r.muscle)).toBe(true);
  });

  test('has both front and back views', () => {
    const views = new Set(MUSCLE_REGIONS.map((r) => r.view));
    expect(views.has('front')).toBe(true);
    expect(views.has('back')).toBe(true);
  });
});
