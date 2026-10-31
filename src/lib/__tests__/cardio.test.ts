import { describe, expect, test } from 'bun:test';

import {
    distancePBs,
    formatCardioDuration,
    formatDistance,
    formatPace,
    hcExerciseToCardio,
    hkActivityToCardio,
    hrZone,
    hrZoneMinutes,
    paceMinPerKm,
} from '../cardio';

describe('pace', () => {
  test('5k in 25:00 → 5:00/km', () => {
    const p = paceMinPerKm(5000, 1500);
    expect(p).toBe(5);
    expect(formatPace(p)).toBe('05:00');
  });

  test('no distance → null pace', () => {
    expect(paceMinPerKm(null, 1500)).toBeNull();
    expect(paceMinPerKm(0, 1500)).toBeNull();
  });

  test('pace seconds roll over at 60 - never "05:60"', () => {
    expect(formatPace(5.5)).toBe('05:30');
    expect(formatPace(5.999)).toBe('06:00');
    expect(formatPace(null)).toBe('-');
  });
});

describe('format', () => {
  test('distance', () => {
    expect(formatDistance(500)).toBe('500 m');
    expect(formatDistance(5021)).toBe('5.02 km');
    expect(formatDistance(null)).toBe('-');
  });
  test('duration', () => {
    expect(formatCardioDuration(1500)).toBe('25:00');
    expect(formatCardioDuration(3920)).toBe('1:05:20');
  });
  test('duration seconds roll over at 60 - never "1:60"', () => {
    expect(formatCardioDuration(3599.6)).toBe('1:00:00');
    expect(formatCardioDuration(89.9)).toBe('1:30');
    expect(formatCardioDuration(59.6)).toBe('1:00');
  });
});

describe('activity mapping', () => {
  test('HealthKit names', () => {
    expect(hkActivityToCardio('Running')).toBe('run');
    expect(hkActivityToCardio('Cycling')).toBe('cycle');
    expect(hkActivityToCardio('PoolSwimming')).toBe('swim');
    expect(hkActivityToCardio('ChessBoxing')).toBe('other');
  });
  test('Health Connect ints', () => {
    expect(hcExerciseToCardio(56)).toBe('run');
    expect(hcExerciseToCardio(8)).toBe('cycle');
    expect(hcExerciseToCardio(74)).toBe('swim');
    expect(hcExerciseToCardio(79)).toBe('walk');
    expect(hcExerciseToCardio(80)).toBe('other'); // 80 is WATER_POLO, not walking
    expect(hcExerciseToCardio(999)).toBe('other');
  });
});

describe('HR zones', () => {
  test('zone boundaries at maxHr 190', () => {
    expect(hrZone(100, 190)).toBe(0); // <60%
    expect(hrZone(125, 190)).toBe(1); // 65%
    expect(hrZone(145, 190)).toBe(2); // 76%
    expect(hrZone(165, 190)).toBe(3); // 87%
    expect(hrZone(180, 190)).toBe(4); // 95%
  });

  test('minutes split proportional to sample share', () => {
    // 100 easy + 100 hard samples over a 10-minute session → 5 + 5
    const zones = hrZoneMinutes([...Array(100).fill(90), ...Array(100).fill(185)], 600, 190)!;
    expect(Math.round(zones[0])).toBe(5);
    expect(Math.round(zones[4])).toBe(5);
    expect(zones[2]).toBe(0);
  });

  test('too few samples → null', () => {
    expect(hrZoneMinutes([100, 110], 600)).toBeNull();
    expect(hrZoneMinutes([], 600)).toBeNull();
  });
});

describe('distancePBs', () => {
  test('finds fastest within the distance window only', () => {
    const sessions = [
      { activity: 'run', distance_m: 5100, duration_seconds: 1500, started_at: '2024-01-01T00:00:00Z' },
      { activity: 'run', distance_m: 5000, duration_seconds: 1400, started_at: '2024-02-01T00:00:00Z' },
      { activity: 'run', distance_m: 42195, duration_seconds: 14400, started_at: '2024-03-01T00:00:00Z' },
    ];
    const pbs = distancePBs(sessions);
    const fiveK = pbs.find((p) => p.distanceM === 5000);
    expect(fiveK?.seconds).toBe(1400); // fastest 5k, not the marathon
    expect(pbs.find((p) => p.distanceM === 42195)?.seconds).toBe(14400);
    expect(pbs.find((p) => p.distanceM === 10000)).toBeUndefined();
  });

  test('sessions outside ±window do not qualify', () => {
    const sessions = [
      { activity: 'run', distance_m: 2000, duration_seconds: 500, started_at: '2024-01-01T00:00:00Z' },
    ];
    expect(distancePBs(sessions).find((p) => p.distanceM === 5000)).toBeUndefined();
    expect(distancePBs(sessions).find((p) => p.distanceM === 1000)).toBeUndefined(); // 2000 > 1.3×1000
  });

  test('swim distances are per-activity', () => {
    const sessions = [
      { activity: 'swim', distance_m: 1000, duration_seconds: 1200, started_at: '2024-01-01T00:00:00Z' },
    ];
    const pbs = distancePBs(sessions);
    expect(pbs.find((p) => p.distanceM === 1000)?.seconds).toBe(1200);
    expect(pbs.find((p) => p.distanceM === 5000)).toBeUndefined(); // swim has no 5K bucket
  });
});
