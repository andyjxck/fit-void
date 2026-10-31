/**
 * Pure helpers for the account token a store purchase is bound to
 * (appAccountToken on iOS, obfuscatedAccountId on Android).
 *
 * StoreKit hands appAccountToken back as an UPPERCASE UUID (Swift's
 * `uuidString`), while Supabase user ids are lowercase. Every comparison and
 * every stored owner goes through these so the two always match.
 */

/** Lowercased token, or null when the purchase isn't bound to an account. */
export function normalizeAccountToken(token: string | null | undefined): string | null {
  return token ? token.toLowerCase() : null;
}

/**
 * Whether a purchase token grants entitlement to `uid`. Tokenless purchases
 * (guests, pre-binding receipts) qualify for anyone on the device.
 */
export function tokenMatchesAccount(token: string | null | undefined, uid: string | null | undefined): boolean {
  const t = normalizeAccountToken(token);
  return !t || t === uid?.toLowerCase();
}
