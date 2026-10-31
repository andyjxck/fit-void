import * as Crypto from 'expo-crypto';

import { getDb, now } from '../client';

export const uuid = () => Crypto.randomUUID();

/** Columns common to every synced table; stamped on insert/update. */
export const touch = () => now();

export async function run(sql: string, ...params: unknown[]) {
  const db = await getDb();
  return db.runAsync(sql, ...(params as (string | number | null)[]));
}

export async function all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const db = await getDb();
  return db.getAllAsync<T>(sql, ...(params as (string | number | null)[]));
}

export async function first<T>(sql: string, ...params: unknown[]): Promise<T | null> {
  const db = await getDb();
  return db.getFirstAsync<T>(sql, ...(params as (string | number | null)[]));
}

/**
 * Signed-in account id, or null for guests. Repos call this so writes are
 * owned by the account immediately instead of relying on every caller to
 * pass user_id (claimOrphanRows remains the backstop for guest data).
 */
export async function ownerId(): Promise<string | null> {
  const r = await first<{ supabase_user_id: string | null }>(
    'SELECT supabase_user_id FROM local_profile WHERE id = 1'
  );
  return r?.supabase_user_id ?? null;
}

/** Soft delete: write a tombstone so the deletion can sync to the cloud. */
export async function softDelete(table: string, id: string) {
  await run(`UPDATE ${table} SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`, now(), now(), id);
}
