import { describe, expect, test } from 'bun:test';

import { remotePayload, toLocal, toRemote } from '@/db/syncMap';

describe('remotePayload', () => {
  test('strips dirty and local-only columns', () => {
    const out = remotePayload('routines', {
      id: 'r1',
      user_id: 'u1',
      title: 'Push',
      folder_name: 'My Routines',
      is_template: 1, // local-only
      dirty: 1,
      updated_at: '2026-01-01T00:00:00Z',
      deleted_at: null,
    });
    expect(out.is_template).toBeUndefined();
    expect(out.dirty).toBeUndefined();
    expect(out.title).toBe('Push');
    expect(out.user_id).toBe('u1');
  });

  test('never sends exercises.is_favourite (per-user state lives in the join table)', () => {
    const out = remotePayload('exercises', {
      id: 'e1',
      created_by: 'u1',
      name: 'Custom',
      target_muscle: 'Chest',
      secondary_muscles: '[]',
      equipment: 'dumbbell',
      is_custom: 1,
      is_favourite: 1,
      dirty: 1,
    });
    expect(out.is_favourite).toBeUndefined();
    expect(out.is_custom).toBe(true);
  });

  test('parses JSON text columns into remote arrays/objects', () => {
    const out = remotePayload('food_items', {
      id: 'f1',
      user_id: 'u1',
      barcode: '123',
      name: 'Oats',
      per100g: '{"calories":389}',
      dirty: 1,
    });
    expect(out.per100g).toEqual({ calories: 389 });
  });

  test('workouts: is_completed bool, drops unknown extras', () => {
    const out = remotePayload('workouts', {
      id: 'w1',
      user_id: 'u1',
      title: 'A',
      is_completed: 1,
      archived_at: '2026-01-01T00:00:00Z',
      something_weird: 'x',
      dirty: 1,
    });
    expect(out.is_completed).toBe(true);
    expect(out.something_weird).toBeUndefined();
    expect(out.archived_at).toBe('2026-01-01T00:00:00Z');
  });
});

describe('toLocal', () => {
  test('converts booleans to ints and arrays to JSON strings, marks clean', () => {
    const out = toLocal('meals', {
      id: 'm1',
      is_favourite: true,
      method: ['a', 'b'],
      updated_at: '2026-01-01 00:00:00+00',
    });
    expect(out.is_favourite).toBe(1);
    expect(out.method).toBe('["a","b"]');
    expect(out.dirty).toBe(0);
    expect(out.updated_at).toBe('2026-01-01T00:00:00.000Z');
  });

  test('train_widgets config jsonb → TEXT, visible bool → int', () => {
    const out = toLocal('train_widgets', {
      id: 'w1',
      config: { routineId: 'r1' },
      visible: false,
    });
    expect(out.config).toBe('{"routineId":"r1"}');
    expect(out.visible).toBe(0);
  });
});
