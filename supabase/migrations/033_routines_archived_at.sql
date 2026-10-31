-- Routine archive: mirrors workouts.archived_at - deleting a routine parks
-- it in the Archive for 28 days before the purge writes a real tombstone.
alter table public.routines
  add column if not exists archived_at timestamptz;
