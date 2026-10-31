-- Exercise tracking types: not every exercise is weight+reps. Adds a
-- tracking_type to exercises ('strength' | 'cardio' | 'hold' | 'carry') and
-- duration/distance/HR columns to workout_sets so cardio (rowing, running),
-- timed holds (planks, stretches) and loaded carries (farmer's walk, sled
-- push) can be logged as real sets instead of being forced into weight+reps.

alter table public.exercises
  add column if not exists tracking_type text not null default 'strength'
    check (tracking_type in ('strength', 'cardio', 'hold', 'carry'));

alter table public.workout_sets
  add column if not exists duration_seconds integer, -- hold time, or cardio/carry duration
  add column if not exists distance_m       numeric,  -- cardio or carry distance, metres
  add column if not exists avg_hr           integer;  -- optional HR for cardio/hold sets

-- Widen the record_type check to cover the new tracking types' PRs
-- (longest hold, farthest carry/cardio distance).
alter table public.personal_records
  drop constraint personal_records_record_type_check;
alter table public.personal_records
  add constraint personal_records_record_type_check
    check (record_type in ('1rm', 'max_weight', 'max_volume', 'max_hold_seconds', 'max_distance'));
