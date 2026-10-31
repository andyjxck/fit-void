import { ALL_HIDE_KEY, FOCUS_SEED_WIDGETS, type Intent } from '@/lib/intents';
import { DEFAULT_WIDGETS, WIDGET_SIZES, type WidgetItem, type WidgetSize, type WidgetType } from '@/lib/widgetTypes';
import { getDb, now } from '../client';
import { ownerId, uuid } from './helpers';
import { listFolders, listRoutinesWithPreview } from './routines';

/** config is synced TEXT - one malformed pulled row must not crash render. */
const parseConfig = (raw: string | null): Record<string, unknown> => {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

/** Load all visible widgets sorted by display order. */
export async function listWidgets(): Promise<WidgetItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<WidgetItem, 'config'> & { config: string }>(
    `SELECT id, widget_type, config, size, sort_order, visible FROM train_widgets WHERE visible = 1 AND id != '__meta__' AND deleted_at IS NULL ORDER BY sort_order ASC`
  );
  return rows.map((r) => ({ ...r, config: parseConfig(r.config) }));
}

/** Load all hidden widgets (removed by user but re-addable). */
export async function listHiddenWidgets(): Promise<WidgetItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<WidgetItem, 'config'> & { config: string }>(
    `SELECT id, widget_type, config, size, sort_order, visible FROM train_widgets WHERE visible = 0 AND id != '__meta__' AND deleted_at IS NULL ORDER BY sort_order ASC`
  );
  return rows.map((r) => ({ ...r, config: parseConfig(r.config) }));
}

/** Seed default widgets if the table is empty.
 *  Creates one widget per existing routine and folder.
 *  Version-bumps force a full re-seed when the widget model changes. */
const WIDGET_SCHEMA_VERSION = 3;

export async function ensureDefaultWidgets(): Promise<void> {
  const db = await getDb();
  // Remove old grouped widget types that no longer exist. Soft-delete -
  // hard DELETEs leave no tombstone, so synced rows would resurrect on pull.
  await db.runAsync(
    `UPDATE train_widgets SET deleted_at = ?, updated_at = ?, dirty = 1
      WHERE widget_type IN ('quick_start', 'my_routines', 'example_routines', 'folders')
        AND deleted_at IS NULL`,
    now(),
    now()
  );

  // Check if we need to re-seed (schema version changed or table empty)
  const meta = await db.getFirstAsync<{ v: number }>(
    `SELECT CAST(config AS INTEGER) AS v FROM train_widgets WHERE id = '__meta__' AND deleted_at IS NULL`
  );
  const count = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM train_widgets WHERE id != '__meta__' AND deleted_at IS NULL`
  );

  const uid = await ownerId();

  if (meta?.v === WIDGET_SCHEMA_VERSION && count && count.n > 0) {
    // Upgrade path: graft widgets added after the last re-seed without
    // blowing away the user's layout.
    const hasHydration = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM train_widgets WHERE widget_type = 'hydration' AND deleted_at IS NULL`
    );
    if (!hasHydration?.n) {
      const max = await db.getFirstAsync<{ m: number | null }>(
        `SELECT MAX(sort_order) AS m FROM train_widgets WHERE deleted_at IS NULL`
      );
      // OR REPLACE: a tombstone under this id must be revived, not collide.
      await db.runAsync(
        `INSERT OR REPLACE INTO train_widgets (id, user_id, widget_type, config, size, sort_order, visible, updated_at, dirty)
         VALUES (?, ?, 'hydration', '{}', '1x1', ?, 1, ?, 1)`,
        `w_hydration`,
        uid,
        (max?.m ?? 0) + 1,
        now()
      );
    }
    // weekly_consistency is now universal/adaptive (always visible across
    // every focus) - un-hide any copy a user hid back when it was still
    // owned by only lift/habits/progress, and clear any leftover per-focus
    // hides so it can't be filtered out again.
    await db.runAsync(
      `UPDATE train_widgets SET visible = 1, config = '{}', updated_at = ?, dirty = 1
        WHERE widget_type = 'weekly_consistency' AND deleted_at IS NULL AND (visible = 0 OR config LIKE '%hidden_intents%')`,
      now()
    );
    return;
  }

  // Clear and re-seed - soft-delete so removals leave syncable tombstones.
  // Seed ids are deterministic and use INSERT OR REPLACE below, which
  // revives the tombstoned row instead of colliding with it.
  await db.runAsync(
    `UPDATE train_widgets SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE deleted_at IS NULL`,
    now(),
    now()
  );

  let order = 0;
  // Static defaults (weekly consistency)
  for (const w of DEFAULT_WIDGETS) {
    await db.runAsync(
      `INSERT OR REPLACE INTO train_widgets (id, user_id, widget_type, config, size, sort_order, visible, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      `w_${order}_${w.widget_type}`,
      uid,
      w.widget_type,
      JSON.stringify(w.config),
      w.size,
      order,
      w.visible,
      now()
    );
    order++;
  }

  // One widget per routine (user routines first, then examples)
  const routines = await listRoutinesWithPreview();
  const userRoutines = routines.filter((r) => !r.folder_name.startsWith('Examples ·'));
  const exampleRoutines = routines.filter((r) => r.folder_name.startsWith('Examples ·'));
  for (const r of userRoutines) {
    await db.runAsync(
      `INSERT OR REPLACE INTO train_widgets (id, user_id, widget_type, config, size, sort_order, visible, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      `w_routine_${r.id}`,
      uid,
      'routine',
      JSON.stringify({ routineId: r.id }),
      '1x1',
      order++,
      1,
      now()
    );
  }
  for (const r of exampleRoutines) {
    await db.runAsync(
      `INSERT OR REPLACE INTO train_widgets (id, user_id, widget_type, config, size, sort_order, visible, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      `w_routine_${r.id}`,
      uid,
      'example_routine',
      JSON.stringify({ routineId: r.id }),
      '1x1',
      order++,
      1,
      now()
    );
  }

  // One widget per folder (excluding 'My Routines')
  const folders = (await listFolders()).filter((f) => f !== 'My Routines');
  for (const f of folders) {
    await db.runAsync(
      `INSERT OR REPLACE INTO train_widgets (id, user_id, widget_type, config, size, sort_order, visible, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      `w_folder_${f}`,
      uid,
      'folder',
      JSON.stringify({ folderName: f }),
      '1x1',
      order++,
      1,
      now()
    );
  }

  // Record schema version
  await db.runAsync(
    `INSERT OR REPLACE INTO train_widgets (id, widget_type, config, size, sort_order, visible, updated_at, dirty)
     VALUES ('__meta__', 'meta', ?, '2x1', -1, 0, ?, 1)`,
    String(WIDGET_SCHEMA_VERSION),
    now()
  );
}

/** Seed a focus's curated starter widgets the first time it's activated -
 *  only adds types the user doesn't already have (visible or hidden), so
 *  re-seeding never resurrects something they deliberately removed.
 *  New widgets are inserted at the *top* (existing rows shift down) so
 *  activating a focus visibly reorganizes the dashboard instead of just
 *  tacking more widgets onto the bottom of the scroll. */
export async function ensureFocusWidgets(intent: Intent): Promise<void> {
  const types = FOCUS_SEED_WIDGETS[intent];
  if (!types || types.length === 0) return;
  const db = await getDb();
  const uid = await ownerId();

  const missing: WidgetType[] = [];
  for (const type of types) {
    const existing = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM train_widgets WHERE widget_type = ? AND deleted_at IS NULL`,
      type
    );
    if (!existing?.n) missing.push(type);
  }
  if (missing.length === 0) return;

  // Shift every existing row down to make room at the top.
  await db.runAsync(
    `UPDATE train_widgets SET sort_order = sort_order + ?, updated_at = ?, dirty = 1 WHERE deleted_at IS NULL`,
    missing.length,
    now()
  );
  for (let i = 0; i < missing.length; i++) {
    const type = missing[i];
    await db.runAsync(
      `INSERT INTO train_widgets (id, user_id, widget_type, config, size, sort_order, visible, updated_at, dirty)
       VALUES (?, ?, ?, '{}', ?, ?, 1, ?, 1)`,
      `w_${uuid()}`,
      uid,
      type,
      WIDGET_SIZES[type][0],
      i,
      now()
    );
  }
}

/**
 * ALL-focus layout maintenance, run on Train focus.
 *
 * 1. Orphan cleanup (every call): tombstones routine/folder tiles whose
 *    target was deleted - they only render "Routine removed" placeholders.
 * 2. One-shot seed (versioned via __all_seed__.config): under ALL keep the
 *    first tile of each widget TYPE, mark the rest 'all'-hidden. After the
 *    seed, ALL is just another remembered layout - user hides/restores
 *    persist via hidden_intents like every other focus.
 */
const ALL_SEED_VERSION = 2;

export async function ensureAllFocusDefault(): Promise<void> {
  const db = await getDb();

  // Orphaned routine/folder tiles - dead placeholders, gone for good.
  const orphans = await db.getAllAsync<{ id: string; widget_type: string; config: string }>(
    `SELECT id, widget_type, config FROM train_widgets
      WHERE widget_type IN ('routine', 'example_routine', 'folder') AND deleted_at IS NULL`
  );
  for (const w of orphans) {
    const cfg = parseConfig(w.config);
    let dead: boolean;
    if (w.widget_type === 'folder') {
      const name = cfg.folderName;
      dead = typeof name !== 'string' || name === '' ||
        !(await db.getFirstAsync(
          `SELECT 1 AS x FROM routine_folders WHERE name = ? AND deleted_at IS NULL`,
          name
        ));
    } else {
      const rid = cfg.routineId;
      dead = typeof rid !== 'string' ||
        !(await db.getFirstAsync(
          `SELECT 1 AS x FROM routines WHERE id = ? AND deleted_at IS NULL`,
          rid
        ));
    }
    if (dead) {
      await db.runAsync(
        `UPDATE train_widgets SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
        now(),
        now(),
        w.id
      );
    }
  }

  const meta = await db.getFirstAsync<{ v: number }>(
    `SELECT CAST(config AS INTEGER) AS v FROM train_widgets WHERE id = '__all_seed__' AND deleted_at IS NULL`
  );
  if ((meta?.v ?? 0) >= ALL_SEED_VERSION) return;

  // Re-seed must be deterministic - strip every existing 'all' mark, then
  // apply the type dedupe from scratch.
  const marked = await db.getAllAsync<{ id: string; config: string }>(
    `SELECT id, config FROM train_widgets
      WHERE config LIKE '%"all"%' AND deleted_at IS NULL AND id != '__meta__'`
  );
  for (const r of marked) {
    const cfg = parseConfig(r.config);
    const prev = Array.isArray(cfg.hidden_intents) ? (cfg.hidden_intents as string[]) : [];
    cfg.hidden_intents = prev.filter((i) => i !== ALL_HIDE_KEY);
    await db.runAsync(
      `UPDATE train_widgets SET config = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      JSON.stringify(cfg),
      now(),
      r.id
    );
  }

  // Keep the first tile per widget type; everything else is 'all'-hidden.
  const rows = await db.getAllAsync<{ id: string; widget_type: WidgetType; config: string }>(
    `SELECT id, widget_type, config FROM train_widgets
      WHERE visible = 1 AND deleted_at IS NULL AND id NOT IN ('__meta__', '__all_seed__')
      ORDER BY sort_order ASC`
  );
  const seen = new Set<WidgetType>();
  for (const r of rows) {
    if (!seen.has(r.widget_type)) {
      seen.add(r.widget_type);
      continue;
    }
    const cfg = parseConfig(r.config);
    const prev = Array.isArray(cfg.hidden_intents) ? (cfg.hidden_intents as string[]) : [];
    cfg.hidden_intents = [...new Set([...prev, ALL_HIDE_KEY])];
    await db.runAsync(
      `UPDATE train_widgets SET config = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      JSON.stringify(cfg),
      now(),
      r.id
    );
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO train_widgets (id, widget_type, config, size, sort_order, visible, updated_at, dirty)
     VALUES ('__all_seed__', 'meta', ?, '2x1', -2, 0, ?, 1)`,
    String(ALL_SEED_VERSION),
    now()
  );
}

/** Update a widget's size. */
export async function updateWidgetSize(id: string, size: WidgetSize): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE train_widgets SET size = ?, updated_at = ?, dirty = 1 WHERE id = ? AND deleted_at IS NULL`, size, now(), id);
}

/** Reorder widgets - takes the full ordered list of IDs. */
export async function reorderWidgets(ids: string[]): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < ids.length; i++) {
    await db.runAsync(`UPDATE train_widgets SET sort_order = ?, updated_at = ?, dirty = 1 WHERE id = ? AND deleted_at IS NULL`, i, now(), ids[i]);
  }
}

/** Hide (remove) a widget from the grid. */
export async function hideWidget(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE train_widgets SET visible = 0, updated_at = ?, dirty = 1 WHERE id = ? AND deleted_at IS NULL`, now(), id);
}

/** Show (re-add) a hidden widget, appending it to the end. */
export async function showWidget(id: string): Promise<void> {
  const db = await getDb();
  const max = await db.getFirstAsync<{ m: number }>(`SELECT MAX(sort_order) AS m FROM train_widgets WHERE deleted_at IS NULL`);
  await db.runAsync(
    `UPDATE train_widgets SET visible = 1, sort_order = ?, updated_at = ?, dirty = 1 WHERE id = ? AND deleted_at IS NULL`,
    (max?.m ?? 0) + 1,
    now(),
    id
  );
}

/** Add a new widget of a given type (for widgets that support multiple instances). */
export async function addWidget(type: WidgetType, config: Record<string, unknown> = {}, size?: WidgetSize): Promise<string> {
  const db = await getDb();
  const id = `w_${uuid()}`;
  const max = await db.getFirstAsync<{ m: number }>(`SELECT MAX(sort_order) AS m FROM train_widgets WHERE deleted_at IS NULL`);
  await db.runAsync(
    `INSERT INTO train_widgets (id, user_id, widget_type, config, size, sort_order, visible, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1)`,
    id,
    await ownerId(),
    type,
    JSON.stringify(config),
    size ?? '1x1',
    (max?.m ?? 0) + 1,
    now()
  );
  return id;
}

/** Update widget config (e.g. which routine/folder a widget points to). */
export async function updateWidgetConfig(id: string, config: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE train_widgets SET config = ?, updated_at = ?, dirty = 1 WHERE id = ? AND deleted_at IS NULL`, JSON.stringify(config), now(), id);
}
