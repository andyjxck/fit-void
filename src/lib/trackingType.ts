/**
 * Classifies a GitHub free-exercise-db entry (or any exercise with the same
 * shape) into how its sets should be logged. Not every exercise is
 * weight+reps: cardio machines need distance/duration/HR, timed holds
 * (planks, stretches) need a duration with no weight or reps at all, and a
 * handful of strongman events (carries, drags, sled pushes) are weight +
 * distance-or-duration rather than weight + reps.
 */

import type { TrackingType } from './types';

// Strongman events that are carried/dragged/pushed a distance rather than
// lifted for reps. Matched by name since free-exercise-db's "strongman"
// category also includes rep-based static lifts (Atlas Stones, Log Lift,
// Axle Deadlift, Circus Bell, Conan's Wheel) that stay ordinary strength.
const CARRY_NAME = /walk|carry|drag|sled|yoke|rickshaw/i;

export function classifyTrackingType(
  category: string | null | undefined,
  force: string | null | undefined,
  name: string
): TrackingType {
  const cat = (category ?? '').toLowerCase();
  if (cat === 'cardio') return 'cardio';
  if (cat === 'strongman' && CARRY_NAME.test(name)) return 'carry';
  if (cat === 'stretching' || force === 'static') return 'hold';
  return 'strength';
}

// Timed holds: planks, stretches, hangs - duration only.
const HOLD_NAME = /plank|\bhold\b|stretch|\bhang|wall sit|l[- ]?sit|hollow/i;
// Cardio machines & modalities. Word-boundary'd so 'Barbell Row' and
// 'Battle Ropes' stay strength ('rowing' not 'row'; 'jump rope' not 'rope').
const CARDIO_NAME =
  /rowing|\brower|\berg\b|ski erg|treadmill|elliptical|stair ?(climb|master|step)|stationary|bike|bicycle|cycl(e|ing)|spin|swim|assault|airdyne|\brun(ning)?\b|\bjog|jump ?rope|\bburpee|versa ?climb/i;

/**
 * Name-only classification for custom exercises and rows that predate
 * tracking_type. Conservative: anything ambiguous stays 'strength'.
 * Order matters - a 'Treadmill Walk' is cardio, a 'Farmer's Walk' is carry.
 */
export function classifyNameTracking(name: string): TrackingType {
  if (HOLD_NAME.test(name)) return 'hold';
  if (CARDIO_NAME.test(name)) return 'cardio';
  if (CARRY_NAME.test(name)) return 'carry';
  return 'strength';
}
