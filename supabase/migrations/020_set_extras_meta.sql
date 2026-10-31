-- Optional per-set cardio extras (incline %, resistance level, stroke rate,
-- watts, cadence, elevation, laps, steps). One JSON text bag per row so new
-- fields never need another schema change.

alter table public.workout_sets
  add column if not exists meta text;

alter table public.cardio_sessions
  add column if not exists meta text;
