import { getDb, now } from '../client';
import { all, ownerId, run, uuid } from './helpers';

export type DayStatusType = 'rest' | 'missed';

interface DayStatusRow {
  date: string;
  status: DayStatusType;
}

/** Get all day statuses for a given month (YYYY-MM prefix). */
export async function getDayStatuses(monthPrefix: string): Promise<Record<string, DayStatusType>> {
  const rows = await all<DayStatusRow>(
    `SELECT date, status FROM day_status
      WHERE date LIKE ? AND deleted_at IS NULL`,
    `${monthPrefix}%`
  );
  return Object.fromEntries(rows.map((r) => [r.date, r.status]));
}

export async function setDayStatus(date: string, status: DayStatusType, userId?: string | null) {
  const db = await getDb();
  const t = now();
  const uid = userId ?? (await ownerId());
  // Upsert scoped to the owner: if a row exists for this (user_id, date),
  // update it; else insert. COALESCE keeps guest (NULL) rows comparable.
  const existing = await db.getFirstAsync<{ id: string; deleted_at: string | null }>(
    `SELECT id, deleted_at FROM day_status
      WHERE date = ? AND COALESCE(user_id, '') = COALESCE(?, '')`,
    date,
    uid
  );
  if (existing) {
    // Resurrect a tombstone instead of inserting a second (user_id, date)
    // row - the unique key would reject it. Re-stamp user_id so a row
    // written under a previous owner is claimed by the current one.
    await run(
      `UPDATE day_status SET status = ?, user_id = ?, deleted_at = NULL, updated_at = ?, dirty = 1 WHERE id = ?`,
      status,
      uid,
      t,
      existing.id
    );
  } else {
    await run(
      `INSERT INTO day_status (id, user_id, date, status, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, 1)`,
      uuid(),
      uid,
      date,
      status,
      t
    );
  }
}

export async function clearDayStatus(date: string, userId?: string | null) {
  const uid = userId ?? (await ownerId());
  await run(
    `UPDATE day_status SET deleted_at = ?, updated_at = ?, dirty = 1
      WHERE date = ? AND COALESCE(user_id, '') = COALESCE(?, '') AND deleted_at IS NULL`,
    now(),
    now(),
    date,
    uid
  );
}
