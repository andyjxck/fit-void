import { describe, expect, test } from 'bun:test';

import { classifyNameTracking, classifyTrackingType } from '../trackingType';

describe('classifyTrackingType', () => {
  test('cardio category → cardio', () => {
    expect(classifyTrackingType('cardio', null, 'Rowing, Stationary')).toBe('cardio');
    expect(classifyTrackingType('cardio', 'push', 'Elliptical Trainer')).toBe('cardio');
  });

  test('stretching category or static force → hold', () => {
    expect(classifyTrackingType('stretching', null, 'Hamstring Stretch')).toBe('hold');
    expect(classifyTrackingType('strength', 'static', 'Plank')).toBe('hold');
  });

  test('strongman carries/drags/pushes → carry', () => {
    expect(classifyTrackingType('strongman', 'push', "Farmer's Walk")).toBe('carry');
    expect(classifyTrackingType('strongman', 'push', 'Yoke Walk')).toBe('carry');
    expect(classifyTrackingType('strongman', 'push', 'Sled Push')).toBe('carry');
    expect(classifyTrackingType('strongman', 'push', 'Rickshaw Carry')).toBe('carry');
  });

  test('strongman static lifts stay strength', () => {
    expect(classifyTrackingType('strongman', 'pull', 'Atlas Stones')).toBe('strength');
    expect(classifyTrackingType('strongman', 'pull', 'Log Lift')).toBe('strength');
    expect(classifyTrackingType('strongman', 'pull', 'Axle Deadlift')).toBe('strength');
  });

  test('everything else defaults to strength', () => {
    expect(classifyTrackingType('strength', 'push', 'Barbell Bench Press')).toBe('strength');
    expect(classifyTrackingType('powerlifting', 'pull', 'Sumo Deadlift')).toBe('strength');
    expect(classifyTrackingType('olympic weightlifting', 'pull', 'Clean and Jerk')).toBe('strength');
    expect(classifyTrackingType('plyometrics', 'push', 'Box Jump')).toBe('strength');
    expect(classifyTrackingType(null, null, 'Custom Move')).toBe('strength');
  });
});

describe('classifyNameTracking', () => {
  test('cardio machines and modalities → cardio', () => {
    expect(classifyNameTracking('Rowing, Stationary')).toBe('cardio');
    expect(classifyNameTracking('Rowing')).toBe('cardio');
    expect(classifyNameTracking('Ski Erg')).toBe('cardio');
    expect(classifyNameTracking('Assault Bike')).toBe('cardio');
    expect(classifyNameTracking('Running')).toBe('cardio');
    expect(classifyNameTracking('Elliptical Trainer')).toBe('cardio');
    expect(classifyNameTracking('Stairmaster')).toBe('cardio');
    expect(classifyNameTracking('Swimming')).toBe('cardio');
    expect(classifyNameTracking('Jump Rope')).toBe('cardio');
  });

  test('timed holds → hold', () => {
    expect(classifyNameTracking('Plank')).toBe('hold');
    expect(classifyNameTracking('Dead Hang')).toBe('hold');
    expect(classifyNameTracking('Wall Sit')).toBe('hold');
    expect(classifyNameTracking('Hamstring Stretch')).toBe('hold');
  });

  test('loaded carries → carry', () => {
    expect(classifyNameTracking("Farmer's Walk")).toBe('carry');
    expect(classifyNameTracking('Yoke Carry')).toBe('carry');
    expect(classifyNameTracking('Sled Push')).toBe('carry');
  });

  test('strength names are not misclassified', () => {
    expect(classifyNameTracking('Barbell Bench Press')).toBe('strength');
    expect(classifyNameTracking('Barbell Row')).toBe('strength');
    expect(classifyNameTracking('Seated Cable Row')).toBe('strength');
    expect(classifyNameTracking('Battle Ropes')).toBe('strength');
    expect(classifyNameTracking('Landmine Squat')).toBe('strength');
    expect(classifyNameTracking('Jefferson Curl')).toBe('strength');
  });
});
