import type { Routine, RoutineExercise, SetType } from '@/lib/types';

import { getDb } from '../client';
import { all, first, ownerId, run, softDelete, touch, uuid } from './helpers';

export async function listRoutines(): Promise<Routine[]> {
  return all<Routine>(
    `SELECT * FROM routines
      WHERE deleted_at IS NULL AND archived_at IS NULL AND parent_routine_id IS NULL
      ORDER BY folder_name, sort_order, title`
  );
}

export async function getRoutine(id: string): Promise<Routine | null> {
  return first<Routine>('SELECT * FROM routines WHERE id = ? AND deleted_at IS NULL', id);
}

interface RoutineExerciseRow extends Omit<RoutineExercise, 'target_reps' | 'target_weights' | 'target_types'> {
  target_reps: string; // JSON array locally, integer[] in cloud
  target_weights: string; // JSON array of kg / nulls
  target_types: string; // JSON array of SetType
}

const toRoutineExercise = (r: RoutineExerciseRow): RoutineExercise => ({
  ...r,
  target_reps: JSON.parse(r.target_reps || '[]'),
  target_weights: JSON.parse(r.target_weights || '[]'),
  target_types: JSON.parse(r.target_types || '[]'),
});

export async function getRoutineExercises(routineId: string): Promise<RoutineExercise[]> {
  const rows = await all<RoutineExerciseRow>(
    `SELECT * FROM routine_exercises
      WHERE routine_id = ? AND deleted_at IS NULL
      ORDER BY order_index ASC`,
    routineId
  );
  return rows.map(toRoutineExercise);
}

export interface RoutineWithPreview extends Routine {
  exercise_names: string;
  exercise_count: number;
}

/** Routines grouped for the Train tab, with a compact preview line. */
export async function listRoutinesWithPreview(): Promise<RoutineWithPreview[]> {
  return all<RoutineWithPreview>(
    `SELECT r.*,
            COUNT(re.id) AS exercise_count,
            GROUP_CONCAT(e.name, ' · ') AS exercise_names
       FROM routines r
       LEFT JOIN routine_exercises re
         ON re.routine_id = r.id AND re.deleted_at IS NULL
       LEFT JOIN exercises e
         ON e.id = re.exercise_id AND e.deleted_at IS NULL
      WHERE r.deleted_at IS NULL AND r.archived_at IS NULL AND r.parent_routine_id IS NULL
      GROUP BY r.id
      ORDER BY r.folder_name, r.sort_order, r.title`
  );
}

export async function createRoutine(input: {
  title: string;
  folder_name?: string;
  notes?: string;
  user_id?: string | null;
}): Promise<Routine> {
  const id = uuid();
  const t = touch();
  const max = await first<{ m: number | null }>(
    `SELECT MAX(sort_order) AS m FROM routines WHERE folder_name = ? AND deleted_at IS NULL`,
    input.folder_name ?? 'My Routines'
  );
  await run(
    `INSERT INTO routines (id, user_id, title, notes, folder_name, sort_order, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    id,
    input.user_id ?? (await ownerId()),
    input.title.trim(),
    input.notes?.trim() ?? null,
    input.folder_name?.trim() || 'My Routines',
    (max?.m ?? -1) + 1,
    t
  );
  return (await getRoutine(id))!;
}

export async function addRoutineExercise(input: {
  routine_id: string;
  exercise_id: string;
  order_index: number;
  rest_seconds?: number;
  target_sets?: number;
  superset_id?: string | null;
  target_reps?: number[];
  target_weights?: (number | null)[];
  target_types?: SetType[];
}): Promise<string> {
  const id = uuid();
  const sets = input.target_sets ?? 3;
  await run(
    `INSERT INTO routine_exercises
       (id, routine_id, exercise_id, superset_id, order_index, rest_seconds, target_sets, target_reps, target_weights, target_types, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    id,
    input.routine_id,
    input.exercise_id,
    input.superset_id ?? null,
    input.order_index,
    input.rest_seconds ?? 120,
    sets,
    JSON.stringify(input.target_reps ?? Array(sets).fill(10)),
    JSON.stringify(input.target_weights ?? Array(sets).fill(null)),
    JSON.stringify(input.target_types ?? Array(sets).fill('normal')),
    touch()
  );
  return id;
}

const RE_JSON_COLS = new Set(['target_reps', 'target_weights', 'target_types']);
const UPDATABLE_RE_COLS = new Set([
  'target_sets',
  'rest_seconds',
  'order_index',
  'superset_id',
  ...RE_JSON_COLS,
]);

export async function updateRoutineExercise(
  id: string,
  patch: Partial<Pick<RoutineExercise, 'target_sets' | 'rest_seconds' | 'order_index' | 'superset_id' | 'target_reps' | 'target_weights' | 'target_types'>>
) {
  const t = touch();
  const cols = (Object.keys(patch) as (keyof typeof patch)[]).filter((c) =>
    // Skip undefined - JSON.stringify(undefined) yields undefined, which
    // can't bind as a SQL parameter.
    UPDATABLE_RE_COLS.has(c) && patch[c] !== undefined
  );
  if (cols.length === 0) return;
  await run(
    `UPDATE routine_exercises SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?, dirty = 1 WHERE id = ?`,
    ...cols.map((c) => (RE_JSON_COLS.has(c) ? JSON.stringify(patch[c]) : (patch[c] as number | string | null))),
    t,
    id
  );
}

export async function removeRoutineExercise(id: string) {
  await softDelete('routine_exercises', id);
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export interface RoutineFolder {
  id: string;
  name: string;
}

/** Named folders plus any folder_name already in use by routines. */
export async function listFolders(): Promise<string[]> {
  const named = await all<{ name: string }>(
    `SELECT name FROM routine_folders WHERE deleted_at IS NULL ORDER BY sort_order, name`
  );
  const used = await all<{ folder_name: string }>(
    `SELECT DISTINCT folder_name FROM routine_folder_assignments
      WHERE deleted_at IS NULL AND folder_name != 'My Routines'
     UNION
     SELECT DISTINCT folder_name FROM routines
      WHERE folder_name IS NOT NULL AND deleted_at IS NULL AND archived_at IS NULL`
  );
  const names = new Set([...named.map((r) => r.name), ...used.map((r) => r.folder_name)]);
  if (names.size === 0) names.add('My Routines');
  return [...names];
}

export async function createFolder(name: string, userId?: string | null): Promise<string> {
  const id = uuid();
  await run(
    `INSERT INTO routine_folders (id, user_id, name, updated_at, dirty)
     VALUES (?, ?, ?, ?, 1)`,
    id,
    userId ?? (await ownerId()),
    name.trim(),
    touch()
  );
  return id;
}

export async function moveRoutineToFolder(routineId: string, folderName: string) {
  // Legacy single-folder column (kept for backwards compat)
  await run(
    `UPDATE routines SET folder_name = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    folderName,
    touch(),
    routineId
  );
}

// -- Many-to-many folder assignments -----------------------------------------

export async function getRoutineFolders(routineId: string): Promise<string[]> {
  const rows = await all<{ folder_name: string }>(
    `SELECT folder_name FROM routine_folder_assignments
      WHERE routine_id = ? AND deleted_at IS NULL`,
    routineId
  );
  return rows.map((r) => r.folder_name);
}

export async function toggleRoutineFolder(routineId: string, folderName: string): Promise<void> {
  const existing = await first<{ id: string; deleted_at: string | null }>(
    `SELECT id, deleted_at FROM routine_folder_assignments
      WHERE routine_id = ? AND folder_name = ?`,
    routineId,
    folderName
  );
  const t = touch();
  if (existing && !existing.deleted_at) {
    // Unassign - soft delete
    await run(
      `UPDATE routine_folder_assignments SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      t,
      t,
      existing.id
    );
  } else if (existing && existing.deleted_at) {
    // Reassign - undelete
    await run(
      `UPDATE routine_folder_assignments SET deleted_at = NULL, updated_at = ?, dirty = 1 WHERE id = ?`,
      t,
      existing.id
    );
  } else {
    // New assignment
    await run(
      `INSERT INTO routine_folder_assignments (id, routine_id, folder_name, updated_at, dirty)
       VALUES (?, ?, ?, ?, 1)`,
      uuid(),
      routineId,
      folderName,
      t
    );
  }
}

export async function getFolderAssignments(): Promise<Record<string, string[]>> {
  const rows = await all<{ routine_id: string; folder_name: string }>(
    `SELECT routine_id, folder_name FROM routine_folder_assignments WHERE deleted_at IS NULL`
  );
  const map: Record<string, string[]> = {};
  for (const r of rows) {
    if (!map[r.routine_id]) map[r.routine_id] = [];
    map[r.routine_id].push(r.folder_name);
  }
  return map;
}

/**
 * Deletes a routine. Owned routines go to the Archive (archived_at, purged
 * after 28 days - restore from the Archive screen). Shared routines are the
 * owner's data: archived_at would push onto their copy, so that path keeps
 * the delete-for-everyone tombstone the confirm dialog warns about.
 */
export async function deleteRoutine(id: string) {
  const r = await first<{ is_shared: number }>(
    `SELECT is_shared FROM routines WHERE id = ?`,
    id
  );
  if (r?.is_shared === 1) return permanentlyDeleteRoutine(id);
  const t = touch();
  await run(
    `UPDATE routines SET archived_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    t,
    t,
    id
  );
}

const ROUTINE_ARCHIVE_DAYS = 28;

export interface ArchivedRoutine {
  id: string;
  title: string;
  folder_name: string;
  archived_at: string;
  exercise_count: number;
  days_left: number;
}

export async function listArchivedRoutines(): Promise<ArchivedRoutine[]> {
  await purgeExpiredRoutineArchives();
  const rows = await all<{
    id: string;
    title: string;
    folder_name: string;
    archived_at: string;
    exercise_count: number;
  }>(
    `SELECT r.id, r.title, r.folder_name, r.archived_at,
            (SELECT COUNT(*) FROM routine_exercises re
              WHERE re.routine_id = r.id AND re.deleted_at IS NULL) AS exercise_count
       FROM routines r
      WHERE r.archived_at IS NOT NULL AND r.deleted_at IS NULL
        AND r.parent_routine_id IS NULL
      ORDER BY r.archived_at DESC`
  );
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    days_left: Math.max(
      0,
      ROUTINE_ARCHIVE_DAYS -
        Math.floor((now - new Date(r.archived_at).getTime()) / (24 * 60 * 60 * 1000))
    ),
  }));
}

export async function restoreRoutine(id: string): Promise<void> {
  await run(
    `UPDATE routines SET archived_at = NULL, updated_at = ?, dirty = 1 WHERE id = ?`,
    touch(),
    id
  );
}

/** Tombstone cascade - the real delete behind the archive purge, permanent
 *  delete, and shared-routine removal. */
export async function permanentlyDeleteRoutine(id: string) {
  const db = await getDb();
  const t = touch();
  await db.withTransactionAsync(async () => {
    // Tabs hang off the routine - take them (and their exercises) too.
    const tabs = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM routines WHERE parent_routine_id = ? AND deleted_at IS NULL`,
      id
    );
    for (const tab of tabs) {
      await db.runAsync(
        `UPDATE routine_exercises SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE routine_id = ?`,
        t, t, tab.id
      );
      await db.runAsync(
        `UPDATE routines SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
        t, t, tab.id
      );
    }
    await db.runAsync(
      `UPDATE routine_exercises SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE routine_id = ?`,
      t, t, id
    );
    await db.runAsync(
      `UPDATE routine_folder_assignments SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE routine_id = ?`,
      t, t, id
    );
    await db.runAsync(
      `UPDATE routines SET deleted_at = ?, archived_at = NULL, updated_at = ?, dirty = 1 WHERE id = ?`,
      t, t, id
    );
  });
}

/** Permanently delete routines archived more than ROUTINE_ARCHIVE_DAYS ago. */
export async function purgeExpiredRoutineArchives(): Promise<void> {
  const cutoff = new Date(Date.now() - ROUTINE_ARCHIVE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const expired = await all<{ id: string }>(
    `SELECT id FROM routines WHERE archived_at IS NOT NULL AND archived_at < ? AND deleted_at IS NULL`,
    cutoff
  );
  for (const r of expired) await permanentlyDeleteRoutine(r.id);
}

// ---------------------------------------------------------------------------
// Tabs (sub-routines of a routine)
// ---------------------------------------------------------------------------

/** Tab routines under a parent, in order. */
export async function listRoutineTabs(parentId: string): Promise<Routine[]> {
  return all<Routine>(
    `SELECT * FROM routines
      WHERE parent_routine_id = ? AND deleted_at IS NULL
      ORDER BY sort_order, title`,
    parentId
  );
}

/**
 * Adds a tab to a routine. On a shared routine the tab belongs to the
 * routine's owner (RLS: collaborator inserts carry the owner's user_id), so
 * user_id follows the parent and is_shared mirrors it.
 */
export async function createRoutineTab(parentId: string, title: string): Promise<Routine> {
  const parent = await getRoutine(parentId);
  if (!parent) throw new Error('routine not found');
  const id = uuid();
  const t = touch();
  const max = await first<{ m: number | null }>(
    `SELECT MAX(sort_order) AS m FROM routines WHERE parent_routine_id = ? AND deleted_at IS NULL`,
    parentId
  );
  await run(
    `INSERT INTO routines
       (id, user_id, title, folder_name, sort_order, is_shared, parent_routine_id, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    id,
    parent.user_id,
    title.trim(),
    parent.folder_name,
    (max?.m ?? -1) + 1,
    parent.is_shared,
    parentId,
    t
  );
  return (await getRoutine(id))!;
}

export async function renameRoutine(id: string, title: string) {
  await run(
    `UPDATE routines SET title = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    title.trim(),
    touch(),
    id
  );
}

/** Deletes a tab and its exercises (soft). */
export async function deleteRoutineTab(id: string) {
  const db = await getDb();
  const t = touch();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE routine_exercises SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE routine_id = ?`,
      t, t, id
    );
    await db.runAsync(
      `UPDATE routines SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      t, t, id
    );
  });
}

export { softDelete };
