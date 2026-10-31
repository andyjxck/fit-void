import { describe, expect, test } from 'bun:test';

import { normalizeAccountToken, tokenMatchesAccount } from '../accountToken';

const UID = '3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d';

describe('tokenMatchesAccount', () => {
  test('StoreKit uppercase token matches the lowercase Supabase id', () => {
    expect(tokenMatchesAccount(UID.toUpperCase(), UID)).toBe(true);
  });

  test('exact match still matches', () => {
    expect(tokenMatchesAccount(UID, UID)).toBe(true);
  });

  test('a different account does not match', () => {
    expect(tokenMatchesAccount('AAAAAAAA-9A4D-4E7B-8C21-5D6F7A8B9C0D', UID)).toBe(false);
  });

  test('tokenless purchases qualify for anyone, guests included', () => {
    expect(tokenMatchesAccount(null, UID)).toBe(true);
    expect(tokenMatchesAccount(undefined, null)).toBe(true);
    expect(tokenMatchesAccount('', UID)).toBe(true);
  });

  test('a bound purchase does not qualify for a guest', () => {
    expect(tokenMatchesAccount(UID.toUpperCase(), null)).toBe(false);
  });
});

describe('normalizeAccountToken', () => {
  test('lowercases so the stored owner equals the Supabase id', () => {
    expect(normalizeAccountToken(UID.toUpperCase())).toBe(UID);
  });

  test('empty → null', () => {
    expect(normalizeAccountToken(null)).toBeNull();
    expect(normalizeAccountToken('')).toBeNull();
  });
});
