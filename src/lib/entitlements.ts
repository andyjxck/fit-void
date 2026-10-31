import {
    endConnection,
    fetchProducts,
    finishTransaction,
    getAvailablePurchases,
    initConnection,
    purchaseErrorListener,
    purchaseUpdatedListener,
    requestPurchase,
    type Product,
    type ProductSubscription,
    type ProductSubscriptionAndroid,
    type Purchase
} from 'expo-iap';
import { Platform } from 'react-native';

import { useSettings } from '@/store/settings';

/**
 * Product IDs configured in App Store Connect.
 * Pro = monthly or yearly subscription, Pro Max = lifetime non-consumable.
 */
export const PRODUCT_IDS = {
  proMonthly: 'com.andysocial.voidgym.pro.monthly',
  proYearly: 'com.andysocial.voidgym.pro.yearly',
  proMax: 'com.andysocial.voidgym.promax',
};

const SUB_IDS = [PRODUCT_IDS.proMonthly, PRODUCT_IDS.proYearly];
const NON_CONSUMABLE_IDS = [PRODUCT_IDS.proMax];

export type Tier = 'free' | 'pro' | 'promax';

export interface ProductInfo {
  id: string;
  title: string;
  price: string;
  description: string;
  tier: 'pro' | 'promax';
  period?: 'monthly' | 'yearly' | 'lifetime';
}

let connected = false;

/** The app account a purchase was bound to - appAccountToken on iOS,
 *  obfuscatedAccountId on Android, null for guest/legacy receipts. */
function purchaseToken(p: Purchase): string | null {
  return (
    (p as { appAccountToken?: string | null }).appAccountToken ??
    (p as { obfuscatedAccountIdAndroid?: string | null }).obfuscatedAccountIdAndroid ??
    null
  );
}

/**
 * Whether a store purchase grants entitlement to the currently signed-in
 * account. Purchases made while signed in carry the account token = the
 * Supabase user id, so they only qualify for that account; tokenless
 * purchases (guests, pre-binding receipts) qualify for anyone on the device.
 */
function qualifies(p: Purchase, uid: string | null): boolean {
  const token = purchaseToken(p);
  return !token || token === uid;
}

/** Record a grant locally, binding it to the purchasing account when known. */
function grantTier(tier: Tier, owner: string | null) {
  useSettings.getState().set({ has_void_pro: true, void_tier: tier, void_pro_owner: owner });
}

/** Initialise the StoreKit connection. Safe to call multiple times. */
export async function initIap(): Promise<void> {
  if (connected) return;
  try {
    await initConnection();
    connected = true;
  } catch {
    // StoreKit not available (simulator without sandbox, or Expo Go)
  }
}

/** Tear down the StoreKit connection. */
export async function endIap(): Promise<void> {
  if (!connected) return;
  try {
    await endConnection();
    connected = false;
  } catch {
    // ignore
  }
}

/** Fetch all available products from the store. */
export async function getProducts(): Promise<{ subscriptions: ProductSubscription[]; oneTime: Product[] }> {
  await initIap();
  const [subs, oneTime] = await Promise.all([
    fetchProducts({ skus: SUB_IDS, type: 'subs' }),
    fetchProducts({ skus: NON_CONSUMABLE_IDS, type: 'in-app' }),
  ]);
  return {
    subscriptions: (subs as unknown as ProductSubscription[]) ?? [],
    oneTime: (oneTime as unknown as Product[]) ?? [],
  };
}

/**
 * Determine the current entitlement tier from available purchases.
 * Checks for Pro Max (lifetime) first, then active Pro subscription.
 */
export async function checkEntitlements(): Promise<Tier> {
  await initIap();
  try {
    const uid = useSettings.getState().supabase_user_id;
    const purchases = (await getAvailablePurchases()).filter((p) => qualifies(p, uid));
    // Check for Pro Max lifetime
    if (purchases.some((p) => p.productId === PRODUCT_IDS.proMax)) {
      return 'promax';
    }
    // Check for active Pro subscription
    if (purchases.some((p) => SUB_IDS.includes(p.productId))) {
      return 'pro';
    }
  } catch {
    // StoreKit not available
  }
  return 'free';
}

/**
 * Post-sign-in reconciliation: grants a tier when the device's store
 * purchases qualify for this account. Never revokes - a remote/manual
 * grant isn't store-derived and must survive a StoreKit lookup that finds
 * nothing (lapses are revoked by restore() only).
 */
export async function reconcileEntitlements(): Promise<Tier> {
  await initIap();
  try {
    const uid = useSettings.getState().supabase_user_id;
    const purchases = (await getAvailablePurchases()).filter((p) => qualifies(p, uid));
    const proMax = purchases.find((p) => p.productId === PRODUCT_IDS.proMax);
    const sub = purchases.find((p) => SUB_IDS.includes(p.productId));
    const best = proMax ?? sub;
    if (!best) return 'free';
    const tier: Tier = proMax ? 'promax' : 'pro';
    // Claims a tokenless receipt for this account; bound receipts keep their owner.
    grantTier(tier, purchaseToken(best) ?? uid);
    return tier;
  } catch {
    // StoreKit not available - leave local state alone.
    return 'free';
  }
}

/** Whether the user has any paid tier (Pro or Pro Max). */
export function useVoidPro(): boolean {
  const hasPro = useSettings((s) => s.has_void_pro);
  const tier = useSettings((s) => s.void_tier);
  const owner = useSettings((s) => s.void_pro_owner);
  const uid = useSettings((s) => s.supabase_user_id);
  const entitled = hasPro || tier === 'pro' || tier === 'promax';
  // Bound to another account → not this user's entitlement.
  return entitled && (owner == null || owner === uid);
}

export type PurchaseOutcome = 'purchased' | 'cancelled' | 'failed';

/**
 * Purchase a specific product by ID.
 * expo-iap v5 is event-based: requestPurchase only *dispatches*; the outcome
 * arrives through purchaseUpdatedListener / purchaseErrorListener.
 */
export function purchase(productId: string): Promise<PurchaseOutcome> {
  const tier: Tier = productId === PRODUCT_IDS.proMax ? 'promax' : 'pro';
  return new Promise<PurchaseOutcome>((resolve) => {
    const done = (outcome: PurchaseOutcome) => {
      okSub.remove();
      errSub.remove();
      resolve(outcome);
    };
    const uid = useSettings.getState().supabase_user_id;
    const okSub = purchaseUpdatedListener(async (p: Purchase) => {
      if (p.productId !== productId) return;
      try {
        await finishTransaction({ purchase: p, isConsumable: false });
        // StoreKit returned an existing transaction bound to a different
        // account - do not grant it to the current user.
        if (!qualifies(p, uid)) {
          done('failed');
          return;
        }
        grantTier(tier, purchaseToken(p) ?? uid);
        done('purchased');
      } catch {
        done('failed');
      }
    });
    const errSub = purchaseErrorListener((e) => {
      if (e.code === 'user-cancelled') {
        done('cancelled');
        return;
      }
      // StoreKit rejects re-buying an active subscription - reconcile the
      // receipt instead of dead-ending, so an entitled user gets their tier.
      void reconcileEntitlements().then((t) => done(t === 'free' ? 'failed' : 'purchased'));
    });
    void (async () => {
      try {
        await initIap();
        const isSub = SUB_IDS.includes(productId);
        // Play Billing requires an offerToken for subscriptions - pull the
        // product's base-plan offer token so the purchase isn't rejected.
        let subscriptionOffers;
        if (isSub && Platform.OS === 'android') {
          const subs = (await fetchProducts({ skus: [productId], type: 'subs' })) as
            | ProductSubscriptionAndroid[]
            | null;
          const token = subs?.[0]?.subscriptionOffers?.[0]?.offerTokenAndroid;
          if (token) subscriptionOffers = [{ sku: productId, offerToken: token }];
        }
        // Bind the transaction to the signed-in account so it can't be
        // restored onto a different account later.
        const apple = { sku: productId, ...(uid ? { appAccountToken: uid } : {}) };
        const googleBase = { skus: [productId], ...(uid ? { obfuscatedAccountId: uid } : {}) };
        if (isSub) {
          await requestPurchase({
            request: {
              apple,
              google: { ...googleBase, subscriptionOffers },
            },
            type: 'subs',
          });
        } else {
          await requestPurchase({
            request: {
              apple,
              google: googleBase,
            },
            type: 'in-app',
          });
        }
      } catch {
        done('failed');
      }
    })();
  });
}

/** Restore previous purchases. */
export async function restore(): Promise<Tier> {
  await initIap();
  try {
    const uid = useSettings.getState().supabase_user_id;
    const purchases = (await getAvailablePurchases()).filter((p) => qualifies(p, uid));
    const proMax = purchases.find((p) => p.productId === PRODUCT_IDS.proMax);
    if (proMax) {
      grantTier('promax', purchaseToken(proMax) ?? uid);
      return 'promax';
    }
    const sub = purchases.find((p) => SUB_IDS.includes(p.productId));
    if (sub) {
      grantTier('pro', purchaseToken(sub) ?? uid);
      return 'pro';
    }
    // Lookup succeeded and found nothing - revoke any stale local grant so a
    // lapsed subscription doesn't keep Pro features.
    useSettings.getState().set({ has_void_pro: false, void_tier: 'free', void_pro_owner: null });
    return 'free';
  } catch {
    // StoreKit not available - leave local state alone.
    return 'free';
  }
}
