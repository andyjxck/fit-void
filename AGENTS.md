# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Gym Void

Offline-first strength tracker. Local SQLite (expo-sqlite) is the source of
truth; Supabase is an optional sync layer — guests never touch the network.

## Verify

- `npx tsc --noEmit` — typecheck
- `bun test` — pure-function tests in `src/lib/__tests__`
- `npx expo export --platform ios` — bundle smoke test

## Layout

- `src/app/` — expo-router routes; `src/app/(tabs)/` is the 4-tab shell
- `src/db/` — local schema (`schema.ts`), repositories (`repo/`), merge engine (`sync.ts`)
- `src/store/activeWorkout.ts` — live-workout state machine (ghost sets, rest HUD, finalizer)
- `supabase/migrations/001_init.sql` — cloud schema + RLS
- Sync contract: every synced table has `updated_at`, `deleted_at`, `dirty`;
  weights are stored canonically in kg and converted for display.

## Health imports

- `src/lib/healthImport.ts` + `googleHealthImport.ts` are serialized through
  `src/lib/importLock.ts` — dedupes are check-then-insert, never call the
  underlying run functions directly.
- Dedupe contract: `external_id` unique indexes (cardio/nutrition/liquid)
  plus `hasCardioNear(startIso, tol, activity)` — HealthKit vendors the same
  workout under different UUIDs, so content-level dedupe is required too.

## Collaborative routines

- `routine_collaborators` (remote-only, like friendships) tracks invites:
  pending/accepted/declined. RLS in `supabase/migrations/025_*` grants
  accepted collaborators full access to the routine + its child rows.
- `routines.is_shared` (local-only): pulled shared copies keep the owner's
  user_id — never claim, never `user_id`-filter them out. Push includes them;
  claimOrphanRows/claimGuestData skip them (`is_shared = 0` guard).
- Accepting an invite calls `pullRoutineTree` directly — the routine's
  updated_at is usually older than the sync watermark.
- Leaving/removal is a HARD local delete — a tombstone push would delete the
  owner's cloud copy.

## Design rules

- NEVER use left- or right-hand accent borders (`borderLeftWidth`/`borderRightWidth`
  with a colour). Borders are uniform; use icon tiles, text colour, or pills for tone.
- `Void.accentText` is near-black — only for text ON a lime button. Selected/active
  text on dark surfaces uses `Void.accent`.
- Bottom-of-list content needs ~100px padding to clear the tab bar.

## Meals & nutrition

- `src/app/meals/` — hub (`index.tsx`), meal editor (`[id].tsx`), plan editor (`plan/[id].tsx`)
- `src/db/repo/meals.ts` — meals, ingredients, plans, plan items (all soft-delete + sync)
- `src/lib/mealMath.ts` — pure: per-serving macros, shopping-list aggregation
- `src/lib/recipeImport.ts` — paste-a-link: parses schema.org/Recipe JSON-LD
- `src/lib/foodLookup.ts` — Open Food Facts barcode → product + per-100g macros
- `src/components/body/BarcodeScanner.tsx` — `expo-camera` CameraView + onBarcodeScanned
- `src/data/recommendedMeals.ts` — curated lifter recipes (copy-to-my-meals)
- `src/lib/eatMeal.ts` — log a meal's macros into today's `nutrition_entries`
- `expo-file-system` (new API): `new File(Paths.cache, name).write(text)` — NOT the legacy `writeAsStringAsync`
