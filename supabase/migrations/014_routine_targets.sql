-- routine_exercises: per-set weight + set-type targets -----------------------
-- Routine editor now pre-fills every field the live set row shows:
-- type badge (N/W/D/F), weight, reps.

alter table public.routine_exercises
  add column if not exists target_weights numeric[] not null default '{}', -- per-set kg targets, nulls = unset
  add column if not exists target_types   text[]    not null default '{}'; -- 'normal'|'warmup'|'drop'|'failure'
