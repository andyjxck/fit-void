/**
 * Serializes health-platform importers. Their dedupes are check-then-insert
 * (per-day measurement sets, hasLiquidExternalId, hasCardioNear) - two
 * concurrent runs both read the same pre-import state and double-insert.
 * Focus effects fire importHealthData + importGoogleHealthData in parallel,
 * and autoImport can overlap a tab focus, so all entry points share one tail.
 */
let tail: Promise<unknown> = Promise.resolve();

/** A wedged call (stalled network, dead native callback) must not hold the
 *  queue forever - the lock releases after the cap even if fn never settles. */
const MAX_HOLD_MS = 90_000;

export function withImportLock<T>(fn: () => Promise<T>): Promise<T> {
  const p = tail.then(
    () =>
      Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('health import timed out')), MAX_HOLD_MS)
        ),
      ])
  );
  tail = p.catch(() => {});
  return p;
}
