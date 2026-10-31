-- Cardio sessions - runs, rides, swims etc. Mirrors local SQLite table;
-- distance canonical in metres, zone_minutes stored as opaque JSON text.

create table if not exists public.cardio_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  external_id      text,
  activity         text not null check (activity in (
                     'run','cycle','swim','row','walk','hike','elliptical','stairs','other')),
  distance_m       numeric,
  duration_seconds integer not null,
  avg_hr           integer,
  max_hr           integer,
  zone_minutes     text,
  calories         integer,
  source           text not null default 'manual',
  started_at       timestamptz not null default now(),
  notes            text,
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create unique index if not exists cardio_sessions_external_idx
  on public.cardio_sessions (user_id, external_id)
  where external_id is not null;
create index if not exists cardio_sessions_user_started_idx on public.cardio_sessions (user_id, started_at desc);
create index if not exists cardio_sessions_updated_idx      on public.cardio_sessions (updated_at);

drop trigger if exists cardio_sessions_set_updated_at on public.cardio_sessions;
create trigger cardio_sessions_set_updated_at
  before update on public.cardio_sessions
  for each row execute function public.set_updated_at();

alter table public.cardio_sessions enable row level security;

drop policy if exists "cardio_sessions_all_own" on public.cardio_sessions;
create policy "cardio_sessions_all_own" on public.cardio_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
