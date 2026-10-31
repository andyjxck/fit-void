import type { FoodProduct } from '@/lib/foodLookup';
import { all, first, ownerId, run, softDelete, touch, uuid } from './helpers';

// serving stays nullable - a stored NULL means "unknown", not "100 g".
export interface FoodItem extends Omit<FoodProduct, 'serving'> {
  id: string;
  serving: string | null;
  last_used_at: string | null;
}

interface Row {
  id: string;
  user_id: string | null;
  barcode: string;
  name: string;
  brand: string | null;
  serving: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sugar_g: number;
  is_drink: number;
  per100g: string;
  image_url: string | null;
  last_used_at: string | null;
}

function toFoodItem(r: Row): FoodItem {
  let per100g = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sugar_g: 0 };
  try {
    const p = JSON.parse(r.per100g || '{}');
    if (p && typeof p === 'object') per100g = { ...per100g, ...p };
  } catch { /* keep defaults */ }
  return {
    id: r.id,
    barcode: r.barcode,
    name: r.name,
    brand: r.brand,
    serving: r.serving,
    calories: r.calories,
    protein_g: r.protein_g,
    carbs_g: r.carbs_g,
    fat_g: r.fat_g,
    sugar_g: r.sugar_g ?? 0,
    is_drink: r.is_drink === 1,
    image_url: r.image_url ?? null,
    per100g,
    last_used_at: r.last_used_at,
  };
}

/** Previously scanned product for this barcode, scoped to the owner. */
export async function getFoodByBarcode(barcode: string): Promise<FoodItem | null> {
  const r = await first<Row>(
    `SELECT * FROM food_items
      WHERE barcode = ? AND COALESCE(user_id, '') = COALESCE(?, '') AND deleted_at IS NULL
      LIMIT 1`,
    barcode,
    await ownerId()
  );
  return r ? toFoodItem(r) : null;
}

/** Every scanned product, most recently used first - the Meals "Scanned" list. */
export async function listFoodItems(): Promise<FoodItem[]> {
  const rows = await all<Row>(
    `SELECT * FROM food_items WHERE deleted_at IS NULL
      ORDER BY last_used_at DESC NULLS LAST, updated_at DESC`
  );
  return rows.map(toFoodItem);
}

/**
 * Upsert a looked-up product by (owner, barcode). Called after every
 * successful remote lookup so a barcode is only ever resolved once -
 * survives reinstall via sync.
 */
export async function saveFoodItem(product: Omit<FoodProduct, 'serving'> & { serving: string | null }): Promise<void> {
  const t = touch();
  const uid = await ownerId();
  const existing = await first<{ id: string }>(
    `SELECT id FROM food_items
      WHERE barcode = ? AND COALESCE(user_id, '') = COALESCE(?, '') AND deleted_at IS NULL`,
    product.barcode,
    uid
  );
  if (existing) {
    await run(
      `UPDATE food_items
        SET name = ?, brand = ?, serving = ?, calories = ?, protein_g = ?,
            carbs_g = ?, fat_g = ?, sugar_g = ?, is_drink = ?, per100g = ?,
            image_url = COALESCE(?, image_url),
            last_used_at = ?, updated_at = ?, dirty = 1
        WHERE id = ?`,
      product.name,
      product.brand,
      product.serving,
      product.calories,
      product.protein_g,
      product.carbs_g,
      product.fat_g,
      product.sugar_g ?? 0,
      product.is_drink ? 1 : 0,
      JSON.stringify(product.per100g),
      product.image_url ?? null,
      t,
      t,
      existing.id
    );
    return;
  }
  // A tombstoned row with the same key must be revived, not duplicated.
  const tomb = await first<{ id: string }>(
    `SELECT id FROM food_items
      WHERE barcode = ? AND COALESCE(user_id, '') = COALESCE(?, '') AND deleted_at IS NOT NULL`,
    product.barcode,
    uid
  );
  if (tomb) {
    await run(
      `UPDATE food_items
        SET name = ?, brand = ?, serving = ?, calories = ?, protein_g = ?,
            carbs_g = ?, fat_g = ?, sugar_g = ?, is_drink = ?, per100g = ?,
            image_url = COALESCE(?, image_url),
            last_used_at = ?, deleted_at = NULL, updated_at = ?, dirty = 1
        WHERE id = ?`,
      product.name,
      product.brand,
      product.serving,
      product.calories,
      product.protein_g,
      product.carbs_g,
      product.fat_g,
      product.sugar_g ?? 0,
      product.is_drink ? 1 : 0,
      JSON.stringify(product.per100g),
      product.image_url ?? null,
      t,
      t,
      tomb.id
    );
    return;
  }
  await run(
    `INSERT INTO food_items
      (id, user_id, barcode, name, brand, serving, calories, protein_g,
       carbs_g, fat_g, sugar_g, is_drink, per100g, image_url, last_used_at, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    uuid(),
    uid,
    product.barcode,
    product.name,
    product.brand,
    product.serving,
    product.calories,
    product.protein_g,
    product.carbs_g,
    product.fat_g,
    product.sugar_g ?? 0,
    product.is_drink ? 1 : 0,
    JSON.stringify(product.per100g),
    product.image_url ?? null,
    t,
    t
  );
}

/** barcode → image_url for rows that have one - powers list thumbnails. */
export async function foodImageMap(barcodes: string[]): Promise<Map<string, string>> {
  const codes = [...new Set(barcodes.filter(Boolean))];
  const map = new Map<string, string>();
  if (codes.length === 0) return map;
  const rows = await all<{ barcode: string; image_url: string }>(
    `SELECT barcode, image_url FROM food_items
      WHERE barcode IN (${codes.map(() => '?').join(',')})
        AND image_url IS NOT NULL AND deleted_at IS NULL`,
    ...codes
  );
  for (const r of rows) map.set(r.barcode, r.image_url);
  return map;
}

/** Bump recency when the user actually logs a scanned product. */
export async function touchFoodItem(id: string): Promise<void> {
  await run(
    `UPDATE food_items SET last_used_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    touch(),
    touch(),
    id
  );
}

export async function deleteFoodItem(id: string): Promise<void> {
  await softDelete('food_items', id);
}
