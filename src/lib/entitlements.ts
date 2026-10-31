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

import { normalizeAccountToken, tokenMatchesAccount } from '@/lib/accountToken';
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
 *  obfuscatedAccountId on Android, null for guest/legacy receipts.
 *  Lowercased: StoreKit returns it uppercase, Supabase ids are lowercase. */
function purchaseToken(p: Purchase): string | null {
  return normalizeAccountToken(
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
  return tokenMatchesAccount(purchaseToken(p), uid);
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
 * How long to wait once the store sheet has returned without a usable
 * transaction before falling back to a receipt check. Play's requestPurchase
 * resolves while its sheet is still open, so Android gets longer.
 */
const PURCHASE_TIMEOUT_MS = Platform.OS === 'ios' ? 60_000 : 5 * 60_000;

let purchaseInFlight: Promise<PurchaseOutcome> | null = null;

function errorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
}

/**
 * Purchase a specific product by ID. One purchase at a time - a second call
 * while one is pending joins it instead of stacking listeners.
 */
export function purchase(productId: string): Promise<PurchaseOutcome> {
  if (purchaseInFlight) return purchaseInFlight;
  purchaseInFlight = runPurchase(productId).finally(() => {
    purchaseInFlight = null;
  });
  return purchaseInFlight;
}

/**
 * iOS requestPurchase returns the transaction directly - including the
 * existing one on "You're all set" for something already owned, which the
 * listener may never re-emit (expo-iap emits each transaction once). So the
 * returned purchase is handled first-class; the listener covers Android and
 * late deliveries; a timeout guarantees the promise always settles and the
 * listeners always come off.
 */
function runPurchase(productId: string): Promise<PurchaseOutcome> {
  const tier: Tier = productId === PRODUCT_IDS.proMax ? 'promax' : 'pro';
  return new Promise<PurchaseOutcome>((resolve) => {
    const uid = useSettings.getState().supabase_user_id;
    let settled = false;
    let handling = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (outcome: PurchaseOutcome) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      okSub.remove();
      errSub.remove();
      resolve(outcome);
    };
    // StoreKit rejected (e.g. re-buying an active subscription) or went quiet -
    // reconcile the receipt instead of dead-ending, so an entitled user gets
    // their tier.
    const fallBackToReceipt = () => {
      if (settled) return;
      void reconcileEntitlements()
        .then((t) => done(t === 'free' ? 'failed' : 'purchased'))
        .catch(() => done('failed'));
    };
    const handlePurchase = async (p: Purchase) => {
      if (settled || handling || p.productId !== productId) return;
      // Ask to Buy / pending payment: not paid yet.
      if (p.purchaseState === 'pending') return;
      handling = true;
      // Check the account BEFORE finishing: a transaction bound to a different
      // account is neither finished nor granted to the current user.
      if (!qualifies(p, uid)) {
        done('failed');
        return;
      }
      try {
        await finishTransaction({ purchase: p, isConsumable: false });
      } catch {
        // Apple already confirmed the purchase; an unfinished transaction is
        // re-delivered by StoreKit, so the grant below still stands.
      }
      grantTier(tier, purchaseToken(p) ?? uid);
      done('purchased');
    };
    const okSub = purchaseUpdatedListener((p: Purchase) => {
      void handlePurchase(p);
    });
    const errSub = purchaseErrorListener((e) => {
      if (handling) return;
      if (e.code === 'user-cancelled') {
        done('cancelled');
        return;
      }
      fallBackToReceipt();
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
        const result = isSub
          ? await requestPurchase({
              request: {
                apple,
                google: { ...googleBase, subscriptionOffers },
              },
              type: 'subs',
            })
          : await requestPurchase({
              request: {
                apple,
                google: googleBase,
              },
              type: 'in-app',
            });
        const returned = (Array.isArray(result) ? result : result ? [result] : []).find(
          (p) => p.productId === productId
        );
        if (returned) await handlePurchase(returned);
        // Sheet is done but nothing settled yet - never spin forever.
        if (!settled) timer = setTimeout(fallBackToReceipt, PURCHASE_TIMEOUT_MS);
      } catch (e) {
        if (handling) return;
        if (errorCode(e) === 'user-cancelled') done('cancelled');
        else fallBackToReceipt();
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
