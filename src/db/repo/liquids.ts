import { all, first, ownerId, run, softDelete, touch, uuid } from './helpers';
import { localDay } from './nutrition';

export const LIQUID_KINDS = ['water', 'soda', 'juice', 'coffee', 'tea', 'energy', 'alcohol', 'other'] as const;
export type LiquidKind = (typeof LIQUID_KINDS)[number];

export interface LiquidEntry {
  id: string;
  user_id: string | null;
  logged_on: string;
  name: string;
  kind: LiquidKind;
  amount_ml: number;
  calories: number;
  sugar_g: number;
  /** Set when this row shadows a nutrition_entries drink row. */
  nutrition_id: string | null;
  updated_at: string;
  deleted_at: string | null;
}

export const KIND_DEFAULT_NAME: Record<LiquidKind, string> = {
  water: 'Water',
  soda: 'Soda',
  juice: 'Juice',
  coffee: 'Coffee',
  tea: 'Tea',
  energy: 'Energy drink',
  alcohol: 'Alcohol',
  other: 'Drink',
};

export async function logLiquid(input: {
  amount_ml: number;
  kind?: LiquidKind;
  name?: string;
  calories?: number;
  sugar_g?: number;
  /** Links this row to a nutrition_entries drink it shadows. */
  nutrition_id?: string | null;
  /** Dedupes health-platform imports ('ghealth:<dp-id>'). */
  external_id?: string | null;
  logged_on?: string;
  user_id?: string | null;
}): Promise<string> {
  const kind = input.kind ?? 'water';
  const id = uuid();
  await run(
    `INSERT INTO liquid_entries
       (id, user_id, logged_on, name, kind, amount_ml, calories, sugar_g, nutrition_id, external_id, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    id,
    input.user_id ?? (await ownerId()),
    input.logged_on ?? localDay(),
    (input.name ?? KIND_DEFAULT_NAME[kind]).trim(),
    kind,
    input.amount_ml,
    input.calories ?? 0,
    input.sugar_g ?? 0,
    input.nutrition_id ?? null,
    input.external_id ?? null,
    touch()
  );
  return id;
}

/** True when a health-platform import with this external_id already exists. */
export async function hasLiquidExternalId(externalId: string): Promise<boolean> {
  const r = await first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM liquid_entries
      WHERE external_id = ? AND deleted_at IS NULL`,
    externalId
  );
  return (r?.n ?? 0) > 0;
}

/**
 * Cross-source dedupe for imported water: a different source may have already
 * logged the same drink on the same day (no shared upstream id, so match on
 * day + amount within 15%). Ignores the row that owns `selfExt`.
 */
export async function hasLiquidNear(
  day: string,
  amountMl: number,
  selfExt?: string
): Promise<boolean> {
  const r = await first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM liquid_entries
      WHERE logged_on = ? AND deleted_at IS NULL
        AND ABS(amount_ml - ?) <= MAX(60, amount_ml * 0.15)
        AND (external_id IS NULL OR external_id != ?)`,
    day,
    amountMl,
    selfExt ?? ''
  );
  return (r?.n ?? 0) > 0;
}

export async function listLiquidsForDay(day = localDay()): Promise<LiquidEntry[]> {
  return all<LiquidEntry>(
    `SELECT * FROM liquid_entries WHERE logged_on = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
    day
  );
}

export async function deleteLiquid(id: string): Promise<void> {
  // Scanned drinks link a parent nutrition_entries row via nutrition_id -
  // tombstone it too or the drink's calories linger in the food log.
  const row = await first<{ nutrition_id: string | null }>(
    `SELECT nutrition_id FROM liquid_entries WHERE id = ?`,
    id
  );
  if (row?.nutrition_id) {
    await run(
      `UPDATE nutrition_entries SET deleted_at = ?, updated_at = ?, dirty = 1
        WHERE id = ? AND deleted_at IS NULL`,
      touch(),
      touch(),
      row.nutrition_id
    );
  }
  await softDelete('liquid_entries', id);
}

export interface LiquidTotals {
  amount_ml: number;
  calories: number;
  sugar_g: number;
}

export async function liquidTotalsForDay(day = localDay()): Promise<LiquidTotals> {
  const r = await first<LiquidTotals>(
    `SELECT COALESCE(SUM(amount_ml),0) AS amount_ml, COALESCE(SUM(calories),0) AS calories,
            COALESCE(SUM(sugar_g),0) AS sugar_g
       FROM liquid_entries WHERE logged_on = ? AND deleted_at IS NULL`,
    day
  );
  return r ?? { amount_ml: 0, calories: 0, sugar_g: 0 };
}

/** Per-day ml totals, oldest first, zero-filled - for charts. */
export async function liquidHistory(days = 7): Promise<{ day: string; amount_ml: number }[]> {
  // Local-midnight iteration - Date.now() - n*86400000 drifts across DST.
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const rows = await all<{ day: string; amount_ml: number }>(
    `SELECT logged_on AS day, SUM(amount_ml) AS amount_ml
       FROM liquid_entries
      WHERE deleted_at IS NULL AND logged_on >= ?
      GROUP BY logged_on`,
    localDay(start)
  );
  const map = new Map(rows.map((r) => [r.day, r.amount_ml]));
  const out: { day: string; amount_ml: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const day = localDay(d);
    out.push({ day, amount_ml: map.get(day) ?? 0 });
  }
  return out;
}

/** Daily target in ml - user override first, then ~35ml/kg, else 2L. */
export function liquidTargetMl(weightKg: number | null | undefined, overrideMl?: number | null): number {
  if (overrideMl != null && overrideMl > 0) return Math.round(overrideMl);
  if (weightKg != null && weightKg > 0) return Math.round((weightKg * 35) / 250) * 250;
  return 2000;
}
