-- 031_session_cleanup_rpc — when a collaborator leaves or is removed, their
-- routine_session_members / routine_session_sets rows should go too. The
-- delete policies only allow own-row deletes, so this scoped security
-- definer RPC does it: callable by the routine owner (for any member) or by
-- a member for themselves.

create or replace function public.purge_routine_sessions(p_routine uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (
    p_user = auth.uid()
    or exists (select 1 from public.routines where id = p_routine and user_id = auth.uid())
  ) then
    raise exception 'not allowed';
  end if;

  delete from public.routine_session_sets
  where user_id = p_user
    and session_id in (select id from public.routine_sessions where routine_id = p_routine);
  delete from public.routine_session_members
  where user_id = p_user
    and session_id in (select id from public.routine_sessions where routine_id = p_routine);
end;
$$;
