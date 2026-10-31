import { describe, expect, test } from 'bun:test';

import {
    buildInsights,
    muscleCategory,
    tonnageComparison,
    weekStreak,
    type InsightInputs,
} from '../insightRules';

const base: InsightInputs = {
  lifts: [],
  weekSets: [],
  neglected: [],
  split: { Push: 0, Pull: 0, Legs: 0, Core: 0 },
  streak: 0,
  prs: [],
  score: { now: 0, prior: 0 },
  workoutsThisWeek: 1,
};

describe('muscleCategory', () => {
  test('maps seeded muscles into push/pull/legs/core', () => {
    expect(muscleCategory('Chest')).toBe('Push');
    expect(muscleCategory('Triceps')).toBe('Push');
    expect(muscleCategory('Back')).toBe('Pull');
    expect(muscleCategory('Rear Delts')).toBe('Pull');
    expect(muscleCategory('Hamstrings')).toBe('Legs');
    expect(muscleCategory('Core')).toBe('Core');
  });
});

describe('weekStreak', () => {
  // Canonical day keys are LOCAL YYYY-MM-DD (not UTC substr).
  const day = (offset: number) => {
    const d = new Date(Date.now() - offset * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  test('empty → 0', () => {
    expect(weekStreak(new Set())).toBe(0);
  });

  test('a session in each of the last three weeks → 3, even if this week is empty so far', () => {
    // 7, 14, 21 days ago always land in three distinct prior weeks.
    expect(weekStreak(new Set([day(7), day(14), day(21)]))).toBe(3);
  });

  test('a gap week breaks the streak', () => {
    expect(weekStreak(new Set([day(7), day(28)]))).toBe(1);
  });

  test('a session today counts for this week', () => {
    expect(weekStreak(new Set([day(0)]))).toBe(1);
  });
});

describe('tonnageComparison', () => {
  test('picks the largest unit that fits at least once', () => {
    expect(tonnageComparison(50)).toBeNull();
    expect(tonnageComparison(1500)).toBe('≈ 1 car');
    expect(tonnageComparison(12_000)).toBe('≈ 1 school bus');
    expect(tonnageComparison(60_000)).toBe('≈ 5 school buses');
  });
});

describe('buildInsights', () => {
  test('no data → no insights, not a crash', () => {
    expect(buildInsights(base)).toEqual([]);
  });

  test('strength up ≥3% is a win', () => {
    const out = buildInsights({ ...base, score: { now: 530, prior: 500 } });
    expect(out.some((i) => i.id === 'score-up' && i.tone === 'win')).toBe(true);
  });

  test('a lift with 4+ sessions and no gain is flagged as stalled', () => {
    const out = buildInsights({
      ...base,
      lifts: [{ exerciseId: 'x', name: 'Bench', best: 100, recent: 100, prior: 100, sessions: 5 }],
    });
    expect(out.find((i) => i.id === 'stall-x')?.tone).toBe('warn');
  });

  test('a lift with 2 sessions and no gain is NOT flagged - too little data', () => {
    const out = buildInsights({
      ...base,
      lifts: [{ exerciseId: 'x', name: 'Bench', best: 100, recent: 100, prior: 100, sessions: 2 }],
    });
    expect(out.find((i) => i.id === 'stall-x')).toBeUndefined();
  });

  test('push-heavy split warns only with enough upper-body volume', () => {
    expect(buildInsights({ ...base, split: { Push: 6, Pull: 2, Legs: 4, Core: 0 } })).toEqual([]);
    const out = buildInsights({ ...base, split: { Push: 30, Pull: 12, Legs: 20, Core: 0 } });
    expect(out.some((i) => i.id === 'push-heavy')).toBe(true);
  });

  test('warnings sort before wins and output is capped at 6', () => {
    const out = buildInsights({
      ...base,
      score: { now: 600, prior: 500 },
      streak: 6,
      prs: [
        { id: '1', name: 'A', recordType: '1rm', value: 1, achievedAt: '' },
        { id: '2', name: 'B', recordType: '1rm', value: 1, achievedAt: '' },
        { id: '3', name: 'C', recordType: '1rm', value: 1, achievedAt: '' },
      ],
      neglected: [{ muscle: 'Hamstrings', daysAgo: 12 }],
      lifts: [
        { exerciseId: 'a', name: 'A', best: 1, recent: 110, prior: 100, sessions: 4 },
        { exerciseId: 'b', name: 'B', best: 1, recent: 100, prior: 100, sessions: 6 },
        { exerciseId: 'c', name: 'C', best: 1, recent: 120, prior: 100, sessions: 4 },
      ],
    });
    expect(out.length).toBeLessThanOrEqual(6);
    expect(out[0].tone).toBe('warn');
  });
});

import { recoveryScore, type RecoveryInputs } from '../insightRules';

const recBase: RecoveryInputs = {
  daysSinceLastWorkout: null,
  sleepHours: null,
  restingHr: null,
  restingHrBaseline: null,
  weekVolumeKg: 0,
  avgWeekVolumeKg: 0,
  lastFeel: null,
};

describe('recoveryScore', () => {
  test('well-rested lifter scores high', () => {
    const r = recoveryScore({
      ...recBase,
      daysSinceLastWorkout: 2,
      sleepHours: 8,
      restingHr: 55,
      restingHrBaseline: 54,
      weekVolumeKg: 20000,
      avgWeekVolumeKg: 20000,
    });
    expect(r.score).toBe(100);
    expect(r.label).toBe('Primed');
  });

  test('poor sleep + elevated HR + load spike scores low', () => {
    const r = recoveryScore({
      ...recBase,
      daysSinceLastWorkout: 5,
      sleepHours: 5,
      restingHr: 68,
      restingHrBaseline: 55,
      weekVolumeKg: 40000,
      avgWeekVolumeKg: 20000,
      lastFeel: 2,
    });
    expect(r.score).toBeLessThan(50);
    expect(r.label).toBe('Recover');
    expect(r.factors.find((f) => f.label === 'Sleep')?.tone).toBe('warn');
    expect(r.factors.find((f) => f.label === 'Resting HR')?.tone).toBe('warn');
  });

  test('no data still returns a neutral score', () => {
    const r = recoveryScore(recBase);
    expect(r.score).toBeGreaterThan(0);
    expect(r.factors).toHaveLength(4);
  });

  test('long layoff reads as stale', () => {
    const r = recoveryScore({ ...recBase, daysSinceLastWorkout: 9 });
    expect(r.factors.find((f) => f.label === 'Last session')?.detail).toContain('9d');
  });
});
