-- 028_collab_insert_shadowing — inside the friendships EXISTS subquery the
-- unqualified `user_id` binds to friendships.user_id (it has that column),
-- not the row being inserted. The second clause degenerated to
-- "any accepted row with friend_id = me", so invites only passed when the
-- FRIEND had initiated the friendship. Qualify the check-row refs.

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
        and (
          (f.user_id = routine_collaborators.invited_by
            and f.friend_id = routine_collaborators.user_id)
          or
          (f.user_id = routine_collaborators.user_id
            and f.friend_id = routine_collaborators.invited_by)
        )
    )
  );
