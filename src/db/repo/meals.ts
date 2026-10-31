import { getDb } from '@/db/client';
import { mealTotals } from '@/lib/mealMath';
import type { Macros, Meal, MealIngredient, MealPlan, MealPlanItem, MealSlot, MealType } from '@/lib/types';

import { all, first, ownerId, run, softDelete, touch, uuid } from './helpers';

// -- Rows ------------------------------------------------------------------

interface MealRow {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  servings: number;
  method: string;
  tags: string;
  source_url: string | null;
  pitch: string | null;
  minutes: number | null;
  goal: string | null;
  meal_type: string | null;
  image_uri: string | null;
  is_favourite: number;
  sort_order: number;
}

/** Synced text columns can arrive malformed - never let one row crash a list. */
const parseStringArray = (raw: string | null): string[] => {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const toMeal = (r: MealRow): Meal => ({
  ...r,
  method: parseStringArray(r.method),
  tags: parseStringArray(r.tags),
  pitch: r.pitch ?? null,
  minutes: r.minutes ?? null,
  goal: (r.goal as Meal['goal']) ?? null,
  meal_type: (r.meal_type as Meal['meal_type']) ?? null,
  image_uri: r.image_uri ?? null,
  is_favourite: r.is_favourite === 1,
});

interface PlanRow extends Omit<MealPlan, 'is_favourite' | 'pitch' | 'goal' | 'tags'> {
  is_favourite: number;
  pitch: string | null;
  goal: string | null;
  tags: string;
}
const toPlan = (r: PlanRow): MealPlan => ({
  ...r,
  pitch: r.pitch ?? null,
  goal: (r.goal as MealPlan['goal']) ?? null,
  tags: parseStringArray(r.tags),
  is_favourite: r.is_favourite === 1,
});

export interface MealWithMacros extends Meal {
  perServing: Macros;
  ingredientCount: number;
}

// -- Meals -----------------------------------------------------------------

export interface IngredientInput {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  barcode?: string | null;
}

export interface MealInput {
  name: string;
  description?: string | null;
  servings?: number;
  method?: string[];
  tags?: string[];
  source_url?: string | null;
  pitch?: string | null;
  minutes?: number | null;
  goal?: 'cut' | 'maintain' | 'bulk' | 'any' | null;
  meal_type?: MealType | null;
  image_uri?: string | null;
  user_id?: string | null;
  ingredients?: IngredientInput[];
}

export async function listMeals(opts?: { favouritesOnly?: boolean; query?: string }): Promise<MealWithMacros[]> {
  let sql = `SELECT * FROM meals WHERE deleted_at IS NULL`;
  const params: unknown[] = [];
  if (opts?.favouritesOnly) sql += ` AND is_favourite = 1`;
  if (opts?.query) {
    sql += ` AND name LIKE ?`;
    params.push(`%${opts.query}%`);
  }
  sql += ` ORDER BY is_favourite DESC, sort_order ASC, name ASC`;
  const meals = (await all<MealRow>(sql, ...params)).map(toMeal);
  if (meals.length === 0) return [];

  const ids = meals.map((m) => m.id);
  const ings = await all<MealIngredient>(
    `SELECT * FROM meal_ingredients WHERE meal_id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL`,
    ...ids
  );
  const byMeal = new Map<string, MealIngredient[]>();
  for (const i of ings) byMeal.set(i.meal_id, [...(byMeal.get(i.meal_id) ?? []), i]);
  return meals.map((m) => {
    const list = byMeal.get(m.id) ?? [];
    return { ...m, perServing: mealTotals(list, m.servings).perServing, ingredientCount: list.length };
  });
}

export async function getMeal(id: string): Promise<(Meal & { ingredients: MealIngredient[] }) | null> {
  const r = await first<MealRow>(`SELECT * FROM meals WHERE id = ? AND deleted_at IS NULL`, id);
  if (!r) return null;
  const ingredients = await all<MealIngredient>(
    `SELECT * FROM meal_ingredients WHERE meal_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC`,
    id
  );
  return { ...toMeal(r), ingredients };
}

export async function createMeal(input: MealInput): Promise<string> {
  const db = await getDb();
  const id = uuid();
  const t = touch();
  const max = await first<{ m: number | null }>(`SELECT MAX(sort_order) AS m FROM meals WHERE deleted_at IS NULL`);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO meals (id, user_id, name, description, servings, method, tags, source_url, pitch, minutes, goal, meal_type, image_uri, is_favourite, sort_order, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)`,
      id,
      input.user_id ?? (await ownerId()),
      input.name.trim(),
      input.description?.trim() || null,
      input.servings && input.servings > 0 ? input.servings : 1,
      JSON.stringify(input.method ?? []),
      JSON.stringify(input.tags ?? []),
      input.source_url ?? null,
      input.pitch ?? null,
      input.minutes ?? null,
      input.goal ?? null,
      input.meal_type ?? null,
      input.image_uri ?? null,
      (max?.m ?? -1) + 1,
      t
    );
    let order = 0;
    for (const ing of input.ingredients ?? []) {
      await db.runAsync(
        `INSERT INTO meal_ingredients (id, meal_id, name, quantity, unit, calories, protein_g, carbs_g, fat_g, barcode, sort_order, updated_at, dirty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        uuid(),
        id,
        ing.name.trim(),
        ing.quantity ?? null,
        ing.unit ?? null,
        ing.calories ?? 0,
        ing.protein_g ?? 0,
        ing.carbs_g ?? 0,
        ing.fat_g ?? 0,
        ing.barcode ?? null,
        order++,
        t
      );
    }
  });
  return id;
}

export async function updateMeal(
  id: string,
  patch: Partial<Pick<Meal, 'name' | 'description' | 'servings' | 'method' | 'tags' | 'source_url' | 'pitch' | 'minutes' | 'goal' | 'meal_type' | 'image_uri'>>
) {
  const cur = await getMeal(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  await run(
    `UPDATE meals SET name = ?, description = ?, servings = ?, method = ?, tags = ?, source_url = ?, pitch = ?, minutes = ?, goal = ?, meal_type = ?, image_uri = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    next.name.trim(),
    next.description?.trim() || null,
    next.servings > 0 ? next.servings : 1,
    JSON.stringify(next.method),
    JSON.stringify(next.tags),
    next.source_url ?? null,
    next.pitch ?? null,
    next.minutes ?? null,
    next.goal ?? null,
    next.meal_type ?? null,
    next.image_uri ?? null,
    touch(),
    id
  );
}

export async function toggleMealFavourite(id: string) {
  await run(`UPDATE meals SET is_favourite = 1 - is_favourite, updated_at = ?, dirty = 1 WHERE id = ?`, touch(), id);
}

export async function deleteMeal(id: string) {
  const t = touch();
  await run(`UPDATE meal_ingredients SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE meal_id = ?`, t, t, id);
  await run(`UPDATE meal_plan_items SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE meal_id = ?`, t, t, id);
  await softDelete('meals', id);
}

/** Persist a new explicit order for the given meal IDs. */
export async function reorderMeals(ids: string[]) {
  const db = await getDb();
  const t = touch();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < ids.length; i++) {
      await db.runAsync(`UPDATE meals SET sort_order = ?, updated_at = ?, dirty = 1 WHERE id = ?`, i, t, ids[i]);
    }
  });
}

export async function duplicateMeal(id: string, user_id?: string | null): Promise<string | null> {
  const m = await getMeal(id);
  if (!m) return null;
  return createMeal({ ...m, name: `${m.name} (copy)`, user_id: user_id ?? m.user_id, ingredients: m.ingredients });
}

// -- Ingredients -----------------------------------------------------------

export async function addIngredient(meal_id: string, ing: IngredientInput): Promise<string> {
  const id = uuid();
  const max = await first<{ m: number | null }>(
    `SELECT MAX(sort_order) AS m FROM meal_ingredients WHERE meal_id = ? AND deleted_at IS NULL`,
    meal_id
  );
  await run(
    `INSERT INTO meal_ingredients (id, meal_id, name, quantity, unit, calories, protein_g, carbs_g, fat_g, barcode, sort_order, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    id,
    meal_id,
    ing.name.trim(),
    ing.quantity ?? null,
    ing.unit ?? null,
    ing.calories ?? 0,
    ing.protein_g ?? 0,
    ing.carbs_g ?? 0,
    ing.fat_g ?? 0,
    ing.barcode ?? null,
    (max?.m ?? -1) + 1,
    touch()
  );
  await run(`UPDATE meals SET updated_at = ?, dirty = 1 WHERE id = ?`, touch(), meal_id);
  return id;
}

export async function updateIngredient(id: string, ing: IngredientInput) {
  await run(
    `UPDATE meal_ingredients SET name = ?, quantity = ?, unit = ?, calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, barcode = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    ing.name.trim(),
    ing.quantity ?? null,
    ing.unit ?? null,
    ing.calories ?? 0,
    ing.protein_g ?? 0,
    ing.carbs_g ?? 0,
    ing.fat_g ?? 0,
    ing.barcode ?? null,
    touch(),
    id
  );
}

export async function deleteIngredient(id: string) {
  await softDelete('meal_ingredients', id);
}

// -- Plans -----------------------------------------------------------------

export interface PlanItemWithMeal extends MealPlanItem {
  meal: MealWithMacros;
}

export async function listPlans(): Promise<(MealPlan & { itemCount: number; avgCalories: number; coverImages: string[] })[]> {
  const plans = (await all<PlanRow>(`SELECT * FROM meal_plans WHERE deleted_at IS NULL ORDER BY is_favourite DESC, sort_order ASC, name ASC`)).map(toPlan);
  if (plans.length === 0) return [];
  const meals = await listMeals();
  const mealMap = new Map(meals.map((m) => [m.id, m]));
  const items = await all<MealPlanItem>(
    `SELECT * FROM meal_plan_items WHERE deleted_at IS NULL AND plan_id IN (${plans.map(() => '?').join(',')})`,
    ...plans.map((p) => p.id)
  );
  return plans.map((p) => {
    const mine = items.filter((i) => i.plan_id === p.id);
    const kcal = mine.reduce((s, i) => s + (mealMap.get(i.meal_id)?.perServing.calories ?? 0) * i.servings, 0);
    const daysUsed = new Set(mine.map((i) => i.day_index)).size || 1;
    // Cover collage - up to 4 distinct member-meal photos, in plan order.
    const coverImages = [...new Set(mine.map((i) => mealMap.get(i.meal_id)?.image_uri).filter((u): u is string => !!u))].slice(0, 4);
    return { ...p, itemCount: mine.length, avgCalories: Math.round(kcal / daysUsed), coverImages };
  });
}

export async function getPlan(id: string): Promise<(MealPlan & { items: PlanItemWithMeal[] }) | null> {
  const r = await first<PlanRow>(`SELECT * FROM meal_plans WHERE id = ? AND deleted_at IS NULL`, id);
  if (!r) return null;
  const meals = await listMeals();
  const mealMap = new Map(meals.map((m) => [m.id, m]));
  const rows = await all<MealPlanItem>(
    `SELECT * FROM meal_plan_items WHERE plan_id = ? AND deleted_at IS NULL ORDER BY day_index, sort_order`,
    id
  );
  const items = rows.flatMap((i) => {
    const meal = mealMap.get(i.meal_id);
    return meal ? [{ ...i, meal }] : [];
  });
  return { ...toPlan(r), items };
}

export async function createPlan(input: { name: string; description?: string | null; days?: number; user_id?: string | null; pitch?: string | null; goal?: 'cut' | 'maintain' | 'bulk' | 'any' | null; tags?: string[] }): Promise<string> {
  const id = uuid();
  const max = await first<{ m: number | null }>(`SELECT MAX(sort_order) AS m FROM meal_plans WHERE deleted_at IS NULL`);
  await run(
    `INSERT INTO meal_plans (id, user_id, name, description, days, pitch, goal, tags, is_favourite, sort_order, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)`,
    id,
    input.user_id ?? (await ownerId()),
    input.name.trim(),
    input.description?.trim() || null,
    Math.min(14, Math.max(1, input.days ?? 7)),
    input.pitch ?? null,
    input.goal ?? null,
    JSON.stringify(input.tags ?? []),
    (max?.m ?? -1) + 1,
    touch()
  );
  return id;
}

export async function updatePlan(id: string, patch: Partial<Pick<MealPlan, 'name' | 'description' | 'days'>>) {
  const cur = await first<PlanRow>(`SELECT * FROM meal_plans WHERE id = ?`, id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  await run(
    `UPDATE meal_plans SET name = ?, description = ?, days = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    next.name.trim(),
    next.description?.trim() || null,
    Math.min(14, Math.max(1, next.days)),
    touch(),
    id
  );
}

export async function togglePlanFavourite(id: string) {
  await run(`UPDATE meal_plans SET is_favourite = 1 - is_favourite, updated_at = ?, dirty = 1 WHERE id = ?`, touch(), id);
}

export async function deletePlan(id: string) {
  const t = touch();
  await run(`UPDATE meal_plan_items SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE plan_id = ?`, t, t, id);
  await softDelete('meal_plans', id);
}

export async function reorderPlans(ids: string[]) {
  const db = await getDb();
  const t = touch();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < ids.length; i++) {
      await db.runAsync(`UPDATE meal_plans SET sort_order = ?, updated_at = ?, dirty = 1 WHERE id = ?`, i, t, ids[i]);
    }
  });
}

export async function addPlanItem(input: { plan_id: string; meal_id: string; day_index: number; slot: MealSlot; servings?: number }): Promise<string> {
  const id = uuid();
  const max = await first<{ m: number | null }>(
    `SELECT MAX(sort_order) AS m FROM meal_plan_items WHERE plan_id = ? AND day_index = ? AND deleted_at IS NULL`,
    input.plan_id,
    input.day_index
  );
  await run(
    `INSERT INTO meal_plan_items (id, plan_id, meal_id, day_index, slot, servings, sort_order, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    id,
    input.plan_id,
    input.meal_id,
    input.day_index,
    input.slot,
    input.servings ?? 1,
    (max?.m ?? -1) + 1,
    touch()
  );
  await run(`UPDATE meal_plans SET updated_at = ?, dirty = 1 WHERE id = ?`, touch(), input.plan_id);
  return id;
}

export async function updatePlanItem(id: string, patch: Partial<Pick<MealPlanItem, 'servings' | 'slot' | 'day_index'>>) {
  const cur = await first<MealPlanItem>(`SELECT * FROM meal_plan_items WHERE id = ?`, id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  await run(
    `UPDATE meal_plan_items SET servings = ?, slot = ?, day_index = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    next.servings,
    next.slot,
    next.day_index,
    touch(),
    id
  );
}

export async function removePlanItem(id: string) {
  await softDelete('meal_plan_items', id);
}
