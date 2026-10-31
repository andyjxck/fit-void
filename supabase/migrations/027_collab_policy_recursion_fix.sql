-- 027_collab_policy_recursion_fix — the 025 policies query
-- routine_collaborators from policies on OTHER tables, and the collab table's
-- own SELECT policy self-references it: every such path re-enters the
-- table's RLS → infinite recursion. Security-definer helpers bypass RLS and
-- break the cycle.

create or replace function public.is_routine_collaborator(p_routine uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.routine_collaborators
    where routine_id = p_routine
      and user_id = auth.uid()
      and status = 'accepted');
$$;

-- Any-status membership (pending/declined included) - used only for reading
-- the member list, never for granting write access.
create or replace function public.is_routine_member(p_routine uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.routine_collaborators
    where routine_id = p_routine
      and user_id = auth.uid());
$$;

-- routine_collaborators SELECT: invitee, inviter, or a fellow member.
drop policy if exists routine_collaborators_select on public.routine_collaborators;
create policy routine_collaborators_select on public.routine_collaborators
  for select using (
    user_id = auth.uid()
    or invited_by = auth.uid()
    or public.is_routine_member(routine_id)
  );

-- routines: accepted collaborators get owner-level access.
drop policy if exists routines_shared_collab on public.routines;
create policy routines_shared_collab on public.routines
  for all
  using (public.is_routine_collaborator(id))
  with check (user_id <> auth.uid() and public.is_routine_collaborator(id));

-- routine_exercises: parent owned OR shared+accepted.
drop policy if exists routine_exercises_access on public.routine_exercises;
create policy routine_exercises_access on public.routine_exercises
  for all
  using (exists (
    select 1 from public.routines r where r.id = routine_id
      and (r.user_id = auth.uid() or public.is_routine_collaborator(r.id)))
  )
  with check (exists (
    select 1 from public.routines r where r.id = routine_id
      and (r.user_id = auth.uid() or public.is_routine_collaborator(r.id)))
  );

-- routine_folder_assignments: same parent check.
drop policy if exists routine_folder_assignments_access on public.routine_folder_assignments;
create policy routine_folder_assignments_access on public.routine_folder_assignments
  for all
  using (exists (
    select 1 from public.routines r where r.id = routine_id
      and (r.user_id = auth.uid() or public.is_routine_collaborator(r.id)))
  )
  with check (exists (
    select 1 from public.routines r where r.id = routine_id
      and (r.user_id = auth.uid() or public.is_routine_collaborator(r.id)))
  );

-- exercises: custom exercises referenced by a shared routine stay readable.
drop policy if exists exercises_shared_routine on public.exercises;
create policy exercises_shared_routine on public.exercises
  for select using (
    exists (
      select 1 from public.routine_exercises re
      where re.exercise_id = exercises.id
        and public.is_routine_collaborator(re.routine_id))
  );
