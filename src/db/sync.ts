import type { SupabaseClient } from '@supabase/supabase-js';
import type * as SQLite from 'expo-sqlite';

import { getSupabase } from '@/supabase/client';

import { isPro } from '@/lib/tiers';
import { useSettings } from '@/store/settings';

import { getDb, now } from './client';
import { uuid } from './repo/helpers';
import { getProfile } from './repo/settings';
import { seedExercisesIfEmpty } from './seed';
import { seedExampleRoutines } from './seedRoutines';
import {
    CHILD_FKS,
    DIRECT_OWNED,
    PUSH_FILTER,
    SYNCED_TABLES,
    TABLE_COLUMNS,
    remotePayload,
    toLocal,
    type Row,
    type SyncedTable,
} from './syncMap';

/**
 * Offline-first merge engine.
 *
 * - Local SQLite is the source of truth; Supabase is the backup/sync replica.
 * - Every synced table carries updated_at + deleted_at + dirty.
 * - Push: dirty rows are upserted in batches (tombstones included - cloud keeps
 *   deleted_at rows so last-write-wins stays correct across devices).
 * - Pull: rows with updated_at > sync_meta.last_pull_at are applied unless a
 *   newer dirty local row exists (local wins; it pushes on the next cycle).
 * - Guests never touch the network. On first sign-in, claimGuestData() assigns
 *   ownership of every NULL-user_id row to the account and pushes it.
 */

const PUSH_BATCH = 200;
// PostgREST caps a response at ~1000 rows; pull pages until a short one.
const PULL_PAGE = 1000;

async function lastPullAt(table: SyncedTable): Promise<string | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ last_pull_at: string | null }>(
    'SELECT last_pull_at FROM sync_meta WHERE table_name = ?',
    table
  );
  return r?.last_pull_at ?? null;
}

async function setLastPullAt(table: SyncedTable, value: string) {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO sync_meta (table_name, last_pull_at) VALUES (?, ?) ON CONFLICT(table_name) DO UPDATE SET last_pull_at = excluded.last_pull_at',
    table,
    value
  );
}

// PostgREST PGRST204 when a pushed column is absent from the remote schema:
// "Could not find the '<col>' column of '<table>' in the schema cache"
const MISSING_COL_RE = /Could not find the '([^']+)' column of '[^']+' in the schema cache/;
const RLS_RE = /row-level security/i;
// Non-uuid ids (legacy/dev rows like 'manual-1') can never satisfy a remote
// uuid column - rekey them locally and retry instead of wedging the table.
const REKEYABLE_RE = /row-level security|invalid input syntax for type uuid/i;

/**
 * Gives a local row a fresh id and points every child FK at it. Used when a
 * pushed row collides with a cloud copy owned by a different account (RLS
 * rejects the upsert): the data is re-uploaded as new under the current
 * account, so both accounts end up owning a copy.
 */
async function rekeyRow(table: SyncedTable, id: string): Promise<Row> {
  const db = await getDb();
  const newId = uuid();
  const children = CHILD_FKS[table] ?? [];
  // defer_foreign_keys lets the parent id change before children follow.
  await db.execAsync('PRAGMA defer_foreign_keys = ON');
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE ${table} SET id = ? WHERE id = ?`, newId, id);
    for (const c of children) {
      await db.runAsync(
        `UPDATE ${c.table} SET ${c.fk} = ?, dirty = 1 WHERE ${c.fk} = ?`,
        newId,
        id
      );
    }
  });
  const row = await db.getFirstAsync<Row>(`SELECT * FROM ${table} WHERE id = ?`, newId);
  if (!row) throw new Error(`rekey ${table}: row vanished`);
  return row;
}

/** Upserts one row; on a rekeyable rejection (RLS conflict, bad uuid id)
 *  re-keys it locally and retries. */
async function pushRowWithRekey(sb: SupabaseClient, table: SyncedTable, row: Row): Promise<Row> {
  const { error } = await sb.from(table).upsert(remotePayload(table, row));
  if (!error) return row;
  if (!REKEYABLE_RE.test(error.message)) {
    throw new Error(`push ${table}: ${error.message}`);
  }
  console.warn('[sync] re-keying foreign-owned row', table, row.id);
  const rekeyed = await rekeyRow(table, row.id as string);
  const { error: e2 } = await sb.from(table).upsert(remotePayload(table, rekeyed));
  if (e2) throw new Error(`push ${table}: ${e2.message}`);
  return rekeyed;
}

/**
 * Upserts one batch. If the remote project is missing a column (schema drift
 * between local build and deployed migrations), PGRST204 would otherwise fail
 * the whole table. On a matching error, drop the column from TABLE_COLUMNS so
 * later batches skip it, strip it from the payloads, and retry once per batch.
 * An RLS rejection means a row id exists remotely under another account -
 * rekeyable failures (RLS, invalid uuid ids) re-key locally and retry. Any
 * residual batch error falls back to per-row pushes so one bad row can't
 * wedge the table.
 * Returns the effective rows (ids may differ after re-keying).
 */
async function pushBatchWithDriftRetry(sb: SupabaseClient, table: SyncedTable, batch: Row[], errors: string[]): Promise<Row[]> {
  const payload = () => batch.map((r) => remotePayload(table, r));
  let { error } = await sb.from(table).upsert(payload());
  if (!error) return batch;
  const col = MISSING_COL_RE.exec(error.message)?.[1];
  if (col && TABLE_COLUMNS[table].has(col)) {
    console.warn('[sync] remote missing column', table, col);
    // ReadonlySet is just a type-level view - the underlying Set is mutable.
    (TABLE_COLUMNS[table] as Set<string>).delete(col);
    ({ error } = await sb.from(table).upsert(payload()));
    if (!error) return batch;
  }
  // Any residual failure degrades to per-row pushes: one malformed row must
  // not wedge the whole table. Rows that fail individually are logged,
  // collected, and left dirty for next sync.
  const out: Row[] = [];
  for (const row of batch) {
    try {
      out.push(await pushRowWithRekey(sb, table, row));
    } catch (e) {
      console.warn('[sync] push row skipped', table, row.id, e);
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}

async function pushTable(sb: SupabaseClient, table: SyncedTable, userId: string, errors: string[]): Promise<number> {
  const db = await getDb();
  // Direct-owned tables restrict to the signed-in user; child tables carry no
  // user_id and RLS validates them through their parent row. PUSH_FILTER adds
  // per-table exclusions (seeded library rows, local-only templates).
  const filter = PUSH_FILTER[table] ?? '';
  // Collaborator edits to a shared routine push too: the row keeps the
  // owner's user_id, so the owner clause would skip it - is_shared flags it.
  const ownerClause =
    table === 'exercises'
      ? filter
      : table === 'routines'
        ? `AND (user_id = ? OR is_shared = 1) ${filter}`
        : DIRECT_OWNED.has(table)
          ? `AND user_id = ? ${filter}`
          : filter;
  const params: string[] = DIRECT_OWNED.has(table) || table === 'routines' ? [userId] : [];
  let rows = await db.getAllAsync<Row>(
    `SELECT * FROM ${table} WHERE dirty = 1 ${ownerClause}`,
    ...params
  );
  if (rows.length === 0) return 0;

  // Workouts started from a template/example routine reference a routine that
  // is local-only (is_template = 1, never pushed) - push routine_id as NULL
  // remotely so the FK doesn't reject the row. The local link is untouched.
  if (table === 'workouts') {
    const templates = new Set(
      (await db.getAllAsync<{ id: string }>(
        'SELECT id FROM routines WHERE is_template = 1'
      )).map((r) => r.id)
    );
    if (templates.size > 0) {
      rows = rows.map((r) =>
        templates.has(r.routine_id as string) ? { ...r, routine_id: null } : r
      );
    }
  }

  // Whitelist: only columns the remote table actually has. Local-only columns
  // (routines.is_template, workout_sets.session_id, …) would otherwise make
  // PostgREST reject the whole batch with PGRST204.
  for (let i = 0; i < rows.length; i += PUSH_BATCH) {
    const batch = rows.slice(i, i + PUSH_BATCH);
    const effective = await pushBatchWithDriftRetry(sb, table, batch, errors);
    // Clear dirty only where the row wasn't re-edited while the upsert flew.
    for (const r of effective) {
      await db.runAsync(
        `UPDATE ${table} SET dirty = 0 WHERE id = ? AND updated_at <= ?`,
        r.id as string,
        r.updated_at as string
      );
    }
  }
  return rows.length;
}

async function pullTable(sb: SupabaseClient, table: SyncedTable, userId: string): Promise<number> {
  const db = await getDb();
  const since = await lastPullAt(table);

  let applied = 0;
  let maxUpdated: string | null = null;
  // PostgREST caps a response at ~PULL_PAGE rows, so page by offset under a
  // fixed `updated_at > since` filter until a short page ends the set. Keeping
  // the filter fixed (rather than moving a cursor past the last row) means
  // rows sharing the same updated_at can't be skipped at a page boundary.
  for (let offset = 0; ; offset += PULL_PAGE) {
    let query = sb
      .from(table)
      .select('*')
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PULL_PAGE - 1);
    if (table === 'exercises') {
      query = query.or(`created_by.is.null,created_by.eq.${userId}`);
    } else if (table === 'routines') {
      // No user_id filter: RLS already returns own + shared-collab rows only.
    } else if (DIRECT_OWNED.has(table)) {
      query = query.eq('user_id', userId);
    }
    // Child tables: RLS already restricts to rows under owned parents.
    if (since) query = query.gt('updated_at', since);

    const { data, error } = await query;
    if (error) throw new Error(`pull ${table}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const raw of data) {
      try {
        if (await applyPulledRow(db, table, raw as Row, userId)) applied++;
      } catch (e) {
        // One bad row must not wedge the table: log it, skip it, and let the
        // watermark advance past it so the same row doesn't poison every sync.
        console.warn(`[sync] pull ${table}: skipped row`, (raw as Row).id, e);
      }
    }
    // Rows arrive in ascending updated_at order, so the last row of the final
    // page is the newest remote change seen.
    const last = (data[data.length - 1] as Row).updated_at;
    if (typeof last === 'string') maxUpdated = new Date(last).toISOString();
    if (data.length < PULL_PAGE) break;
  }

  // High-water mark = newest remote updated_at actually seen (server clock).
  // Never stamp the device clock - a fast local clock would skip remote rows -
  // and an empty first page leaves the previous watermark untouched.
  if (maxUpdated && (!since || maxUpdated > since)) {
    await setLastPullAt(table, maxUpdated);
  }
  return applied;
}

/**
 * Applies one pulled row to local SQLite. Returns true when the row landed.
 * Throws propagate to the caller, which logs and skips the row.
 */
export async function applyPulledRow(
  db: SQLite.SQLiteDatabase,
  table: SyncedTable,
  raw: Row,
  myUserId?: string
): Promise<boolean> {
  const remote = toLocal(table, raw);
  // Remote copies of bundled example routines (pushed by older builds, or
  // not yet cleaned up by migration 010) are local templates - never let
  // them land as user-owned routines.
  if (
    table === 'routines' &&
    typeof remote.folder_name === 'string' &&
    (remote.folder_name as string).startsWith('Examples ·')
  ) {
    return false;
  }
  await mergeNaturalKey(db, table, remote);

  const localRow = await db.getFirstAsync<{ updated_at: string; dirty: number }>(
    `SELECT updated_at, dirty FROM ${table} WHERE id = ?`,
    remote.id as string
  );
  // LWW: a dirty local row newer than the remote row keeps ownership; it
  // will overwrite the cloud on the next push.
  if (localRow && localRow.dirty === 1 && localRow.updated_at > (remote.updated_at as string)) {
    return false;
  }
  const allowed = TABLE_COLUMNS[table];
  const cols = Object.keys(remote).filter((k) => k !== 'id' && allowed.has(k));
  const assignments = cols.map((c) => `${c} = excluded.${c}`).join(', ');
  await db.runAsync(
    `INSERT INTO ${table} (id, ${cols.join(', ')})
     VALUES (?, ${cols.map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET ${assignments}`,
    remote.id as string,
    ...cols.map((c) => remote[c] as string | number | null)
  );
  // A routine whose user_id isn't mine arrived via collaborator RLS - flag it
  // so push/UI/claim paths know it's shared, not owned.
  if (table === 'routines' && myUserId) {
    await db.runAsync(
      `UPDATE routines SET is_shared = CASE WHEN user_id IS NOT NULL AND user_id != ? THEN 1 ELSE 0 END
       WHERE id = ?`,
      myUserId,
      remote.id as string
    );
  }
  return true;
}

/**
 * Pulls one shared routine tree (routine + exercises + folder assignments +
 * any custom exercises it references) by id, bypassing the incremental
 * watermark. Needed because an old routine can be shared long after its
 * updated_at fell behind last_pull_at.
 */
export async function pullRoutineTree(
  sb: SupabaseClient,
  routineId: string,
  myUserId: string
): Promise<boolean> {
  const { data: routine, error } = await sb
    .from('routines')
    .select('*')
    .eq('id', routineId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !routine) return false;

  const db = await getDb();
  const exs = await sb
    .from('routine_exercises')
    .select('*')
    .eq('routine_id', routineId)
    .is('deleted_at', null);
  // Pull any referenced exercises the collaborator's library doesn't have
  // (owner's custom exercises become readable via exercises_shared_routine).
  const exIds = (exs.data ?? []).map((e) => e.exercise_id as string);
  const present = exIds.length
    ? (
        await db.getAllAsync<{ id: string }>(
          `SELECT id FROM exercises WHERE id IN (${exIds.map(() => '?').join(',')})`,
          ...exIds
        )
      ).map((r) => r.id)
    : [];
  const presentSet = new Set(present);
  const toFetch = exIds.filter((e) => !presentSet.has(e));
  if (toFetch.length) {
    const fetched = await sb.from('exercises').select('*').in('id', toFetch);
    for (const ex of fetched.data ?? []) {
      await applyPulledRow(db, 'exercises', ex as Row, myUserId);
    }
  }

  await applyPulledRow(db, 'routines', routine as Row, myUserId);
  for (const e of exs.data ?? []) {
    try {
      await applyPulledRow(db, 'routine_exercises', e as Row, myUserId);
    } catch (err) {
      console.warn('[sync] shared routine_exercise skipped', (e as Row).id, err);
    }
  }
  // Tabs: child routines hang off the parent and carry their own exercise
  // lists. Pull each tab tree the same way.
  const tabs = await sb
    .from('routines')
    .select('*')
    .eq('parent_routine_id', routineId)
    .is('deleted_at', null);
  for (const tab of tabs.data ?? []) {
    await applyPulledRow(db, 'routines', tab as Row, myUserId);
    const tabExs = await sb
      .from('routine_exercises')
      .select('*')
      .eq('routine_id', tab.id as string)
      .is('deleted_at', null);
    const tabExIds = (tabExs.data ?? []).map((e) => e.exercise_id as string);
    const tabPresent = tabExIds.length
      ? (
          await db.getAllAsync<{ id: string }>(
            `SELECT id FROM exercises WHERE id IN (${tabExIds.map(() => '?').join(',')})`,
            ...tabExIds
          )
        ).map((r) => r.id)
      : [];
    const tabPresentSet = new Set(tabPresent);
    const tabToFetch = tabExIds.filter((e) => !tabPresentSet.has(e));
    if (tabToFetch.length) {
      const fetched = await sb.from('exercises').select('*').in('id', tabToFetch);
      for (const ex of fetched.data ?? []) {
        await applyPulledRow(db, 'exercises', ex as Row, myUserId);
      }
    }
    for (const e of tabExs.data ?? []) {
      try {
        await applyPulledRow(db, 'routine_exercises', e as Row, myUserId);
      } catch (err) {
        console.warn('[sync] shared tab routine_exercise skipped', (e as Row).id, err);
      }
    }
  }
  const assigns = await sb
    .from('routine_folder_assignments')
    .select('*')
    .eq('routine_id', routineId)
    .is('deleted_at', null);
  for (const a of assigns.data ?? []) {
    try {
      await applyPulledRow(db, 'routine_folder_assignments', a as Row, myUserId);
    } catch (err) {
      console.warn('[sync] shared routine_folder_assignment skipped', (a as Row).id, err);
    }
  }
  return true;
}

/**
 * Reconciles local shared-routine copies with remote membership. Missing
 * trees get pulled; routines I was removed from (or that were deleted) get
 * hard-deleted locally - never tombstoned, or the push would delete the
 * owner's cloud copy.
 */
async function syncSharedRoutines(sb: SupabaseClient, userId: string) {
  const db = await getDb();
  const { data, error } = await sb
    .from('routine_collaborators')
    .select('routine_id')
    .eq('user_id', userId)
    .eq('status', 'accepted');
  if (error) throw new Error(`collab refresh: ${error.message}`);
  const sharedIds = new Set((data ?? []).map((m) => m.routine_id as string));

  // Membership rows exist only on parent routines; tabs follow their parent.
  const localShared = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM routines WHERE is_shared = 1 AND parent_routine_id IS NULL'
  );
  for (const row of localShared) {
    if (!sharedIds.has(row.id)) {
      const tabs = await db.getAllAsync<{ id: string }>(
        'SELECT id FROM routines WHERE parent_routine_id = ?',
        row.id
      );
      for (const tab of tabs) {
        await db.runAsync('DELETE FROM routine_exercises WHERE routine_id = ?', tab.id);
        await db.runAsync('DELETE FROM routines WHERE id = ?', tab.id);
      }
      await db.runAsync('DELETE FROM routine_exercises WHERE routine_id = ?', row.id);
      await db.runAsync('DELETE FROM routine_folder_assignments WHERE routine_id = ?', row.id);
      await db.runAsync('DELETE FROM routines WHERE id = ?', row.id);
    }
  }

  for (const id of sharedIds) {
    const local = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM routines WHERE id = ?',
      id
    );
    if (!local) await pullRoutineTree(sb, id, userId);
  }
}

/**
 * Natural-key merge. A local row can already hold the remote row's unique key
 * under a different id (created offline, or a tombstone whose key was re-used
 * on another device). Remote unique indexes are partial (WHERE deleted_at IS
 * NULL) but several local constraints are not, so the clash must be resolved
 * before the upsert runs or it throws a UNIQUE violation.
 *
 * Resolution: adopt the remote id onto the best local row (live rows first,
 * then dirty, then newest) so the upsert below becomes a plain update and the
 * LWW check still sees the local row. If the remote id is already held by a
 * live row, the local duplicate wins the id only when it is dirty and newer
 * than the remote row; otherwise it is dropped - the remote row is
 * authoritative for this natural key. None of these tables' ids are
 * referenced by FK children, so retargeting is safe.
 */
async function mergeNaturalKey(db: SQLite.SQLiteDatabase, table: SyncedTable, remote: Row) {
  let where: string;
  let params: (string | null)[];
  switch (table) {
    case 'food_items':
      where = `barcode = ? AND COALESCE(user_id, '') = COALESCE(?, '')`;
      params = [remote.barcode as string, remote.user_id as string | null];
      break;
    case 'exercise_favourites':
      where = `exercise_id = ? AND COALESCE(user_id, '') = COALESCE(?, '')`;
      params = [remote.exercise_id as string, remote.user_id as string | null];
      break;
    case 'day_status':
      // Local UNIQUE(user_id, date) is non-partial - tombstones collide too.
      where = `date = ? AND COALESCE(user_id, '') = COALESCE(?, '')`;
      params = [remote.date as string, remote.user_id as string | null];
      break;
    case 'routine_folder_assignments':
      // Local UNIQUE(routine_id, folder_name) is non-partial.
      where = `routine_id = ? AND folder_name = ?`;
      params = [remote.routine_id as string, remote.folder_name as string];
      break;
    case 'cardio_sessions':
    case 'nutrition_entries':
    case 'liquid_entries':
      // Local external_id unique indexes are user-agnostic; NULLs (manual
      // entries) never collide.
      if (remote.external_id == null) return;
      where = `external_id = ?`;
      params = [remote.external_id as string];
      break;
    default:
      return;
  }

  const clashes = await db.getAllAsync<{
    id: string;
    deleted_at: string | null;
    dirty: number;
    updated_at: string;
  }>(
    `SELECT id, deleted_at, dirty, updated_at FROM ${table}
      WHERE ${where} AND id != ?
      ORDER BY (deleted_at IS NULL) DESC, dirty DESC, updated_at DESC`,
    ...params,
    remote.id as string
  );
  if (clashes.length === 0) return;
  const keep = clashes[0];

  const occupant = await db.getFirstAsync<{ deleted_at: string | null }>(
    `SELECT deleted_at FROM ${table} WHERE id = ?`,
    remote.id as string
  );
  const localWins = keep.dirty === 1 && keep.updated_at > (remote.updated_at as string);
  if (!occupant || occupant.deleted_at != null || localWins) {
    // The remote id is free, held by a stale tombstone, or the local row
    // outranks the remote one - clear the id and move the local row onto it.
    if (occupant) {
      await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, remote.id as string);
    }
    await db.runAsync(
      `UPDATE OR IGNORE ${table} SET id = ? WHERE id = ?`,
      remote.id as string,
      keep.id
    );
  }
  // Anything still holding the key under another id is a stale duplicate
  // (the remote id was already taken, or these are extra tombstone copies).
  // Drop them so the upsert cannot hit the unique constraint.
  await db.runAsync(
    `DELETE FROM ${table} WHERE ${where} AND id != ?`,
    ...params,
    remote.id as string
  );
}

let inFlight: Promise<SyncResult> | null = null;

export interface SyncResult {
  status: 'guest' | 'ok' | 'error';
  pushed: number;
  pulled: number;
  error?: string;
  errors?: string[];
}

/** Full bidirectional sync. No-ops for guests; serialized against itself. */
export function syncNow(): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = doSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Stamps the signed-in user onto every ownerless row so guest-created data -
 * and anything written while the session was missing - is pushed by the next
 * cycle. Templates and the seeded library are never claimed. Runs inside
 * every sync, not just at first sign-in, so pre-fix orphans self-heal.
 */
async function claimOrphanRows(userId: string): Promise<void> {
  const db = await getDb();
  const t = now();
  await db.withTransactionAsync(async () => {
    // Children first: mark rows dirty when their parent is about to be
    // (re)claimed - i.e. ownerless or stamped with a different account than
    // the signed-in one. Single-owner device: local rows belong to whoever
    // is signed in now.
    // Shared routines keep the owner's user_id - children only get dirty
    // when a genuinely unowned/other-account parent is claimed.
    await db.runAsync(
      `UPDATE routine_exercises SET dirty = 1
        WHERE routine_id IN (SELECT id FROM routines WHERE (user_id IS NULL OR user_id != ?) AND is_template = 0 AND is_shared = 0)`,
      userId
    );
    await db.runAsync(
      `UPDATE routine_folder_assignments SET dirty = 1
        WHERE routine_id IN (SELECT id FROM routines WHERE (user_id IS NULL OR user_id != ?) AND is_template = 0 AND is_shared = 0)`,
      userId
    );
    await db.runAsync(
      `UPDATE workout_sets SET dirty = 1
        WHERE workout_id IN (SELECT id FROM workouts WHERE user_id IS NULL OR user_id != ?)`,
      userId
    );
    await db.runAsync(
      `UPDATE meal_ingredients SET dirty = 1
        WHERE meal_id IN (SELECT id FROM meals WHERE user_id IS NULL OR user_id != ?)`,
      userId
    );
    await db.runAsync(
      `UPDATE meal_plan_items SET dirty = 1
        WHERE plan_id IN (SELECT id FROM meal_plans WHERE user_id IS NULL OR user_id != ?)`,
      userId
    );
    for (const table of SYNCED_TABLES) {
      if (table === 'exercises') {
        await db.runAsync(
          `UPDATE OR IGNORE exercises SET created_by = ?, dirty = 1, updated_at = ?
            WHERE (created_by IS NULL OR created_by != ?) AND is_custom = 1`,
          userId,
          t,
          userId
        );
      } else if (table === 'routines') {
        // Shared rows keep the owner's id - claiming them would rewrite
        // user_id to me and the shared-RLE WITH CHECK would reject the push.
        await db.runAsync(
          `UPDATE routines SET user_id = ?, dirty = 1, updated_at = ?
            WHERE (user_id IS NULL OR user_id != ?) AND is_template = 0 AND is_shared = 0`,
          userId,
          t,
          userId
        );
      } else if (table === 'train_widgets') {
        await db.runAsync(
          `UPDATE OR IGNORE train_widgets SET user_id = ?, dirty = 1, updated_at = ?
            WHERE (user_id IS NULL OR user_id != ?) AND id != '__meta__'`,
          userId,
          t,
          userId
        );
      } else if (DIRECT_OWNED.has(table)) {
        // OR IGNORE: a row colliding with an existing natural key under this
        // account (food barcode, exercise favourite, folder name) keeps its
        // old owner rather than crashing the claim; the cloud copy pulls down
        // anyway.
        await db.runAsync(
          `UPDATE OR IGNORE ${table} SET user_id = ?, dirty = 1, updated_at = ?
            WHERE user_id IS NULL OR user_id != ?`,
          userId,
          t,
          userId
        );
      }
    }
    // Drop foreign/ownerless dupes that collide with an already-owned
    // natural key under this account.
    await db.runAsync(
      `DELETE FROM food_items WHERE (user_id IS NULL OR user_id != ?) AND barcode IN
        (SELECT barcode FROM food_items WHERE user_id = ?)`,
      userId,
      userId
    );
    await db.runAsync(
      `DELETE FROM exercise_favourites WHERE (user_id IS NULL OR user_id != ?) AND exercise_id IN
        (SELECT exercise_id FROM exercise_favourites WHERE user_id = ?)`,
      userId,
      userId
    );
  });
}

/** Record the outcome on local_profile so the UI can surface failures. */
async function writeSyncStatus(error: string | null) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE local_profile SET last_sync_at = ?, last_sync_error = ? WHERE id = 1`,
    now(),
    error
  );
}

/**
 * Free tier pushes only shared-collab rows: their edits to a Pro-hosted
 * routine still sync to the group, but their own logbook never backs up.
 * Uses the same batch+per-row machinery as pushTable.
 */
async function pushSharedRoutineRows(sb: SupabaseClient, errors: string[]): Promise<number> {
  const db = await getDb();
  let pushed = 0;
  const sharedIds = `SELECT id FROM routines WHERE is_shared = 1`;
  const scopes: { table: SyncedTable; where: string }[] = [
    { table: 'routines', where: `dirty = 1 AND is_shared = 1` },
    { table: 'routine_exercises', where: `dirty = 1 AND routine_id IN (${sharedIds})` },
    { table: 'routine_folder_assignments', where: `dirty = 1 AND routine_id IN (${sharedIds})` },
  ];
  for (const { table, where } of scopes) {
    const rows = await db.getAllAsync<Row>(`SELECT * FROM ${table} WHERE ${where}`);
    pushed += rows.length;
    for (let i = 0; i < rows.length; i += PUSH_BATCH) {
      const effective = await pushBatchWithDriftRetry(sb, table, rows.slice(i, i + PUSH_BATCH), errors);
      for (const r of effective) {
        await db.runAsync(
          `UPDATE ${table} SET dirty = 0 WHERE id = ? AND updated_at <= ?`,
          r.id as string,
          r.updated_at as string
        );
      }
    }
  }
  return pushed;
}

async function doSync(): Promise<SyncResult> {
  const sb = getSupabase();
  if (!sb) return { status: 'guest', pushed: 0, pulled: 0 };
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session?.user) return { status: 'guest', pushed: 0, pulled: 0 };

  const userId = session.user.id;
  // Self-heal: if the persisted account id is missing or stale, adopt the
  // live session's so ownerId() stamps new rows correctly.
  if (useSettings.getState().supabase_user_id !== userId) {
    useSettings.getState().set({ supabase_user_id: userId });
  }
  let pushed = 0;
  let pulled = 0;
  const errors: string[] = [];
  const free = !isPro();
  try {
    if (!free) await claimOrphanRows(userId);
    // Per-table isolation: one bad table must not starve the rest - that is
    // exactly how the remote DB ended up with routines and nothing else.
    // Free tier skips the loops entirely: no cloud backup of their own data.
    if (!free) {
      for (const table of SYNCED_TABLES) {
        try {
          pushed += await pushTable(sb, table, userId, errors);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      for (const table of SYNCED_TABLES) {
        try {
          pulled += await pullTable(sb, table, userId);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
    } else {
      // Collaborators still sync their edits to the shared routine.
      try {
        pushed += await pushSharedRoutineRows(sb, errors);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    try {
      await syncProfileRow(sb, userId);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
    try {
      await syncSharedRoutines(sb, userId);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
    // Reconcile the denormalised local flag with the synced join table.
    const db = await getDb();
    await db.runAsync(
      `UPDATE exercises SET is_favourite = EXISTS(
         SELECT 1 FROM exercise_favourites f
          WHERE f.exercise_id = exercises.id AND f.deleted_at IS NULL
            AND (f.user_id = ? OR f.user_id IS NULL))`,
      userId
    );
    const error = errors.length ? errors.join('; ') : null;
    await writeSyncStatus(error);
    useSettings.getState().hydrate();
    return {
      status: error ? 'error' : 'ok',
      pushed,
      pulled,
      error: error ?? undefined,
      errors,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    await writeSyncStatus(msg).catch(() => {});
    useSettings.getState().hydrate();
    return { status: 'error', pushed, pulled, error: errors.join('; '), errors };
  }
}

/**
 * Clears every user-owned local table and the pull cursors, keeping
 * local_profile/settings and the seeded exercise library's local rows.
 * Called when the signed-in account changes: one account's data on-device
 * at a time, then a fresh sync pulls the new account's cloud copy down.
 * Requires a live session for the NEW account - anything never synced under
 * the old account is gone, so only run this after the user has signed in.
 */
export async function wipeLocalUserData(): Promise<void> {
  const db = await getDb();
  // defer_foreign_keys: child rows get deleted in the same transaction, but
  // RESTRICT constraints (e.g. exercises <- workout_sets) would otherwise
  // reject the parent deletes before the children are gone.
  await db.execAsync('PRAGMA defer_foreign_keys = ON');
  await db.withTransactionAsync(async () => {
    for (const table of SYNCED_TABLES) {
      // Bundled content survives the wipe: the exercise library and the
      // 'Examples ·' template routines (+ their children) are device-level
      // data, not account data.
      if (table === 'exercises') {
        await db.runAsync(`DELETE FROM exercises WHERE is_custom = 1 OR created_by IS NOT NULL`);
      } else if (table === 'routines') {
        await db.runAsync(`DELETE FROM routines WHERE is_template = 0`);
      } else if (table === 'routine_exercises' || table === 'routine_folder_assignments') {
        await db.runAsync(
          `DELETE FROM ${table} WHERE routine_id IN (SELECT id FROM routines WHERE is_template = 0)`
        );
      } else if (table === 'food_items') {
        // NULL user_id = shared catalog cache; only user-created items go.
        await db.runAsync(`DELETE FROM food_items WHERE user_id IS NOT NULL`);
      } else {
        await db.runAsync(`DELETE FROM ${table}`);
      }
    }
    await db.runAsync('DELETE FROM sync_meta');
  });
  // Entitlement is account-scoped, not device-scoped: reset it on account
  // change and let syncProfileRow pull the NEW account's tier back down.
  // Without this, a Pro account's local flag merges `local || remote` and
  // pushes Pro onto whatever free account signs in next. The direct UPDATE
  // lands synchronously; the store set() persists asynchronously - both are
  // needed so no racing sync can read the stale flag.
  await db.runAsync(
    `UPDATE local_profile SET has_void_pro = 0, void_tier = 'free', void_pro_owner = NULL WHERE id = 1`
  );
  useSettings.getState().set({ has_void_pro: false, void_tier: 'free', void_pro_owner: null });
  // Safety net: if anything bundled was already gone, bring it back.
  await seedExercisesIfEmpty(db);
  await seedExampleRoutines(db);
}

/**
 * Signs out and returns the device to a fresh guest state: pending local
 * changes are pushed while the session is still alive, then every user-owned
 * table is wiped. The data stays in the cloud and pulls back on next sign-in.
 * Returns 'sync-failed' when the push couldn't complete - callers should warn
 * and let the user decide whether to sign out anyway.
 */
export async function signOutWipe(): Promise<'ok' | 'sync-failed'> {
  const res = await syncNow();
  if (res.status === 'error') return 'sync-failed';
  await wipeLocalUserData();
  useSettings.getState().set({ supabase_user_id: null });
  const sb = getSupabase();
  await sb?.auth.signOut();
  return 'ok';
}

/** Mirror local_profile into the profiles table and pull has_void_pro back. */
async function syncProfileRow(sb: SupabaseClient, userId: string) {
  const profile = await getProfile();
  const { data: remote } = await sb
    .from('profiles')
    .select('weight_unit, default_bar_weight, has_void_pro, void_tier, display_name, updated_at')
    .eq('id', userId)
    .maybeSingle();
  // Re-read the entitlement AFTER the network round-trip, from the in-memory
  // store (updated synchronously by grantTier): a purchase / reconcile that
  // landed while this request was in flight must not be overwritten with the
  // tier read before it. The store is hydrated before any sync starts.
  const s = useSettings.getState();
  const local = {
    ...profile,
    has_void_pro: s.has_void_pro,
    void_tier: s.void_tier,
    void_pro_owner: s.void_pro_owner,
  };

  // A local grant only counts toward THIS account if it isn't bound to a
  // different one: void_pro_owner === null is an unclaimed device purchase
  // (first signed-in account claims it); a foreign owner means another
  // account bought it on this device and it must not leak.
  const localPro =
    local.has_void_pro && (local.void_pro_owner == null || local.void_pro_owner === userId);

  if (!remote) {
    await sb.from('profiles').insert({
      id: userId,
      display_name: local.display_name,
      weight_unit: local.weight_unit,
      default_bar_weight: local.default_bar_weight,
      has_void_pro: localPro,
      void_tier: localPro ? local.void_tier : 'free',
    });
    if (localPro) useSettings.getState().set({ void_pro_owner: userId });
    return;
  }
  // Entitlement merges from both sides (device purchase or a manual cloud
  // grant), so a stale false on either side can't wipe the other. The merged
  // value goes back up - collab Pro checks and the MAX badge read it remotely.
  const remoteTier = (remote.void_tier as 'free' | 'pro' | 'promax' | null) ?? 'free';
  const merged: 'free' | 'pro' | 'promax' =
    localPro || Boolean(remote.has_void_pro)
      ? local.void_tier === 'promax' || remoteTier === 'promax'
        ? 'promax'
        : 'pro'
      : 'free';
  // Write locally first, in the same tick as the re-read above, so no grant
  // can slip in between the read and the write. Then push the merged value.
  useSettings
    .getState()
    .set({
      has_void_pro: merged !== 'free',
      void_tier: merged,
      // Once merged, the entitlement is this account's: bound purchases stay
      // bound, an unclaimed device purchase claims, remote-side grants adopt.
      void_pro_owner: merged === 'free' ? null : userId,
    });
  await sb
    .from('profiles')
    .update({ has_void_pro: merged !== 'free', void_tier: merged })
    .eq('id', userId);
}

/**
 * Assigns all guest-owned rows (user_id IS NULL) to the account and pushes.
 * Called once on first sign-in / account link.
 */
export async function claimGuestData(userId: string): Promise<void> {
  useSettings.getState().set({ supabase_user_id: userId }); // persists + updates store
  await syncNow();
}
