-- 034_delete_account_sessions — delete_account() predates the collab-session
-- tables (029). routine_sessions.created_by, routine_session_members.user_id
-- and routine_session_sets.user_id reference auth.users with NO cascade, so
-- deleting the auth row failed with an FK violation for anyone who had ever
-- joined a live session. Also drop feedback rows outright: the set-null FK
-- would detach them, but full deletion shouldn't keep submitted content.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Collab sessions first: my rows in other people's sessions, then sessions
  -- I created (cascades everyone else's member/set rows for those sessions).
  delete from public.routine_session_sets where user_id = auth.uid();
  delete from public.routine_session_members where user_id = auth.uid();
  delete from public.routine_sessions where created_by = auth.uid();
  -- Remove social data first (FK order), then the profile and auth row.
  delete from public.post_reports where reporter_id = auth.uid();
  delete from public.post_comments where user_id = auth.uid();
  delete from public.post_likes where user_id = auth.uid();
  delete from public.posts where user_id = auth.uid();
  delete from public.friendships where user_id = auth.uid() or friend_id = auth.uid();
  delete from public.blocked_users where blocker_id = auth.uid() or blocked_id = auth.uid();
  delete from public.gym_checkins where user_id = auth.uid();
  delete from public.shared_photos where user_id = auth.uid();
  delete from public.public_stats where user_id = auth.uid();
  delete from public.friend_codes where user_id = auth.uid();
  delete from public.feedback where user_id = auth.uid();
  delete from public.profiles where id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;
