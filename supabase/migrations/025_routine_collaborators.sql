-- 025_routine_collaborators — shared routine editing between friends.
--
-- Membership lives REMOTE-ONLY (like friendships): a row means "invitee may
-- collaborate on this routine". status pending -> accepted/declined by the
-- invitee; the owner or the invitee can delete the row (remove/leave).
-- The sync engine pulls shared routine trees through RLS, so the USING
-- policies below are what grant cross-account visibility.

create table if not exists public.routine_collaborators (
  id          uuid primary key default gen_random_uuid(),
  routine_id  uuid not null references public.routines (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade, -- invitee
  invited_by  uuid not null references public.profiles (id) on delete cascade, -- owner
  status      text not null default 'pending'
              check (status in ('pending', 'accepted', 'declined')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  responded_at timestamptz,
  unique (routine_id, user_id)
);

create index if not exists routine_collaborators_user_idx    on public.routine_collaborators (user_id, status);
create index if not exists routine_collaborators_routine_idx on public.routine_collaborators (routine_id);

drop trigger if exists routine_collaborators_set_updated_at on public.routine_collaborators;
create trigger routine_collaborators_set_updated_at before update on public.routine_collaborators
  for each row execute function public.set_updated_at();

alter table public.routine_collaborators enable row level security;

-- Read: the invitee, the inviter (owner), or a fellow member of that routine.
drop policy if exists routine_collaborators_select on public.routine_collaborators;
create policy routine_collaborators_select on public.routine_collaborators
  for select using (
    user_id = auth.uid()
    or invited_by = auth.uid()
    or exists (
      select 1 from public.routine_collaborators c2
      where c2.routine_id = routine_collaborators.routine_id
        and c2.user_id = auth.uid())
  );

-- Invite: only the routine owner, and only to an accepted friend.
drop policy if exists routine_collaborators_insert on public.routine_collaborators;
create policy routine_collaborators_insert on public.routine_collaborators
  for insert with check (
    invited_by = auth.uid()
    and user_id <> auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.routines r
      where r.id = routine_id and r.user_id = auth.uid()
    )
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted' and f.deleted_at is null
        and ((f.user_id = invited_by and f.friend_id = user_id)
          or (f.user_id = user_id and f.friend_id = invited_by))
    )
  );

-- Update: the invitee answers (pending -> accepted/declined). Owner edits are
-- done by deleting the row instead, so status can't be bounced back.
drop policy if exists routine_collaborators_update on public.routine_collaborators;
create policy routine_collaborators_update on public.routine_collaborators
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Delete: invitee leaves/declines, owner revokes or removes a collaborator.
drop policy if exists routine_collaborators_delete on public.routine_collaborators;
create policy routine_collaborators_delete on public.routine_collaborators
  for delete using (user_id = auth.uid() or invited_by = auth.uid());

-- routines: accepted collaborators get the same access as the owner.
-- The WITH CHECK keeps user_id pinned away from the writer so a collaborator
-- can't rewrite the row to claim ownership (RLS sees only the new row).
drop policy if exists routines_shared_collab on public.routines;
create policy routines_shared_collab on public.routines
  for all
  using (
    exists (select 1 from public.routine_collaborators c
            where c.routine_id = id and c.user_id = auth.uid() and c.status = 'accepted')
  )
  with check (
    user_id <> auth.uid()
    and exists (select 1 from public.routine_collaborators c
            where c.routine_id = id and c.user_id = auth.uid() and c.status = 'accepted')
  );

-- routine_exercises: allowed iff the parent is owned OR shared+accepted.
drop policy if exists routine_exercises_all_own on public.routine_exercises;
drop policy if exists routine_exercises_access on public.routine_exercises;
create policy routine_exercises_access on public.routine_exercises
  for all
  using (exists (
    select 1 from public.routines r where r.id = routine_id and (
      r.user_id = auth.uid() or exists (
        select 1 from public.routine_collaborators c
        where c.routine_id = r.id and c.user_id = auth.uid() and c.status = 'accepted')))
  )
  with check (exists (
    select 1 from public.routines r where r.id = routine_id and (
      r.user_id = auth.uid() or exists (
        select 1 from public.routine_collaborators c
        where c.routine_id = r.id and c.user_id = auth.uid() and c.status = 'accepted')))
  );

-- exercises: a collaborator's custom exercises used inside a shared routine
-- become readable so the tree can be pulled whole.
drop policy if exists exercises_shared_routine on public.exercises;
create policy exercises_shared_routine on public.exercises
  for select using (
    exists (
      select 1 from public.routine_exercises re
      join public.routine_collaborators c
        on c.routine_id = re.routine_id
       and c.user_id = auth.uid()
       and c.status = 'accepted'
      where re.exercise_id = exercises.id)
  );

-- routine_folder_assignments: same parent check.
drop policy if exists routine_folder_assignments_all_own on public.routine_folder_assignments;
drop policy if exists routine_folder_assignments_access on public.routine_folder_assignments;
create policy routine_folder_assignments_access on public.routine_folder_assignments
  for all
  using (exists (
    select 1 from public.routines r where r.id = routine_id and (
      r.user_id = auth.uid() or exists (
        select 1 from public.routine_collaborators c
        where c.routine_id = r.id and c.user_id = auth.uid() and c.status = 'accepted')))
  )
  with check (exists (
    select 1 from public.routines r where r.id = routine_id and (
      r.user_id = auth.uid() or exists (
        select 1 from public.routine_collaborators c
        where c.routine_id = r.id and c.user_id = auth.uid() and c.status = 'accepted')))
  );

-- Realtime so invitees get the pending badge live (same pattern as friendships).
alter table public.routine_collaborators replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = 'routine_collaborators'
     ) then
    execute 'alter publication supabase_realtime add table public.routine_collaborators';
  end if;
end $$;
