-- delete_account(): workout_sets.exercise_id and routine_exercises.exercise_id
-- are RESTRICT FKs into exercises. Deleting auth.users cascades to the
-- account's exercises (created_by), and Postgres refuses while ANY set or
-- routine slot still references them - RESTRICT can't be deferred, so even
-- rows the same cascade is about to remove block it. Any account that ever
-- logged a set on one of its own exercises could not be deleted.
--
-- Fix: delete the referencing rows first. The subqueries are intentionally
-- not user-scoped - a collaborator's workout set or routine slot can also
-- reference my exercise, and it has to go since the exercise itself is
-- being deleted.

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

  -- RESTRICT FKs into exercises: kill every row referencing my exercises
  -- before the cascade deletes the exercises themselves.
  delete from public.workout_sets
    where exercise_id in (select id from public.exercises where created_by = auth.uid());
  delete from public.routine_exercises
    where exercise_id in (select id from public.exercises where created_by = auth.uid());

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
