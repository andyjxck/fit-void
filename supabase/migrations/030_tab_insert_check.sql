-- 030_tab_insert_check — the routines_shared_collab WITH CHECK called
-- is_routine_collaborator(id), which looks the row up in routines to find
-- its parent. During an INSERT the row isn't in the table yet, so the
-- parent-chain resolution always failed and collaborators couldn't create
-- tabs. Check parent_routine_id directly instead.

drop policy if exists routines_shared_collab on public.routines;
create policy routines_shared_collab on public.routines
  for all
  using (public.is_routine_collaborator(id))
  with check (
    user_id <> auth.uid()
    and public.is_routine_collaborator(coalesce(parent_routine_id, id))
  );
