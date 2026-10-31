import { describe, expect, test } from 'bun:test';

import { clockDigitsToSeconds, formatDuration, secondsToClockDigits } from '../format';
import { brzycki } from '../onerm';
import { plateBreakdown, roundToLoadable } from '../plates';
import { generateWarmups } from '../warmup';

describe('plateBreakdown', () => {
  test('100kg total on a 20kg bar → [25, 15] per side', () => {
    const r = plateBreakdown(100, 20, 'kg');
    expect(r.plates).toEqual([25, 15]);
    expect(r.approximate).toBe(false);
  });

  test('62.5kg on a 20kg bar → [20, 1.25] per side', () => {
    const r = plateBreakdown(62.5, 20, 'kg');
    expect(r.plates).toEqual([20, 1.25]);
    expect(r.approximate).toBe(false);
  });

  test('bar alone → empty', () => {
    expect(plateBreakdown(20, 20, 'kg').plates).toEqual([]);
  });

  test('under bar weight → approximate, empty', () => {
    const r = plateBreakdown(15, 20, 'kg');
    expect(r.plates).toEqual([]);
    expect(r.approximate).toBe(true);
  });

  test('lbs: 225 on a 45 bar → [45, 45] per side', () => {
    expect(plateBreakdown(225, 45, 'lbs').plates).toEqual([45, 45]);
  });

  test('unreachable load is flagged approximate', () => {
    const r = plateBreakdown(101, 20, 'kg'); // 40.5/side → 40 plateable, 0.5 remainder
    expect(r.approximate).toBe(true);
    expect(r.remainder).toBeCloseTo(0.5);
  });
});

describe('roundToLoadable', () => {
  test('rounds 81.3 → 82.5 on a 20kg bar', () => {
    expect(roundToLoadable(81.3, 20, 'kg')).toBe(82.5);
  });
  test('never returns below the bar', () => {
    expect(roundToLoadable(10, 20, 'kg')).toBe(20);
  });
});

describe('formatDuration', () => {
  test('truncates fractional seconds - "1:30", never "1:30.7"', () => {
    expect(formatDuration(90.7)).toBe('1:30');
    expect(formatDuration(3920.4)).toBe('1:05:20');
    expect(formatDuration(59.9)).toBe('0:59');
  });
});

describe('brzycki', () => {
  test('100kg × 1 = 100', () => {
    expect(brzycki(100, 1)).toBeCloseTo(100);
  });
  test('100kg × 10 ≈ 133.3', () => {
    expect(brzycki(100, 10)).toBeCloseTo(133.33, 1);
  });
  test('reps >= 37 returns raw weight', () => {
    expect(brzycki(50, 40)).toBe(50);
  });
  test('zero/negative inputs → 0', () => {
    expect(brzycki(0, 5)).toBe(0);
    expect(brzycki(100, 0)).toBe(0);
  });
});

describe('generateWarmups', () => {
  test('4 ramp sets for a 100kg working weight on a 20kg bar', () => {
    const w = generateWarmups(100, 20, 'kg');
    expect(w).toHaveLength(4);
    expect(w[0]).toMatchObject({ weightKg: 20, reps: 10, percent: 0 });
    expect(w[1]).toMatchObject({ weightKg: 50, reps: 5, percent: 0.5 });
    expect(w[2]).toMatchObject({ weightKg: 70, reps: 3, percent: 0.7 });
    expect(w[3]).toMatchObject({ weightKg: 85, reps: 1, percent: 0.85 });
  });

  test('plate-rounds odd percentages (90kg → 45, 62.5→62.5, 77.5)', () => {
    const w = generateWarmups(90, 20, 'kg');
    expect(w[1].weightKg).toBe(45);
    expect(w[2].weightKg).toBe(62.5);
    expect(w[3].weightKg).toBe(77.5);
  });

  test('never below bar weight', () => {
    const w = generateWarmups(30, 20, 'kg');
    expect(w[0].weightKg).toBe(20);
  });
});

describe('clock digits (numpad mm:ss entry)', () => {
  test('"215" is 2:15, not 215 seconds', () => {
    expect(clockDigitsToSeconds('215')).toBe(135);
  });

  test('short digits are bare seconds', () => {
    expect(clockDigitsToSeconds('5')).toBe(5);
    expect(clockDigitsToSeconds('45')).toBe(45);
  });

  test('long digits are minutes:seconds', () => {
    expect(clockDigitsToSeconds('12345')).toBe(123 * 60 + 45);
  });

  test('overflow seconds normalize', () => {
    expect(clockDigitsToSeconds('290')).toBe(210); // displays 3:30
  });

  test('empty → null', () => {
    expect(clockDigitsToSeconds('')).toBeNull();
  });

  test('secondsToClockDigits round-trips', () => {
    expect(secondsToClockDigits(135)).toBe('215');
    expect(secondsToClockDigits(5)).toBe('005');
    expect(secondsToClockDigits(3600)).toBe('6000');
    expect(clockDigitsToSeconds(secondsToClockDigits(135))).toBe(135);
    expect(clockDigitsToSeconds(secondsToClockDigits(3600))).toBe(3600);
  });
});
