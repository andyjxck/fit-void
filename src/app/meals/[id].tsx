import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, ChevronLeft, Copy, ExternalLink, Minus, Plus, ScanBarcode, Star, Trash2, Utensils, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { BarcodeScanner } from '@/components/body/BarcodeScanner';
import { Card, cardChrome, CardSheen, Screen, SectionLabel } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import { foodImageMap, getFoodByBarcode, saveFoodItem } from '@/db/repo/foodItems';
import {
    addIngredient,
    deleteIngredient,
    deleteMeal,
    duplicateMeal,
    getMeal,
    toggleMealFavourite,
    updateIngredient,
    updateMeal,
    type IngredientInput,
} from '@/db/repo/meals';
import { eatMeal } from '@/lib/eatMeal';
import { primeFoodCache, type FoodProduct } from '@/lib/foodLookup';
import { macrosForGrams, mealTotals } from '@/lib/mealMath';
import { defaultServingLabel, parseServing } from '@/lib/servingUnits';
import type { Meal, MealIngredient, MealType } from '@/lib/types';
import { confirm, notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { tabular, Void } from '@/theme/tokens';
import { goBack } from '@/lib/nav';

const AMBER = '#FFB800';
const CYAN = '#7DD3FC';
const n = (s: string) => {
  const v = parseFloat(s.replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? v : 0;
};
const fmt = (v: number | null | undefined) => (v == null ? '' : Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

export default function MealScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const userId = useSettings((s) => s.supabase_user_id);

  const [meal, setMeal] = useState<(Meal & { ingredients: MealIngredient[] }) | null>(null);
  const [foodImages, setFoodImages] = useState<Map<string, string>>(new Map());
  const [editingMeta, setEditingMeta] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [ingSheet, setIngSheet] = useState<{ existing?: MealIngredient; product?: FoodProduct | null; barcode?: string | null } | null>(null);
  const [stepDraft, setStepDraft] = useState('');
  const [eatServings, setEatServings] = useState(1);

  const refresh = useCallback(async () => {
    if (!id) return;
    const m = await getMeal(id);
    setMeal(m);
    setFoodImages(await foodImageMap((m?.ingredients ?? []).map((i) => i.barcode).filter((b): b is string => !!b)));
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  if (!meal) return <Screen />;

  const { total, perServing } = mealTotals(meal.ingredients, meal.servings);
  const hasMacros = total.calories > 0;

  const setServings = (v: number) => void updateMeal(meal.id, { servings: Math.max(1, Math.min(50, v)) }).then(refresh);
  const addStep = () => {
    if (!stepDraft.trim()) return;
    void updateMeal(meal.id, { method: [...meal.method, stepDraft.trim()] }).then(refresh);
    setStepDraft('');
  };
  const removeStep = (i: number) => void updateMeal(meal.id, { method: meal.method.filter((_, j) => j !== i) }).then(refresh);
  const moveStep = (i: number, dir: -1 | 1) => {
    const m = [...meal.method];
    const j = i + dir;
    if (j < 0 || j >= m.length) return;
    [m[i], m[j]] = [m[j], m[i]];
    void updateMeal(meal.id, { method: m }).then(refresh);
  };

  const saveIngredient = async (input: IngredientInput) => {
    if (ingSheet?.existing) await updateIngredient(ingSheet.existing.id, input);
    else await addIngredient(meal.id, input);
    setIngSheet(null);
    // Barcode-linked correction: edited macros write back to the product's
    // barcode record (per-100g re-derived from qty) so future scans and
    // ingredients get the fixed values, not the stale upstream ones.
    if (input.barcode && (input.unit === 'g' || input.unit === 'ml') && input.quantity && input.quantity > 0) {
      try {
        const stored = await getFoodByBarcode(input.barcode);
        if (stored) {
          const r1 = (v: number) => Math.round(v * 10) / 10;
          const g = input.quantity;
          // Fields the user didn't touch keep the stored per-100g values.
          const per100g = {
            calories: input.calories != null ? r1((input.calories / g) * 100) : stored.per100g.calories,
            protein_g: input.protein_g != null ? r1((input.protein_g / g) * 100) : stored.per100g.protein_g,
            carbs_g: input.carbs_g != null ? r1((input.carbs_g / g) * 100) : stored.per100g.carbs_g,
            fat_g: input.fat_g != null ? r1((input.fat_g / g) * 100) : stored.per100g.fat_g,
            sugar_g: stored.per100g.sugar_g,
          };
          const parsed = parseServing(stored.serving);
          const srvG = parsed.basis === 'count' ? 0 : parsed.qty * parsed.mlPerUnit;
          const scale = srvG > 0 ? srvG / 100 : null;
          const corrected = {
            ...stored,
            name: stored.brand && input.name.endsWith(`(${stored.brand})`)
              ? input.name.slice(0, -(stored.brand.length + 3)).trim()
              : input.name,
            per100g,
            ...(scale != null
              ? {
                  calories: r1(per100g.calories * scale),
                  protein_g: r1(per100g.protein_g * scale),
                  carbs_g: r1(per100g.carbs_g * scale),
                  fat_g: r1(per100g.fat_g * scale),
                  sugar_g: r1(per100g.sugar_g * scale),
                }
              : {}),
          };
          primeFoodCache({ ...corrected, serving: corrected.serving ?? defaultServingLabel(corrected.is_drink) });
          await saveFoodItem(corrected);
        }
      } catch (e) {
        console.warn('[meals] ingredient write-back failed', e);
      }
    }
    void refresh();
  };

  const eat = async () => {
    await eatMeal({ ...meal, perServing, ingredientCount: meal.ingredients.length }, eatServings, userId);
    notify('Logged', { body: `${eatServings} × ${meal.name} · ${Math.round(perServing.calories * eatServings)} kcal added to today.`, tone: 'success' });
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.top}>
        <Pressable onPress={() => goBack()} hitSlop={8}>
          <ChevronLeft color={Void.text} size={24} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <Pressable onPress={() => void duplicateMeal(meal.id, userId).then((nid) => nid && router.replace(`/meals/${nid}`))} hitSlop={8}>
            <Copy color={Void.textSecondary} size={19} />
          </Pressable>
          <Pressable onPress={() => void toggleMealFavourite(meal.id).then(refresh)} hitSlop={8}>
            <Star color={meal.is_favourite ? Void.accent : Void.textTertiary} fill={meal.is_favourite ? Void.accent : 'transparent'} size={21} />
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={() =>
              void (async () => {
                const ok = await confirm({
                  title: 'Delete meal?',
                  body: meal.name,
                  confirmText: 'DELETE',
                  destructive: true,
                });
                if (!ok) return;
                await deleteMeal(meal.id);
                router.back();
              })()
            }>
            <Trash2 color={Void.textTertiary} size={19} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
        {meal.image_uri && (
          <Image source={{ uri: meal.image_uri }} style={styles.heroImage} contentFit="cover" cachePolicy="memory-disk" transition={150} />
        )}
        <Pressable onPress={() => setEditingMeta(true)} style={{ paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.name, { flexShrink: 1 }]}>{meal.name}</Text>
            {meal.meal_type && (
              <View style={styles.typePill}>
                <Text style={styles.typePillText}>{meal.meal_type.toUpperCase()}</Text>
              </View>
            )}
          </View>
          {meal.description ? <Text style={styles.desc}>{meal.description}</Text> : <Text style={styles.descHint}>Tap to add a description</Text>}
          {meal.tags.length > 0 && (
            <View style={styles.tags}>
              {meal.tags.map((t) => (
                <Text key={t} style={styles.tag}>
                  {t}
                </Text>
              ))}
            </View>
          )}
        </Pressable>
        {meal.source_url && (
          <View style={styles.source}>
            <ExternalLink color={Void.textTertiary} size={12} />
            <Text style={styles.sourceText} numberOfLines={1}>
              {meal.source_url.replace(/^https?:\/\/(www\.)?/, '')}
            </Text>
          </View>
        )}

        {/* Per-serving macros */}
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>PER SERVING</Text>
            <Text style={styles.heroValue}>
              {hasMacros ? perServing.calories : '-'}
              <Text style={styles.heroUnit}> kcal</Text>
            </Text>
          </View>
          <View style={styles.servings}>
            <Text style={styles.servingsLabel}>SERVINGS</Text>
            <View style={styles.stepper}>
              <Pressable onPress={() => setServings(meal.servings - 1)} hitSlop={6} style={styles.stepBtn}>
                <Minus color={Void.text} size={14} />
              </Pressable>
              <Text style={styles.stepVal}>{fmt(meal.servings)}</Text>
              <Pressable onPress={() => setServings(meal.servings + 1)} hitSlop={6} style={styles.stepBtn}>
                <Plus color={Void.text} size={14} />
              </Pressable>
            </View>
          </View>
        </View>
        {hasMacros && (
          <View style={styles.macros}>
            {(
              [
                ['Protein', perServing.protein_g, Void.accent],
                ['Carbs', perServing.carbs_g, CYAN],
                ['Fat', perServing.fat_g, AMBER],
              ] as [string, number, string][]
            ).map(([l, v, c]) => {
              const kcalFrom = l === 'Fat' ? v * 9 : v * 4;
              const pct = perServing.calories > 0 ? Math.round((kcalFrom / perServing.calories) * 100) : 0;
              return (
                <View key={l} style={styles.macro}>
                  <CardSheen />
                  <Text style={[styles.macroVal, { color: c }]}>{fmt(v)} g</Text>
                  <Text style={styles.macroLabel}>
                    {l} · {pct}%
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Ingredients */}
        <View style={styles.sectionHead}>
          <SectionLabel>INGREDIENTS · {meal.ingredients.length}</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 8, marginRight: 16 }}>
            <Pressable style={styles.miniBtn} onPress={() => setScanning(true)}>
              <ScanBarcode color={Void.accentText} size={15} />
              <Text style={styles.miniBtnText}>SCAN</Text>
            </Pressable>
            <Pressable style={[styles.miniBtn, styles.miniBtnGhost]} onPress={() => setIngSheet({})}>
              <Plus color={Void.accent} size={15} />
              <Text style={[styles.miniBtnText, { color: Void.accent }]}>ADD</Text>
            </Pressable>
          </View>
        </View>
        <Card style={{ paddingVertical: 4 }}>
          {meal.ingredients.length === 0 && (
            <Text style={styles.empty}>Scan a barcode or add ingredients by hand. Macros roll up automatically.</Text>
          )}
          {meal.ingredients.map((ing, i) => (
            <Pressable
              key={ing.id}
              style={[styles.ingRow, i < meal.ingredients.length - 1 && styles.ingBorder]}
              onPress={() => setIngSheet({ existing: ing })}>
              {ing.barcode && foodImages.get(ing.barcode) && (
                <Image source={{ uri: foodImages.get(ing.barcode)! }} style={styles.ingThumb} contentFit="cover" cachePolicy="memory-disk" transition={150} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.ingName}>{ing.name}</Text>
                <Text style={styles.ingMeta}>
                  {ing.quantity != null ? `${fmt(ing.quantity)}${ing.unit ? ' ' + ing.unit : ''} · ` : ''}
                  {fmt(ing.protein_g)}g protein · {fmt(ing.carbs_g)}g carbs · {fmt(ing.fat_g)}g fat
                  {ing.calories === 0 ? ' · no macros' : ''}
                </Text>
              </View>
              <Text style={[styles.ingKcal, ing.calories === 0 && { color: AMBER }]}>{ing.calories === 0 ? '?' : Math.round(ing.calories)}</Text>
              <Pressable hitSlop={8} onPress={() => void deleteIngredient(ing.id).then(refresh)}>
                <X color={Void.textTertiary} size={14} />
              </Pressable>
            </Pressable>
          ))}
          {hasMacros && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Whole recipe</Text>
              <Text style={styles.totalVal}>{total.calories} kcal</Text>
            </View>
          )}
        </Card>

        {/* Method */}
        <SectionLabel>METHOD</SectionLabel>
        <Card style={{ paddingVertical: 6 }}>
          {meal.method.map((s, i) => (
            <View key={i} style={[styles.step, i < meal.method.length - 1 && styles.ingBorder]}>
              <Text style={styles.stepNum}>{i + 1}</Text>
              <Text style={styles.stepText}>{s}</Text>
              <View style={{ gap: 6 }}>
                <Pressable onPress={() => moveStep(i, -1)} hitSlop={4} disabled={i === 0}>
                  <Text style={[styles.stepMove, i === 0 && { color: Void.border }]}>▲</Text>
                </Pressable>
                <Pressable onPress={() => moveStep(i, 1)} hitSlop={4} disabled={i === meal.method.length - 1}>
                  <Text style={[styles.stepMove, i === meal.method.length - 1 && { color: Void.border }]}>▼</Text>
                </Pressable>
              </View>
              <Pressable hitSlop={8} onPress={() => removeStep(i)}>
                <X color={Void.textTertiary} size={14} />
              </Pressable>
            </View>
          ))}
          <View style={styles.stepAdd}>
            <TextInput
              style={styles.stepInput}
              placeholder={meal.method.length === 0 ? 'First step…' : 'Next step…'}
              placeholderTextColor={Void.textTertiary}
              value={stepDraft}
              onChangeText={setStepDraft}
              onSubmitEditing={addStep}
              returnKeyType="done"
              multiline
            />
            <Pressable onPress={addStep} hitSlop={6} disabled={!stepDraft.trim()}>
              <Plus color={stepDraft.trim() ? Void.accent : Void.border} size={20} />
            </Pressable>
          </View>
        </Card>
      </ScrollView>

      {/* Eat bar */}
      <View style={styles.eatBar}>
        <View style={styles.stepper}>
          <Pressable onPress={() => setEatServings((v) => Math.max(0.5, v - 0.5))} hitSlop={6} style={styles.stepBtn}>
            <Minus color={Void.text} size={14} />
          </Pressable>
          <Text style={styles.stepVal}>{fmt(eatServings)}</Text>
          <Pressable onPress={() => setEatServings((v) => Math.min(10, v + 0.5))} hitSlop={6} style={styles.stepBtn}>
            <Plus color={Void.text} size={14} />
          </Pressable>
        </View>
        <Pressable style={[styles.eatBtn, !hasMacros && { opacity: 0.4 }]} disabled={!hasMacros} onPress={() => void eat()}>
          <Utensils color={Void.accentText} size={16} />
          <Text style={styles.eatText}>EAT · {hasMacros ? Math.round(perServing.calories * eatServings) : '-'} KCAL</Text>
        </Pressable>
      </View>

      <BarcodeScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onResult={(code, product) => {
          setScanning(false);
          setIngSheet({ product, barcode: code });
        }}
      />
      {ingSheet && <IngredientSheet state={ingSheet} onClose={() => setIngSheet(null)} onSave={saveIngredient} />}
      <MetaSheet visible={editingMeta} meal={meal} onClose={() => setEditingMeta(false)} onSaved={refresh} />
    </Screen>
  );
}

// -- Ingredient sheet ------------------------------------------------------

function IngredientSheet({
  state,
  onClose,
  onSave,
}: {
  state: { existing?: MealIngredient; product?: FoodProduct | null; barcode?: string | null };
  onClose: () => void;
  onSave: (i: IngredientInput) => void;
}) {
  const ex = state.existing;
  const p = state.product;
  const [name, setName] = useState(ex?.name ?? (p ? (p.brand ? `${p.name} (${p.brand})` : p.name) : ''));
  const [qty, setQty] = useState(ex ? fmt(ex.quantity) : p ? '100' : '');
  const [unit, setUnit] = useState(ex?.unit ?? (p ? (p.is_drink ? 'ml' : 'g') : ''));
  const [kcal, setKcal] = useState(ex ? fmt(ex.calories) : p ? fmt(p.per100g.calories) : '');
  const [prot, setProt] = useState(ex ? fmt(ex.protein_g) : p ? fmt(p.per100g.protein_g) : '');
  const [carb, setCarb] = useState(ex ? fmt(ex.carbs_g) : p ? fmt(p.per100g.carbs_g) : '');
  const [fat, setFat] = useState(ex ? fmt(ex.fat_g) : p ? fmt(p.per100g.fat_g) : '');
  const scanned = !!p;

  // For scanned products the macros track the amount automatically -
  // per100g is per-100ml for drinks (density ≈ 1), so g and ml scale alike.
  useEffect(() => {
    if (!p || (unit !== 'g' && unit !== 'ml')) return;
    const g = n(qty);
    const m = macrosForGrams(p.per100g, g);
    setKcal(fmt(m.calories));
    setProt(fmt(m.protein_g));
    setCarb(fmt(m.carbs_g));
    setFat(fmt(m.fat_g));
  }, [qty, unit, p]);

  return (
    <Sheet
      visible
      onClose={onClose}
      title={ex ? 'EDIT INGREDIENT' : scanned ? 'SCANNED' : state.barcode ? 'NOT IN DATABASE' : 'ADD INGREDIENT'}>
      {state.barcode && !p && <Text style={styles.sheetNote}>Barcode {state.barcode} isn’t in Open Food Facts. Enter the label values.</Text>}
          {scanned && <Text style={styles.sheetNote}>Per 100 {p!.is_drink ? 'ml' : 'g'}: {p!.per100g.calories} kcal · {p!.per100g.protein_g}g protein · {p!.per100g.carbs_g}g carbs · {p!.per100g.fat_g}g fat. Change the amount and the macros follow.</Text>}
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {p?.image_url && (
                <Image source={{ uri: p.image_url }} style={styles.ingThumbLarge} contentFit="cover" cachePolicy="memory-disk" transition={150} />
              )}
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Ingredient" placeholderTextColor={Void.textTertiary} value={name} onChangeText={setName} autoFocus={!scanned} />
            </View>
            <View style={styles.grid}>
              <Field label="QTY" value={qty} onChange={setQty} />
              <Field label="UNIT" value={unit} onChange={setUnit} text placeholder="g" />
            </View>
            <View style={styles.grid}>
              <Field label="KCAL" value={kcal} onChange={setKcal} accent />
              <Field label="PROTEIN" value={prot} onChange={setProt} suffix="g" />
              <Field label="CARBS" value={carb} onChange={setCarb} suffix="g" />
              <Field label="FAT" value={fat} onChange={setFat} suffix="g" />
            </View>
            <Text style={styles.sheetNote}>Macros are for the quantity above (not per 100 g).</Text>
          </ScrollView>
          <View style={styles.sheetRow}>
            <Pressable onPress={onClose} style={styles.btn}>
              <Text style={styles.btnText}>CANCEL</Text>
            </Pressable>
            <Pressable
              disabled={!name.trim()}
              style={[styles.btn, styles.btnAccent, !name.trim() && { opacity: 0.4 }]}
              onPress={() =>
                onSave({
                  name,
                  quantity: qty.trim() ? n(qty) : null,
                  unit: unit.trim() || null,
                  calories: n(kcal),
                  protein_g: n(prot),
                  carbs_g: n(carb),
                  fat_g: n(fat),
                  barcode: ex?.barcode ?? p?.barcode ?? state.barcode ?? null,
                })
              }>
              <Text style={[styles.btnText, { color: Void.accentText }]}>{ex ? 'SAVE' : 'ADD'}</Text>
            </Pressable>
          </View>
    </Sheet>
  );
}

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'dessert', 'snack'];
const GOALS: NonNullable<Meal['goal']>[] = ['cut', 'maintain', 'bulk', 'any'];

function MetaSheet({ visible, meal, onClose, onSaved }: { visible: boolean; meal: Meal; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(meal.name);
  const [pitch, setPitch] = useState(meal.pitch ?? '');
  const [desc, setDesc] = useState(meal.description ?? '');
  const [tags, setTags] = useState(meal.tags.join(', '));
  const [mealType, setMealType] = useState<MealType | null>(meal.meal_type);
  const [goal, setGoal] = useState<Meal['goal']>(meal.goal);
  const [minutes, setMinutes] = useState(meal.minutes != null ? String(meal.minutes) : '');
  const [imageUri, setImageUri] = useState<string | null>(meal.image_uri);
  useEffect(() => {
    if (visible) {
      setName(meal.name);
      setPitch(meal.pitch ?? '');
      setDesc(meal.description ?? '');
      setTags(meal.tags.join(', '));
      setMealType(meal.meal_type);
      setGoal(meal.goal);
      setMinutes(meal.minutes != null ? String(meal.minutes) : '');
      setImageUri(meal.image_uri);
    }
  }, [visible, meal]);

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [4, 3] });
    if (!res.canceled && res.assets[0]) setImageUri(res.assets[0].uri);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="EDIT MEAL">
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 480 }}>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={Void.textTertiary} />
          <TextInput style={styles.input} value={pitch} onChangeText={setPitch} placeholder="Pitch - one-line sell (optional)" placeholderTextColor={Void.textTertiary} />
          <TextInput style={[styles.input, { minHeight: 70 }]} value={desc} onChangeText={setDesc} placeholder="Description" placeholderTextColor={Void.textTertiary} multiline />

          <Text style={styles.fieldLabel}>WHICH MEAL</Text>
          <View style={styles.chipRow}>
            {MEAL_TYPES.map((t) => (
              <Pressable key={t} style={[styles.chip, mealType === t && styles.chipOn]} onPress={() => setMealType((c) => (c === t ? null : t))}>
                <Text style={[styles.chipText, mealType === t && { color: Void.accent }]}>{t.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>GOAL</Text>
          <View style={styles.chipRow}>
            {GOALS.map((g) => (
              <Pressable key={g} style={[styles.chip, goal === g && styles.chipOn]} onPress={() => setGoal((c) => (c === g ? null : g))}>
                <Text style={[styles.chipText, goal === g && { color: Void.accent }]}>{g.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>MINUTES</Text>
              <TextInput style={styles.input} value={minutes} onChangeText={setMinutes} placeholder="e.g. 20" placeholderTextColor={Void.textTertiary} keyboardType="number-pad" />
            </View>
          </View>

          <Text style={styles.fieldLabel}>PHOTO</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.photoPreview} contentFit="cover" />
            ) : null}
            <Pressable style={styles.photoBtn} onPress={() => void pickImage()}>
              <Camera color={Void.accent} size={15} />
              <Text style={[styles.btnText, { color: Void.accent }]}>{imageUri ? 'CHANGE' : 'ADD PHOTO'}</Text>
            </Pressable>
            {imageUri && (
              <Pressable hitSlop={8} onPress={() => setImageUri(null)}>
                <X color={Void.textTertiary} size={16} />
              </Pressable>
            )}
          </View>

          <TextInput style={[styles.input, { marginTop: 12 }]} value={tags} onChangeText={setTags} placeholder="Tags, comma separated" placeholderTextColor={Void.textTertiary} autoCapitalize="words" />
      </ScrollView>
          <View style={styles.sheetRow}>
            <Pressable onPress={onClose} style={styles.btn}>
              <Text style={styles.btnText}>CANCEL</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnAccent]}
              onPress={() =>
                void updateMeal(meal.id, {
                  name: name.trim() || meal.name,
                  pitch: pitch.trim() || null,
                  description: desc.trim() || null,
                  meal_type: mealType,
                  goal,
                  minutes: minutes.trim() ? Math.max(0, parseInt(minutes, 10) || 0) : null,
                  image_uri: imageUri,
                  tags: tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8),
                }).then(() => {
                  onSaved();
                  onClose();
                })
              }>
              <Text style={[styles.btnText, { color: Void.accentText }]}>SAVE</Text>
            </Pressable>
          </View>
    </Sheet>
  );
}

function Field({ label, value, onChange, suffix, accent, text, placeholder }: { label: string; value: string; onChange: (v: string) => void; suffix?: string; accent?: boolean; text?: boolean; placeholder?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          style={[styles.fieldInput, accent && { color: Void.accent }]}
          value={value}
          onChangeText={onChange}
          keyboardType={text ? 'default' : 'decimal-pad'}
          placeholder={placeholder ?? '0'}
          placeholderTextColor={Void.textTertiary}
          autoCapitalize="none"
        />
        {suffix && <Text style={styles.fieldSuffix}>{suffix}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 6 },
  name: { color: Void.text, fontSize: 26, fontWeight: '900', letterSpacing: -0.8 },
  desc: { color: Void.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 6 },
  descHint: { color: Void.textTertiary, fontSize: 12, marginTop: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: { color: Void.textSecondary, fontSize: 10, fontWeight: '700', borderWidth: 1, borderColor: Void.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginTop: 8 },
  sourceText: { color: Void.textTertiary, fontSize: 11, flex: 1 },
  hero: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginTop: 20 },
  heroLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  heroValue: { color: Void.text, fontSize: 44, fontWeight: '900', letterSpacing: -2, lineHeight: 48, marginTop: 2, ...tabular },
  heroUnit: { color: Void.textTertiary, fontSize: 16, fontWeight: '700', letterSpacing: 0 },
  servings: { alignItems: 'flex-end' },
  servingsLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Void.surface, borderWidth: 1, borderColor: Void.border, borderRadius: 10, padding: 3 },
  stepBtn: { width: 30, height: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: Void.surfaceRaised },
  stepVal: { color: Void.text, fontSize: 15, fontWeight: '800', minWidth: 32, textAlign: 'center', ...tabular },
  macros: { flexDirection: 'row', paddingHorizontal: 16, marginTop: 14, gap: 10 },
  macro: { flex: 1, ...cardChrome, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  macroVal: { fontSize: 18, fontWeight: '900', ...tabular },
  macroLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '700', marginTop: 2, ...tabular },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  miniBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Void.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8 },
  miniBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Void.accent },
  miniBtnText: { color: Void.accentText, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  empty: { color: Void.textTertiary, fontSize: 13, lineHeight: 19, textAlign: 'center', paddingVertical: 14 },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  ingBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border },
  ingName: { color: Void.text, fontSize: 14, fontWeight: '600' },
  ingThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: Void.surfaceRaised },
  ingThumbLarge: { width: 56, height: 56, borderRadius: 10, backgroundColor: Void.surfaceRaised },
  ingMeta: { color: Void.textTertiary, fontSize: 11, marginTop: 2, ...tabular },
  ingKcal: { color: Void.text, fontSize: 14, fontWeight: '800', ...tabular },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, marginTop: 2, borderTopWidth: 1, borderTopColor: Void.borderStrong },
  totalLabel: { color: Void.textSecondary, fontSize: 12, fontWeight: '700' },
  totalVal: { color: Void.textSecondary, fontSize: 12, fontWeight: '800', ...tabular },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  stepNum: { color: Void.accent, fontSize: 13, fontWeight: '900', width: 18, ...tabular },
  stepText: { color: Void.text, fontSize: 14, lineHeight: 20, flex: 1 },
  stepMove: { color: Void.textTertiary, fontSize: 10 },
  stepAdd: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8 },
  stepInput: { flex: 1, color: Void.text, fontSize: 14, paddingVertical: 8, maxHeight: 90 },
  eatBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, paddingBottom: 34, backgroundColor: Void.canvas, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Void.border },
  eatBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Void.accent, borderRadius: 12, paddingVertical: 14 },
  eatText: { color: Void.accentText, fontSize: 13, fontWeight: '900', letterSpacing: 1, ...tabular },
  // Sheets
  sheetNote: { color: Void.textTertiary, fontSize: 11, lineHeight: 16, marginBottom: 10, marginTop: 4 },
  input: { backgroundColor: Void.surfaceRaised, borderWidth: 1, borderColor: Void.border, borderRadius: 10, color: Void.text, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, marginBottom: 10 },
  grid: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  fieldLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Void.surfaceRaised, borderWidth: 1, borderColor: Void.border, borderRadius: 8, paddingHorizontal: 8 },
  fieldInput: { flex: 1, color: Void.text, fontSize: 15, fontWeight: '700', paddingVertical: 9, ...tabular },
  fieldSuffix: { color: Void.textTertiary, fontSize: 11 },
  sheetRow: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 8 },
  heroImage: { width: '100%', height: 180, backgroundColor: Void.surfaceRaised },
  typePill: { borderWidth: 1, borderColor: Void.accent, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  typePillText: { color: Void.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: Void.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  chipText: { color: Void.textSecondary, fontSize: 11, fontWeight: '800' },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: Void.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  photoPreview: { width: 72, height: 54, borderRadius: 8, backgroundColor: Void.surfaceRaised },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnAccent: { backgroundColor: Void.accent },
  btnText: { color: Void.textSecondary, fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },
});
