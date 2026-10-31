import type { Product, ProductSubscription } from 'expo-iap';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Lock, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NotifyHost } from '@/components/ui/Notify';
import {
    getProducts,
    PRODUCT_IDS,
    purchase,
    restore,
    type ProductInfo,
} from '@/lib/entitlements';
import { goBack } from '@/lib/nav';
import { FREE_LIMITS, PRO_LIMITS } from '@/lib/tiers';
import { notify } from '@/store/notify';
import { Void } from '@/theme/tokens';

/**
 * Comparison-first paywall: the free caps are the pitch. Every row shows what
 * the free tier stops at (left, muted/struck) against what Pro unlocks
 * (right, lime). Numbers come straight from FREE_LIMITS - single source.
 */

type Row = { label: string; free: string; pro: string; freeLocked?: boolean };

const ROWS: Row[] = [
  { label: 'Routines', free: `${FREE_LIMITS.routines}`, pro: '∞' },
  { label: 'Folders', free: `${FREE_LIMITS.folders}`, pro: `${PRO_LIMITS.folders}` },
  { label: 'Tabs per routine', free: `${FREE_LIMITS.routineTabs}`, pro: `${PRO_LIMITS.routineTabs}` },
  { label: 'Custom exercises', free: `${FREE_LIMITS.customExercises}`, pro: '∞' },
  { label: 'Meal plans', free: `${FREE_LIMITS.mealPlans}`, pro: `${PRO_LIMITS.mealPlans}` },
  { label: 'Health imports', free: `${FREE_LIMITS.weeklyHealthImports} / wk`, pro: '∞' },
  { label: 'Insights', free: '1', pro: 'all' },
  { label: 'Collab routines', free: 'join only', pro: 'host + join' },
  { label: 'Cloud sync', free: '✕', pro: '✓', freeLocked: true },
  { label: 'Widget move + resize', free: '✕', pro: '✓', freeLocked: true },
];

function toProductInfo(subs: ProductSubscription[], oneTime: Product[]): ProductInfo[] {
  const out: ProductInfo[] = [];
  for (const s of subs) {
    const id = s.id;
    let period: 'monthly' | 'yearly' | undefined;
    if (id === PRODUCT_IDS.proMonthly) period = 'monthly';
    else if (id === PRODUCT_IDS.proYearly) period = 'yearly';
    out.push({
      id,
      title: s.title ?? s.displayName ?? '',
      price: s.displayPrice ?? '',
      description: s.description ?? '',
      tier: 'pro',
      period,
    });
  }
  for (const p of oneTime) {
    out.push({
      id: p.id,
      title: p.title ?? p.displayName ?? '',
      price: p.displayPrice ?? '',
      description: p.description ?? '',
      tier: 'promax',
      period: 'lifetime',
    });
  }
  // Sort: monthly, yearly, lifetime
  const order: Record<string, number> = { monthly: 0, yearly: 1, lifetime: 2 };
  out.sort((a, b) => (order[a.period ?? ''] ?? 99) - (order[b.period ?? ''] ?? 99));
  return out;
}

const PLAN_LABEL: Record<string, string> = {
  monthly: 'MO',
  yearly: 'YR',
  lifetime: 'MAX',
};

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Gates pass the reason: `title` is the cap/limit hit, `body` the pitch line.
  const { title: reasonTitle, body: reasonBody } = useLocalSearchParams<{ title?: string; body?: string }>();
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { subscriptions, oneTime } = await getProducts();
      const info = toProductInfo(subscriptions, oneTime);
      setProducts(info);
      if (info.length > 0) {
        // Default to yearly (best value) once - a functional update keeps
        // `selected` out of the deps so tapping a tier can't re-run load.
        setSelected((cur) => cur || (info.find((p) => p.period === 'yearly') ?? info[0]).id);
      }
    } catch {
      // StoreKit not available (simulator / Expo Go)
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const buy = async () => {
    if (!selected) return;
    setBusy(true);
    const outcome = await purchase(selected);
    setBusy(false);
    if (outcome === 'purchased') {
      router.back();
    } else if (outcome === 'failed') {
      notify('Purchase failed', { body: 'The purchase could not be completed. Try again or restore an existing purchase.', tone: 'error' });
    }
    // 'cancelled' - user bailed out of the sheet; no toast needed.
  };

  const doRestore = async () => {
    setBusy(true);
    const tier = await restore();
    setBusy(false);
    if (tier !== 'free') {
      router.back();
    } else {
      notify('Nothing to restore', { body: 'No previous purchases found for this Apple ID.', tone: 'info' });
    }
  };

  const selectedProduct = products.find((p) => p.id === selected);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      {/* Watermark */}
      <Text style={styles.watermark} numberOfLines={1} pointerEvents="none">PRO</Text>

      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>UPGRADE</Text>
        </View>
        <Pressable onPress={() => goBack()} hitSlop={8} style={styles.closeBtn}>
          <X color={Void.textSecondary} size={18} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 150 }}>
        <Text style={styles.headline}>
          THE CAPS ARE{'\n'}THE PITCH.
        </Text>
        <Text style={styles.headlineSub}>Free stays free. Pro removes every limit below.</Text>

        {/* Why the paywall opened - cap hit, locked control, quota, etc. */}
        {reasonTitle ? (
          <View style={styles.reasonCard}>
            <Text style={styles.reasonTitle}>{reasonTitle}</Text>
            {reasonBody ? <Text style={styles.reasonBody}>{reasonBody}</Text> : null}
          </View>
        ) : null}

        {/* Comparison table */}
        <View style={styles.table}>
          {/* Header row */}
          <View style={[styles.row, styles.rowHeader]}>
            <Text style={[styles.cell, styles.cellLabel, styles.cellHeadText]} numberOfLines={1} />
            <Text style={[styles.cell, styles.cellFree, styles.cellHeadText]}>FREE</Text>
            <Text style={[styles.cell, styles.cellPro, styles.cellHeadTextPro]}>VOID PRO</Text>
          </View>
          {ROWS.map((r, i) => (
            <View key={r.label} style={[styles.row, i === ROWS.length - 1 && { borderBottomWidth: 0 }]}>
              <Text style={[styles.cell, styles.cellLabel]} numberOfLines={1}>{r.label}</Text>
              <View style={[styles.cell, styles.cellFree, styles.freeValWrap]}>
                {r.freeLocked
                  ? <Lock color={Void.textTertiary} size={11} />
                  : <Text style={styles.freeVal}>{r.free}</Text>}
              </View>
              <Text style={[styles.cell, styles.cellPro, styles.proVal]} numberOfLines={1}>{r.pro}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.maxNote}>PRO MAX - no caps, forever. Plus the MAX badge.</Text>

        {/* Plan chips */}
        <View style={styles.plans}>
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={Void.accent} />
            </View>
          ) : products.length === 0 ? (
            <View style={styles.loadingWrap}>
              <Text style={styles.loadingText}>StoreKit unavailable.{'\n'}Run on a device with a sandbox account.</Text>
            </View>
          ) : (
            products.map((p) => {
              const isSelected = selected === p.id;
              const isMax = p.tier === 'promax';
              return (
                <Pressable
                  key={p.id}
                  style={[styles.chip, isSelected && styles.chipOn]}
                  onPress={() => setSelected(p.id)}>
                  {p.period === 'yearly' && (
                    <View style={styles.chipTag}>
                      <Text style={styles.chipTagText}>BEST</Text>
                    </View>
                  )}
                  <Text style={[styles.chipLabel, isSelected && styles.chipLabelOn]}>
                    {PLAN_LABEL[p.period ?? ''] ?? 'PRO'}
                  </Text>
                  <Text style={[styles.chipPrice, isSelected && styles.chipPriceOn]}>
                    {p.price || '-'}
                  </Text>
                  <Text style={styles.chipPeriod}>
                    {p.period === 'monthly' ? '/mo' : p.period === 'yearly' ? '/yr' : 'once'}
                  </Text>
                  {isMax ? (
                    <Text style={styles.chipMax}>lifetime</Text>
                  ) : (
                    <Text style={styles.chipTrial}>3 days free</Text>
                  )}
                </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.footerRow}>
          <Pressable onPress={() => void doRestore()} hitSlop={8}>
            <Text style={styles.footerLink}>Restore</Text>
          </Pressable>
          <Text style={styles.footerDot}>·</Text>
          <Text style={styles.footerNote}>Processed by Apple. Cancel anytime.</Text>
        </View>
      </ScrollView>

      {/* Fixed CTA */}
      <View style={[styles.ctaBar, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          style={[styles.cta, (busy || !selected) && { opacity: 0.6 }]}
          onPress={() => void buy()}
          disabled={busy || !selected}>
          {busy ? (
            <ActivityIndicator color={Void.accentText} />
          ) : (
            <Text style={styles.ctaText}>
              {selectedProduct?.period === 'lifetime' ? 'UNLOCK PRO MAX' : 'START FREE TRIAL'}
            </Text>
          )}
        </Pressable>
        <Text style={styles.ctaSub}>
          {selectedProduct
            ? selectedProduct.period === 'lifetime'
              ? `${selectedProduct.price} · one-time`
              : `3 days free, then ${selectedProduct.price}${selectedProduct.period === 'monthly' ? '/month' : '/year'}`
            : ''}
        </Text>
      </View>
      {/* Modal-presented screen: needs its own host (root host renders beneath). */}
      <NotifyHost />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Void.canvas, paddingHorizontal: 20 },
  watermark: {
    position: 'absolute',
    top: 60,
    right: -18,
    fontSize: 200,
    fontWeight: '900',
    color: Void.accent,
    opacity: 0.05,
    letterSpacing: -10,
  },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  eyebrow: { color: Void.textTertiary, fontSize: 11, fontWeight: '800', letterSpacing: 4 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Void.surface,
    borderWidth: 1,
    borderColor: Void.border,
  },
  headline: {
    color: Void.text,
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: -1,
    lineHeight: 40,
    marginBottom: 10,
  },
  headlineSub: { color: Void.textSecondary, fontSize: 14, marginBottom: 26 },
  reasonCard: {
    backgroundColor: Void.accentDim,
    borderWidth: 1,
    borderColor: Void.accent,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 18,
    alignItems: 'center',
  },
  reasonTitle: { color: Void.accent, fontSize: 15, fontWeight: '900', letterSpacing: 1, textAlign: 'center' },
  reasonBody: { color: Void.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 5, lineHeight: 17 },
  // Comparison table
  table: {
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 22,
    backgroundColor: Void.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Void.border,
  },
  rowHeader: {
    backgroundColor: Void.canvas,
    paddingVertical: 9,
  },
  cell: {},
  cellLabel: { flex: 1, color: Void.textSecondary, fontSize: 12.5, fontWeight: '600' },
  cellFree: { width: 64, alignItems: 'center' },
  cellPro: { width: 86, textAlign: 'center' },
  cellHeadText: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, textAlign: 'center' },
  cellHeadTextPro: { color: Void.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  freeValWrap: { flexDirection: 'row', justifyContent: 'center' },
  freeVal: {
    color: Void.textTertiary,
    fontSize: 12.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textDecorationLine: 'line-through',
    textDecorationColor: Void.textTertiary,
  },
  proVal: {
    color: Void.accent,
    fontSize: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  maxNote: { color: Void.textTertiary, fontSize: 10.5, fontWeight: '700', letterSpacing: 1, textAlign: 'center', marginBottom: 16 },
  // Plan chips - 3 across, compact
  plans: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  chip: {
    flex: 1,
    backgroundColor: Void.surface,
    borderWidth: 1.5,
    borderColor: Void.border,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  chipOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  chipTag: {
    position: 'absolute',
    top: -8,
    backgroundColor: Void.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 5,
  },
  chipTagText: { color: Void.accentText, fontSize: 7.5, fontWeight: '900', letterSpacing: 0.5 },
  chipLabel: { color: Void.textTertiary, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6 },
  chipLabelOn: { color: Void.accent },
  chipPrice: { color: Void.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  chipPriceOn: { color: Void.accent },
  chipPeriod: { color: Void.textTertiary, fontSize: 9.5, marginTop: 3 },
  chipMax: { color: Void.textTertiary, fontSize: 8.5, marginTop: 2, fontWeight: '700', letterSpacing: 1 },
  chipTrial: { color: Void.accent, fontSize: 8.5, marginTop: 2, fontWeight: '700', letterSpacing: 0.5 },
  loadingWrap: { flex: 1, alignItems: 'center', paddingVertical: 20 },
  loadingText: { color: Void.textTertiary, fontSize: 12, textAlign: 'center', lineHeight: 17 },
  // Footer
  footerRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 4 },
  footerLink: { color: Void.textSecondary, fontSize: 12 },
  footerDot: { color: Void.textTertiary, fontSize: 12 },
  footerNote: { color: Void.textTertiary, fontSize: 11 },
  // CTA
  ctaBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Void.canvas, paddingTop: 14, paddingHorizontal: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Void.border },
  cta: { backgroundColor: Void.accent, borderRadius: 16, paddingVertical: 17, alignItems: 'center' },
  ctaText: { color: Void.accentText, fontWeight: '900', fontSize: 15, letterSpacing: 2 },
  ctaSub: { color: Void.textTertiary, fontSize: 11.5, textAlign: 'center', marginTop: 9, minHeight: 15 },
});
