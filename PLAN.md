# Gym Void — Roadmap Plan

> Working doc. Pick off items in order; each section lists scope + files.

## 0. Open bugs (fix first)

- [ ] **Meals sheet**: can't scroll to METHOD section (sheet content overflows, ScrollView not scrolling) — `src/app/(tabs)/meals.tsx` Discover/recipe Sheet + `meals/[id].tsx`. Also nutrition info row is ugly — restyle the per-serving/batch total block into the stat-tile style used elsewhere.
- [ ] **Gym check-in modal shows no gyms** — `GymSearchModal` + `src/lib/gyms.ts`. Overpass query was widened (node/way/relation) but still returns nothing on device — verify query actually hits network, check UA/URL encode, test `searchGyms` bias. Possibly silent catch swallowing errors — surface them.
- [ ] **Post failed: `fetch failed: UnexpectedException: cannot parse response`** — `createPost`/`uploadPostImage` in `src/lib/social.ts`. Repro with photo + video; likely storage upload response parsing or the posts insert `.select()`.
- [ ] **Migrations pending remote apply**: `010`–`017` must be run in Supabase SQL editor before sync errors fully clear (esp. `015`, `016`, `017`).

## 1. Paywall split (Void Pro)

Pricing target: ~$4.99/mo, ~$34.99/yr, lifetime ~$89.99. Gate = `has_void_pro` + `VoidProGate`.

**Free** (matches market):
- All logging (sets/reps/RPE/supersets/rest timer), PRs, plate calc
- Barcode scanning (undercut MFP's $80/yr paywall)
- All social + gym check-in map
- Hydration/drinks, weight, basic check-ins, cardio logging
- Health import, sync, offline, basic widgets
- Caps: ~5 routines, ~10 custom exercises, ~3 months analytics history in daily form (Hevy precedent)
- Recipe URL import, meal plans, custom macro targets
- Muscle heatmap, strength score/e1RM trends

**Pro**:
- Unlimited routines/folders/custom exercises; all-time history
- Weekly + monthly reports
- "For you today" insights — top insight free, rest gated
- HR zones + pace analysis, tape measurements
- Themes/icons/widget customization

Files: `src/lib/entitlements.ts`, `VoidProGate.tsx`, routine/exercise creation sites, analytics, insights, recipeImport UI, paywall.tsx copy.

## 2. Community routine marketplace

Boostcamp-style: users publish routines; others browse/like/clone.

- Migration `018_community_routines.sql`: `shared_routines` (id, author_id FK profiles, name, description, category, level, days/week, data jsonb [routine+exercises snapshot], likes_count, created_at, updated_at) + `shared_routine_likes` (user_id, shared_id) + RLS (read all auth, write own).
- `src/lib/social.ts`: `publishRoutine`, `listSharedRoutines(search/sort)`, `likeSharedRoutine`, `cloneSharedRoutine` (insert into routines + routine_exercises, mark source).
- UI: "PUBLISH" action on `routine/[id].tsx`; browse screen (search, sort by likes/new, author + exercise preview, like button, ADD TO MY ROUTINES); entry point from Train tab EXAMPLES or social.
- Seed with our curated examples so it isn't empty at launch.

## 3. Progress photos

- `progress_photos` table (local + synced): id, user_id, photo (local file path; remote storage path), pose/tag, logged_at. Synced table + private storage bucket + signed URLs.
- UI on Body tab: timeline grid, add via camera/library (reuse photo picker), side-by-side compare view, link to nearest weight/measurement.
- Pro-gated per competitor precedent.

## 4. Analytics upgrades

- e1RM trend chart per exercise (`src/lib/onerm.ts` exists — Brzycki; build curve + overall Strength Score on analytics).
- Weekly/monthly report card + shareable Wrapped-style summary.

## 5. Smaller features

- Micronutrients display (top ~10: sodium, fiber, iron, calcium, vit C/D, sugar) — OFF returns them; surface in FoodSheet + day totals.
- Leaderboards (friends volume/PR weekly) — social tables exist.
- Themes/app icons — Pro perk.
- Fasting timer — trivial.
- HealthKit write-back for workouts.
- GPS cardio tracking (route map) — biggest lift of this group.

## Notes

- Competitor reference: Hevy (free: 4 routines/7 ex/3mo charts), Strong (charts paid), MFP (barcode paid — we stay free), Cronometer (recipe import paid), Boostcamp (marketplace model), Strava (HR zones paid).
- Privacy invariants: no PII sync (height/sex/birth year stay local), fuzzed check-in coords, signed photo URLs, wipe-on-signout.
