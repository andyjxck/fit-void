-- Privacy hardening: photo buckets go private (signed URLs at read time,
-- minted client-side from stored object paths) and gym_checkins location
-- history stops accumulating.
--
-- 1) Buckets created as public in 005_social are flipped to private. The
--    *_read_all select policies are narrowed to authenticated users only;
--    object-level insert/update/delete owner policies stay as they were.
-- 2) A daily pg_cron job hard-deletes check-ins older than 24h (the app also
--    purges its own rows opportunistically on fetch, so the cron is a
--    belt-and-braces sweep for accounts that never open the map).
--
-- NOTE: pg_cron must be enabled for the scheduled job. If your project
-- doesn't have it, either enable it (Database → Extensions → pg_cron) or
-- skip the final block - the client-side purge already covers active users.

update storage.buckets
   set public = false
 where id in ('shared-photos', 'post-photos', 'avatars');

-- Authenticated-only reads (anon key holders without a session get nothing).
drop policy if exists "shared_photos_read_all" on storage.objects;
create policy "shared_photos_read_all" on storage.objects
  for select to authenticated
  using (bucket_id = 'shared-photos');

drop policy if exists "post_photos_read_all" on storage.objects;
create policy "post_photos_read_all" on storage.objects
  for select to authenticated
  using (bucket_id = 'post-photos');

drop policy if exists "avatars_read_all" on storage.objects;
create policy "avatars_read_all" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

-- Hard-delete expired check-ins daily (exact-location rows must not
-- accumulate). Runs as postgres, bypassing RLS. Skipped automatically when
-- pg_cron isn't installed - enable it (Database → Extensions → pg_cron) and
-- re-run this block to activate the server-side sweep.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'purge-gym-checkins',
      '15 3 * * *', -- 03:15 UTC daily
      $job$delete from public.gym_checkins where created_at < now() - interval '24 hours'$job$
    );
  else
    raise notice 'pg_cron not installed - skipping scheduled gym_checkins purge (client-side purge still applies)';
  end if;
end $$;
