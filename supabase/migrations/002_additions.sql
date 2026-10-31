-- Migration 002 — additions since 001_init.sql
-- Run this against a project that already has 001 applied.
-- All statements are idempotent (safe to re-run).

-- routine_folders -------------------------------------------------------------
create table if not exists public.routine_folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, name)
);

create index if not exists routine_folders_user_idx on public.routine_folders (user_id, sort_order);

drop trigger if exists routine_folders_set_updated_at on public.routine_folders;
create trigger routine_folders_set_updated_at
  before update on public.routine_folders
  for each row execute function public.set_updated_at();

alter table public.routine_folders enable row level security;
drop policy if exists routine_folders_all_own on public.routine_folders;
create policy routine_folders_all_own on public.routine_folders
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- target_reps on routine_exercises --------------------------------------------
alter table public.routine_exercises
  add column if not exists target_reps integer[] not null default '{}';

-- day_status -------------------------------------------------------------------
create table if not exists public.day_status (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  date       text not null,
  status     text not null check (status in ('rest','missed')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, date)
);

create index if not exists day_status_date_idx on public.day_status (date);
create index if not exists day_status_updated_idx on public.day_status (updated_at);

drop trigger if exists day_status_set_updated_at on public.day_status;
create trigger day_status_set_updated_at
  before update on public.day_status
  for each row execute function public.set_updated_at();

alter table public.day_status enable row level security;
drop policy if exists day_status_all_own on public.day_status;
create policy day_status_all_own on public.day_status
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
