-- public_stats: weekly step count from the connected health platform,
-- so friends can compare activity alongside lifting stats.
alter table public.public_stats
  add column if not exists week_steps integer not null default 0;
