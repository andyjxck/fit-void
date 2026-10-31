-- 018: scale hardening
--
-- 1) updated_at indexes for the incremental sync pull. Every sync runs
--    `WHERE updated_at > :cursor ORDER BY updated_at` per table; tables added
--    after 001 were missing the index, so each pull was a seq scan.
-- 2) Bucket file-size caps so a single upload can't bloat storage. The app
--    already compresses images client-side (1600px JPEG) and guards videos at
--    ~45MB; these limits are the server-side backstop.

create index if not exists nutrition_entries_updated_idx on public.nutrition_entries (user_id, updated_at);
create index if not exists liquid_entries_user_updated_idx on public.liquid_entries (user_id, updated_at);
create index if not exists meals_updated_idx            on public.meals (user_id, updated_at);
create index if not exists meal_plans_updated_idx       on public.meal_plans (user_id, updated_at);
create index if not exists food_items_updated_idx       on public.food_items (user_id, updated_at);
create index if not exists exercise_favourites_updated_idx on public.exercise_favourites (user_id, updated_at);
create index if not exists train_widgets_updated_idx    on public.train_widgets (user_id, updated_at);

-- Child tables carry no user_id (RLS validates via parent) - plain index.
create index if not exists meal_ingredients_updated_idx on public.meal_ingredients (updated_at);
create index if not exists meal_plan_items_updated_idx  on public.meal_plan_items (updated_at);
create index if not exists routine_folder_assignments_updated_idx on public.routine_folder_assignments (updated_at);

-- Social hot paths.
create index if not exists post_comments_post_idx on public.post_comments (post_id) where deleted_at is null;
create index if not exists posts_created_idx     on public.posts (created_at desc) where deleted_at is null;

-- Storage caps (bytes). post-photos also holds videos - keep it generous.
update storage.buckets set file_size_limit =  2 * 1024 * 1024 where id = 'avatars';
update storage.buckets set file_size_limit =  8 * 1024 * 1024 where id = 'shared-photos';
update storage.buckets set file_size_limit = 50 * 1024 * 1024 where id = 'post-photos';
update storage.buckets set file_size_limit = 10 * 1024 * 1024 where id = 'feedback';
