import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Sheet } from '@/components/ui/Sheet';
import type { FoodProduct } from '@/lib/foodLookup';
import { mlFor, parseServing } from '@/lib/servingUnits';
import { tabular, Void } from '@/theme/tokens';

export interface FoodDraft {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sugar_g: number;
  is_drink: boolean;
  /** ml credited to hydration when is_drink (0 = volume unknown). */
  drink_ml: number;
  serving: string | null;
  barcode: string | null;
  /** Set when a scanned product's label values were corrected - caller should
   *  persist it (saveFoodItem + primeFoodCache) so the fix survives rescans. */
  correctedProduct?: FoodProduct;
}

interface Props {
  visible: boolean;
  /** Pre-fill from a scan; null = blank manual entry. */
  product: FoodProduct | null;
  /** Barcode that scanned but wasn't found - attach to the manual entry. */
  unknownBarcode?: string | null;
  onClose: () => void;
  onSave: (draft: FoodDraft) => void;
}

const MULTIPLIERS = [0.5, 1, 2];

const n = (s: string) => {
  const v = parseFloat(s.replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? v : 0;
};
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function FoodSheet({ visible, product, unknownBarcode, onClose, onSave }: Props) {
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [sugar, setSugar] = useState('');
  const [isDrink, setIsDrink] = useState(false);
  const [drinkMl, setDrinkMl] = useState('');
  const [mult, setMult] = useState(1);
  const [customAmt, setCustomAmt] = useState('');
  // Editable declared basis ("Per 500 ml" on the label) - qty + unit are both
  // user-correctable because barcode DBs regularly publish wrong or
  // per-100g-only servings.
  const [basisQty, setBasisQty] = useState('');
  const [basisUnit, setBasisUnit] = useState('g');

  useEffect(() => {
    if (!visible) return;
    setMult(1);
    setCustomAmt('');
    setDrinkMl('');
    if (product) {
      const parsed = parseServing(product.serving);
      setBasisQty(fmt(parsed.qty));
      setBasisUnit(parsed.unit);
      setName(product.brand ? `${product.name} · ${product.brand}` : product.name);
      setKcal(fmt(product.calories));
      setProtein(fmt(product.protein_g));
      setCarbs(fmt(product.carbs_g));
      setFat(fmt(product.fat_g));
      setSugar(fmt(product.sugar_g));
      setIsDrink(product.is_drink);
    } else {
      setName('');
      setKcal('');
      setProtein('');
      setCarbs('');
      setFat('');
      setSugar('');
      setIsDrink(false);
    }
  }, [visible, product]);

  // Serving parsed in its (possibly user-corrected) unit - custom input is
  // entered in that same unit, so factor = entered / declared for every product.
  const info = product ? parseServing(`${n(basisQty) || 1} ${basisUnit}`) : parseServing(null);
  const amount = n(customAmt);
  const factor = customAmt !== '' && product ? amount / info.qty : mult;
  const amountTaken = customAmt !== '' ? amount : info.qty * mult;
  // Count-basis servings ("1 can") yield no ml - fall back to the manual field.
  const derivedMl = product ? mlFor(info, amountTaken) : 0;
  const drinkVolume = derivedMl > 0 ? derivedMl : n(drinkMl);

  const scaled = {
    calories: Math.round(n(kcal) * factor),
    protein_g: Math.round(n(protein) * factor * 10) / 10,
    carbs_g: Math.round(n(carbs) * factor * 10) / 10,
    fat_g: Math.round(n(fat) * factor * 10) / 10,
    sugar_g: Math.round(n(sugar) * factor * 10) / 10,
  };
  // Zero-calorie drinks (water, diet soda) are still worth logging.
  const canSave = name.trim().length > 0 && (scaled.calories > 0 || isDrink);

  // Unit chips: the parsed unit first, then the common correctable units.
  const basisUnits = product
    ? [...new Set([parseServing(product.serving).unit, 'g', 'ml', 'fl oz'])]
    : [];

  const servingLabel = `${fmt(n(basisQty) || 1)} ${basisUnit}`;

  // Build a corrected product record when the user changed the label basis,
  // the per-serving macros, or the food/drink flag from what was scanned.
  const correctedProduct = (): FoodProduct | undefined => {
    if (!product) return undefined;
    const parsed = parseServing(product.serving);
    const dirty =
      fmt(parsed.qty) !== fmt(n(basisQty) || 1) ||
      parsed.unit !== basisUnit ||
      n(kcal) !== product.calories ||
      n(protein) !== product.protein_g ||
      n(carbs) !== product.carbs_g ||
      n(fat) !== product.fat_g ||
      n(sugar) !== product.sugar_g ||
      isDrink !== product.is_drink;
    if (!dirty) return undefined;
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const grams = info.basis === 'count' ? 0 : info.qty * info.mlPerUnit;
    const per100g = grams > 0
      ? {
          calories: r1(n(kcal) / grams * 100),
          protein_g: r1(n(protein) / grams * 100),
          carbs_g: r1(n(carbs) / grams * 100),
          fat_g: r1(n(fat) / grams * 100),
          sugar_g: r1(n(sugar) / grams * 100),
        }
      : product.per100g;
    // Name field shows "name · brand" - strip the suffix so the stored name
    // doesn't double up on the next open.
    const trimmed = name.trim();
    const suffix = ` · ${product.brand ?? ''}`;
    const cleanName =
      product.brand && trimmed.endsWith(suffix) ? trimmed.slice(0, -suffix.length) : trimmed;
    return {
      ...product,
      name: cleanName,
      serving: servingLabel,
      calories: n(kcal),
      protein_g: n(protein),
      carbs_g: n(carbs),
      fat_g: n(fat),
      sugar_g: n(sugar),
      is_drink: isDrink,
      per100g,
    };
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={product ? 'SCANNED' : unknownBarcode ? 'NOT IN DATABASE' : 'ADD FOOD'}>
      {unknownBarcode && !product && (
            <Text style={styles.note}>
              Barcode {unknownBarcode} isn’t in Open Food Facts yet. Enter the label values and we’ll remember it.
            </Text>
          )}
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
            <View style={styles.nameRow}>
              {product?.image_url && (
                <Image source={{ uri: product.image_url }} style={styles.productImg} contentFit="cover" cachePolicy="memory-disk" transition={150} />
              )}
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="What did you eat?"
                placeholderTextColor={Void.textTertiary}
                value={name}
                onChangeText={setName}
                autoFocus={!product}
              />
            </View>
            {product && (
              <View style={styles.basisRow}>
                <Text style={styles.serving}>PER</Text>
                <TextInput
                  style={styles.basisInput}
                  value={basisQty}
                  onChangeText={setBasisQty}
                  keyboardType="decimal-pad"
                  placeholderTextColor={Void.textTertiary}
                />
                {basisUnits.map((u) => (
                  <Pressable
                    key={u}
                    style={[styles.basisChip, basisUnit === u && styles.multOn]}
                    onPress={() => setBasisUnit(u)}>
                    <Text style={[styles.multText, basisUnit === u && { color: Void.accent }]}>{u}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <View style={styles.grid}>
              <Field label="KCAL" value={kcal} onChange={setKcal} accent />
              <Field label="PROTEIN" value={protein} onChange={setProtein} suffix="g" />
              <Field label="CARBS" value={carbs} onChange={setCarbs} suffix="g" />
              <Field label="FAT" value={fat} onChange={setFat} suffix="g" />
            </View>
            <View style={[styles.grid, { alignItems: 'flex-end' }]}>
              <Field label="SUGAR" value={sugar} onChange={setSugar} suffix="g" />
              <Pressable
                style={[styles.drinkToggle, isDrink && styles.drinkToggleOn]}
                onPress={() => setIsDrink((v) => !v)}>
                <Text style={[styles.drinkToggleText, isDrink && { color: Void.accent }]}>
                  {isDrink ? 'DRINK' : 'FOOD'}
                </Text>
              </Pressable>
            </View>
            {isDrink && derivedMl === 0 && (
              <View style={[styles.grid, { marginTop: 8 }]}>
                <Field label="AMOUNT" value={drinkMl} onChange={setDrinkMl} suffix="ml" />
              </View>
            )}

            <Text style={styles.label}>SERVINGS</Text>
            <View style={styles.mults}>
              {MULTIPLIERS.map((m) => (
                <Pressable key={m} style={[styles.mult, customAmt === '' && mult === m && styles.multOn]} onPress={() => { setMult(m); setCustomAmt(''); }}>
                  <Text style={[styles.multText, customAmt === '' && mult === m && { color: Void.accent }]}>×{m}</Text>
                </Pressable>
              ))}
              {product && (
                <View style={[styles.mult, styles.customMult, customAmt !== '' && styles.multOn]}>
                  <TextInput
                    style={styles.customInput}
                    value={customAmt}
                    onChangeText={setCustomAmt}
                    keyboardType="decimal-pad"
                    placeholder={info.unit}
                    placeholderTextColor={Void.textTertiary}
                  />
                  <Text style={[styles.multText, customAmt !== '' && { color: Void.accent }]}>{info.unit}</Text>
                </View>
              )}
            </View>
            {customAmt !== '' && product && (
              <Text style={styles.serving}>{fmt(amount)} {info.unit} of {fmt(info.qty)} {info.unit} serving = ×{(amount / info.qty).toFixed(2)}</Text>
            )}
            {isDrink && drinkVolume > 0 && (
              <Text style={styles.serving}>≈ {drinkVolume} ml added to hydration</Text>
            )}

            <View style={styles.summary}>
              <Text style={styles.summaryKcal}>{scaled.calories}</Text>
              <Text style={styles.summaryUnit}> kcal</Text>
              <Text style={styles.summaryMacros}>
                {'   '}{fmt(scaled.protein_g)}g protein · {fmt(scaled.carbs_g)}g carbs · {fmt(scaled.fat_g)}g fat{scaled.sugar_g > 0 ? ` · ${fmt(scaled.sugar_g)}g sugar` : ''}
              </Text>
            </View>
          </ScrollView>

          <View style={styles.row}>
            <Pressable onPress={onClose} style={styles.btn}>
              <Text style={styles.btnText}>CANCEL</Text>
            </Pressable>
            <Pressable
              disabled={!canSave}
              onPress={() =>
                onSave({
                  name: name.trim(),
                  ...scaled,
                  is_drink: isDrink,
                  drink_ml: isDrink ? drinkVolume : 0,
                  serving: product
                    ? customAmt !== ''
                      ? `${fmt(amount)} ${info.unit}`
                      : mult !== 1
                        ? `${mult} × ${servingLabel}`
                        : servingLabel
                    : mult !== 1 ? `×${mult}` : null,
                  barcode: product?.barcode ?? unknownBarcode ?? null,
                  correctedProduct: correctedProduct(),
                })
              }
              style={[styles.btn, styles.btnAccent, !canSave && { opacity: 0.4 }]}>
              <Text style={[styles.btnText, { color: Void.accentText }]}>LOG IT</Text>
            </Pressable>
          </View>
    </Sheet>
  );
}

function Field({
  label,
  value,
  onChange,
  suffix,
  accent,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          style={[styles.fieldInput, accent && { color: Void.accent }]}
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={Void.textTertiary}
        />
        {suffix && <Text style={styles.fieldSuffix}>{suffix}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { color: Void.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  productImg: { width: 56, height: 56, borderRadius: 10, backgroundColor: Void.surfaceRaised },
  input: {
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 10,
    color: Void.text,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
    fontWeight: '600',
  },
  serving: { color: Void.textTertiary, fontSize: 11, marginTop: 6 },
  basisRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  basisInput: {
    width: 56,
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 8,
    color: Void.text,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    ...tabular,
  },
  basisChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Void.border,
    alignItems: 'center',
  },
  grid: { flexDirection: 'row', gap: 8, marginTop: 14 },
  drinkToggle: {
    flex: 1,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 9,
    backgroundColor: Void.surfaceRaised,
  },
  drinkToggleOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  drinkToggleText: { color: Void.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  field: { flex: 1 },
  fieldLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  fieldInput: { flex: 1, color: Void.text, fontSize: 15, fontWeight: '700', paddingVertical: 9, ...tabular },
  fieldSuffix: { color: Void.textTertiary, fontSize: 11 },
  label: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 14, marginBottom: 6 },
  mults: { flexDirection: 'row', gap: 8 },
  mult: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Void.border,
    alignItems: 'center',
  },
  multOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  multText: { color: Void.textSecondary, fontSize: 13, fontWeight: '700', ...tabular },
  customMult: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  customInput: {
    color: Void.text,
    fontSize: 13,
    fontWeight: '700',
    paddingVertical: 0,
    minWidth: 24,
    textAlign: 'center',
    ...tabular,
  },
  summary: { flexDirection: 'row', alignItems: 'baseline', marginTop: 16, flexWrap: 'wrap' },
  summaryKcal: { color: Void.text, fontSize: 28, fontWeight: '900', ...tabular },
  summaryUnit: { color: Void.textTertiary, fontSize: 13, fontWeight: '700' },
  summaryMacros: { color: Void.textSecondary, fontSize: 12, ...tabular },
  row: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnAccent: { backgroundColor: Void.accent },
  btnText: { color: Void.textSecondary, fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },
});
