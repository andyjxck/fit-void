import type { NutritionEntry, NutritionSource } from '@/lib/types';

import { all, first, ownerId, run, softDelete, touch, uuid } from './helpers';

/** Local calendar day for "today" - avoids UTC rollover moving dinner to tomorrow. */
export function localDay(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function logFood(input: {
  name: string;
  calories: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  sugar_g?: number;
  is_drink?: boolean;
  serving?: string | null;
  barcode?: string | null;
  source?: NutritionSource;
  /** Dedupes health-platform imports ('ghealth:<dp-id>'). */
  external_id?: string | null;
  logged_on?: string;
  user_id?: string | null;
}): Promise<string> {
  const id = uuid();
  await run(
    `INSERT INTO nutrition_entries
       (id, user_id, logged_on, name, calories, protein_g, carbs_g, fat_g, sugar_g, is_drink, serving, barcode, source, external_id, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    id,
    input.user_id ?? (await ownerId()),
    input.logged_on ?? localDay(),
    input.name.trim(),
    input.calories,
    input.protein_g ?? 0,
    input.carbs_g ?? 0,
    input.fat_g ?? 0,
    input.sugar_g ?? 0,
    input.is_drink ? 1 : 0,
    input.serving ?? null,
    input.barcode ?? null,
    input.source ?? 'manual',
    input.external_id ?? null,
    touch()
  );
  return id;
}

/** True when a health-platform import with this external_id already exists. */
export async function hasFoodExternalId(externalId: string): Promise<boolean> {
  const r = await first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM nutrition_entries
      WHERE external_id = ? AND deleted_at IS NULL`,
    externalId
  );
  return (r?.n ?? 0) > 0;
}

export async function listFoodForDay(day = localDay()): Promise<NutritionEntry[]> {
  return all<NutritionEntry>(
    `SELECT * FROM nutrition_entries WHERE logged_on = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
    day
  );
}

export interface DayTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sugar_g: number;
  /** Subset of the above that came from drinks (for insights). */
  drink_sugar_g: number;
  drink_calories: number;
}

export async function dayTotals(day = localDay()): Promise<DayTotals> {
  const r = await first<DayTotals>(
    `SELECT COALESCE(SUM(calories),0) AS calories, COALESCE(SUM(protein_g),0) AS protein_g,
            COALESCE(SUM(carbs_g),0) AS carbs_g, COALESCE(SUM(fat_g),0) AS fat_g,
            COALESCE(SUM(sugar_g),0) AS sugar_g,
            COALESCE(SUM(CASE WHEN is_drink = 1 THEN sugar_g END),0) AS drink_sugar_g,
            COALESCE(SUM(CASE WHEN is_drink = 1 THEN calories END),0) AS drink_calories
       FROM nutrition_entries WHERE logged_on = ? AND deleted_at IS NULL`,
    day
  );
  // Drinks logged via the hydration card (soda, juice, …) count toward the
  // day like food. Scanned drinks carry their nutrition on the
  // nutrition_entries row; their liquid_entries shadow rows hold volume only
  // (0 kcal, 0 sugar) so nothing is double-counted.
  const lq = await first<{ calories: number; sugar_g: number }>(
    `SELECT COALESCE(SUM(calories),0) AS calories, COALESCE(SUM(sugar_g),0) AS sugar_g
       FROM liquid_entries WHERE logged_on = ? AND deleted_at IS NULL`,
    day
  );
  const base = r ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sugar_g: 0, drink_sugar_g: 0, drink_calories: 0 };
  base.calories += lq?.calories ?? 0;
  base.sugar_g += lq?.sugar_g ?? 0;
  base.drink_calories += lq?.calories ?? 0;
  base.drink_sugar_g += lq?.sugar_g ?? 0;
  return base;
}

/** Last `days` days of calorie totals, oldest first, zero-filled. */
export async function calorieHistory(days = 7): Promise<{ day: string; calories: number }[]> {
  // Local-midnight iteration - Date.now() - n*86400000 drifts across DST.
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const since = localDay(start);
  // Liquid calories count toward the day like dayTotals() does - otherwise
  // the 7-day chart disagrees with the day total.
  const rows = await all<{ day: string; calories: number }>(
    `SELECT day, SUM(calories) AS calories FROM (
        SELECT logged_on AS day, calories FROM nutrition_entries
         WHERE deleted_at IS NULL AND logged_on >= ?
        UNION ALL
        SELECT logged_on AS day, calories FROM liquid_entries
         WHERE deleted_at IS NULL AND logged_on >= ?
     ) GROUP BY day`,
    since,
    since
  );
  const map = new Map(rows.map((r) => [r.day, r.calories]));
  const out: { day: string; calories: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const day = localDay(d);
    out.push({ day, calories: map.get(day) ?? 0 });
  }
  return out;
}

/** Recently logged distinct foods for one-tap re-logging. */
export async function recentFoods(limit = 8): Promise<NutritionEntry[]> {
  return all<NutritionEntry>(
    `SELECT * FROM nutrition_entries n
      WHERE deleted_at IS NULL
        AND n.id = (
          SELECT m.id FROM nutrition_entries m
           WHERE m.name = n.name AND m.deleted_at IS NULL
           ORDER BY m.updated_at DESC, m.id DESC LIMIT 1
        )
      ORDER BY n.updated_at DESC LIMIT ?`,
    limit
  );
}

export async function deleteFood(id: string) {
  // Scanned drinks keep a volume-only shadow row in liquid_entries -
  // tombstone it too or it keeps counting toward hydration.
  await run(
    `UPDATE liquid_entries SET deleted_at = ?, updated_at = ?, dirty = 1
      WHERE nutrition_id = ? AND deleted_at IS NULL`,
    touch(),
    touch(),
    id
  );
  await softDelete('nutrition_entries', id);
}

/** Total calories logged in the last 7 days (local calendar days). */
export async function weekCalories(): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  const since = localDay(start);
  const r = await first<{ v: number | null }>(
    `SELECT COALESCE(SUM(calories), 0) AS v FROM (
        SELECT calories FROM nutrition_entries
         WHERE deleted_at IS NULL AND logged_on >= ?
        UNION ALL
        SELECT calories FROM liquid_entries
         WHERE deleted_at IS NULL AND logged_on >= ?
     )`,
    since,
    since
  );
  return r?.v ?? 0;
}
