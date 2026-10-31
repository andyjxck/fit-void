-- 029_collab_sessions — tabbed collaborative routines + live shared sessions.
--
-- Tabs: a routine can hold sub-routines via routines.parent_routine_id. A tab
-- is just a routines row whose exercises live in routine_exercises as usual,
-- so sync + collab RLS reuse the existing helpers once they follow the
-- parent chain.
--
-- Sessions: when a shared routine's workout opens, present members join a
-- routine_sessions row (lobby), each picks a tab (routine_session_members),
-- and everyone present must set ready before status flips to 'active'. Live
-- sets go to routine_session_sets (one row per user/exercise/set, upserted)
-- so collaborators see each other's progress in realtime; each user still
-- finalizes their own local workouts/workout_sets rows at the end.

alter table public.routines
  add column if not exists parent_routine_id uuid references public.routines(id) on delete cascade;

create index if not exists routines_parent_idx
  on public.routines (parent_routine_id) where parent_routine_id is not null;

-- Membership helpers follow the parent chain: collaborator/member of the
-- parent counts for every tab routine.
create or replace function public.is_routine_collaborator(p_routine uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.routines r
    join public.routine_collaborators rc
      on rc.routine_id = coalesce(r.parent_routine_id, r.id)
    where r.id = p_routine
      and rc.user_id = auth.uid()
      and rc.status = 'accepted');
$$;

create or replace function public.is_routine_member(p_routine uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.routines r
    join public.routine_collaborators rc
      on rc.routine_id = coalesce(r.parent_routine_id, r.id)
    where r.id = p_routine
      and rc.user_id = auth.uid());
$$;

-- routine_collaborators invites still target the parent only; a tab row is
-- insertable under the owner's user_id by an accepted collaborator because
-- routines_shared_collab's WITH CHECK resolves membership via the parent.

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

create table if not exists public.routine_sessions (
  id          uuid primary key default gen_random_uuid(),
  routine_id  uuid not null references public.routines(id) on delete cascade,
  created_by  uuid not null references auth.users(id),
  status      text not null default 'lobby' check (status in ('lobby','active','ended')),
  started_at  timestamptz,
  ended_at    timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists routine_sessions_routine_idx
  on public.routine_sessions (routine_id, status);

create table if not exists public.routine_session_members (
  session_id     uuid not null references public.routine_sessions(id) on delete cascade,
  user_id        uuid not null references auth.users(id),
  tab_routine_id uuid references public.routines(id) on delete set null,
  ready          boolean not null default false,
  joined_at      timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table if not exists public.routine_session_sets (
  session_id        uuid not null references public.routine_sessions(id) on delete cascade,
  user_id           uuid not null references auth.users(id),
  exercise_id       uuid not null,
  set_order         integer not null,
  set_type          text,
  weight_kg         real,
  reps              integer,
  rpe               real,
  duration_seconds  integer,
  distance_m        real,
  done              boolean not null default false,
  updated_at        timestamptz not null default now(),
  primary key (session_id, user_id, exercise_id, set_order)
);

alter table public.routine_sessions enable row level security;
alter table public.routine_session_members enable row level security;
alter table public.routine_session_sets enable row level security;

-- Security-definer helpers break recursion between the session tables.
create or replace function public.is_session_member(p_session uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.routine_session_members
    where session_id = p_session and user_id = auth.uid());
$$;

create or replace function public.can_join_session(p_session uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.routine_sessions s
    join public.routines r on r.id = s.routine_id
    where s.id = p_session
      and s.status in ('lobby','active')
      and (r.user_id = auth.uid() or public.is_routine_collaborator(
            coalesce(r.parent_routine_id, r.id))));
$$;

create or replace function public.can_read_session(p_session uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_session_member(p_session)
      or exists (
        select 1 from public.routine_sessions s
        join public.routines r on r.id = s.routine_id
        where s.id = p_session
          and (r.user_id = auth.uid() or public.is_routine_collaborator(
                coalesce(r.parent_routine_id, r.id))));
$$;

-- Sessions: routine members (owner or accepted collaborator, via parent)
-- can see/create; any member can update status (lobby -> active -> ended).
create policy routine_sessions_select on public.routine_sessions
  for select using (public.can_read_session(id));

create policy routine_sessions_insert on public.routine_sessions
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.routines r
      where r.id = routine_id
        and (r.user_id = auth.uid()
             or public.is_routine_collaborator(coalesce(r.parent_routine_id, r.id))))
  );

create policy routine_sessions_update on public.routine_sessions
  for update using (public.is_session_member(id));

create policy routine_sessions_delete on public.routine_sessions
  for delete using (
    exists (select 1 from public.routines r
            where r.id = routine_id and r.user_id = auth.uid()));

-- Members: join yourself while the session is joinable; only your own row
-- is writable; readable by all session members / routine members.
create policy routine_session_members_select on public.routine_session_members
  for select using (public.can_read_session(session_id));

create policy routine_session_members_insert on public.routine_session_members
  for insert with check (
    user_id = auth.uid() and public.can_join_session(session_id));

create policy routine_session_members_update on public.routine_session_members
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy routine_session_members_delete on public.routine_session_members
  for delete using (user_id = auth.uid());

-- Sets: write your own rows while you're a member; read everyone's rows in
-- the session (that's the shared-progress view).
create policy routine_session_sets_select on public.routine_session_sets
  for select using (public.is_session_member(session_id));

create policy routine_session_sets_insert on public.routine_session_sets
  for insert with check (
    user_id = auth.uid() and public.is_session_member(session_id));

create policy routine_session_sets_update on public.routine_session_sets
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy routine_session_sets_delete on public.routine_session_sets
  for delete using (user_id = auth.uid());

-- Realtime: lobby readiness, member joins, live sets.
do $$
begin
  alter publication supabase_realtime add table public.routine_sessions;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.routine_session_members;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.routine_session_sets;
exception when duplicate_object then null;
end $$;

-- Sessions are ephemeral: if pg_cron is available, hard-delete anything stale
-- after 24h so abandoned lobbies/sessions don't accumulate. The client also
-- sweeps stale sessions when opening a routine's lobby.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'purge-routine-sessions',
      '0 * * * *',
      $job$delete from public.routine_sessions
        where created_at < now() - interval '24 hours'$job$);
  else
    raise notice 'pg_cron not installed - skipping scheduled session purge (client-side sweep applies)';
  end if;
end $$;
