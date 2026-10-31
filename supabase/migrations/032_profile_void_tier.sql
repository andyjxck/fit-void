-- Tier on profiles: collab Pro checks and the MAX badge read it for any
-- member, so has_void_pro alone isn't enough (pro vs promax).
alter table public.profiles
  add column if not exists void_tier text not null default 'free'
  check (void_tier in ('free', 'pro', 'promax'));

-- Backfill: anyone already flagged pro keeps it; nobody is promax yet.
update public.profiles set void_tier = 'pro' where has_void_pro and void_tier = 'free';
