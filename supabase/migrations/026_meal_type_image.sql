-- Meal slot (breakfast/lunch/dinner/dessert/snack) + image URI.
-- image_uri stores a remote URL for link-imported recipes; for user-attached
-- photos it is a device-local file URI that other devices simply won't resolve.
alter table public.meals
  add column if not exists meal_type text,
  add column if not exists image_uri text;
