import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowDown, ArrowUp, Camera, Clock, Link2, Minus, Plus, ScanBarcode, ScanLine, Star, Trash2, Utensils, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { BarcodeScanner } from '@/components/body/BarcodeScanner';
import { FoodSheet } from '@/components/body/FoodSheet';
import { Card, cardChrome, CardSheen, FocusToggle, Screen, ScreenHeader, SectionLabel } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import { RECOMMENDED_MEALS, RECOMMENDED_PLANS, type RecommendedMeal, type RecommendedPlan } from '@/data/recommendedMeals';
import { listCardio } from '@/db/repo/cardio';
import { listFoodItems, touchFoodItem, type FoodItem } from '@/db/repo/foodItems';
import type { LiquidKind } from '@/db/repo/liquids';
import {
    addPlanItem,
    createMeal,
    createPlan,
    deleteMeal,
    deletePlan,
    getMeal,
    listMeals,
    listPlans,
    reorderMeals,
    reorderPlans,
    toggleMealFavourite,
    togglePlanFavourite,
    type MealWithMacros,
} from '@/db/repo/meals';
import { dayTotals, deleteFood, listFoodForDay, type DayTotals } from '@/db/repo/nutrition';
import { eatMeal } from '@/lib/eatMeal';
import type { FoodProduct } from '@/lib/foodLookup';
import { isEverything, isTabMuted, parseIntents } from '@/lib/intents';
import { mealTotals } from '@/lib/mealMath';
import { importRecipesFromUrl, normaliseUrl, type ImportedRecipe } from '@/lib/recipeImport';
import { defaultServingLabel } from '@/lib/servingUnits';
import { allowedOrPrompt, countMyMealPlans } from '@/lib/tiers';
import type { Meal, MealIngredient, MealSlot, MealType, NutritionEntry } from '@/lib/types';
import { confirm, notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { tabular, Void } from '@/theme/tokens';

type Segment = 'log' | 'meals' | 'plans' | 'discover';
const SLOT_LABEL: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'dessert', 'snack'];
const MEAL_TYPE_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', dessert: 'Dessert', snack: 'Snack' };
const DIET_FILTERS = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free'] as const;
type DietFilter = (typeof DIET_FILTERS)[number];

/** Recommended meals carry the slot as a tag ('Breakfast' etc); a plan item's
 *  slot type is fixed, so derive a MealType for the saved meal. */
const mealTypeFromTags = (tags: string[]): MealType | null => {
  const lower = tags.map((t) => t.toLowerCase());
  return MEAL_TYPES.find((t) => lower.includes(t)) ?? null;
};

const recKcal = (r: RecommendedMeal) => Math.round(r.ingredients.reduce((s, i) => s + (i.calories ?? 0), 0) / (r.servings ?? 1));
const recProt = (r: RecommendedMeal) => Math.round(r.ingredients.reduce((s, i) => s + (i.protein_g ?? 0), 0) / (r.servings ?? 1));

export default function MealsTab() {
  const router = useRouter();
  const userId = useSettings((s) => s.supabase_user_id);
  const target = useSettings((s) => s.calorie_override);

  // Focus-adaptive: HYDRATION-only (no NUTRITION) has no use for recipe
  // browsing - meals/plans/discover hide, leaving just the food+drink log.
  // A muted-but-entered tab or the header SHOW ALL toggle reveals everything.
  const activeIntents = parseIntents(useSettings((s) => s.active_intents));
  const tabMuted = isTabMuted('meals', activeIntents);
  const [showEverything, setShowEverything] = useState(false);
  const showRecipes =
    isEverything(activeIntents) || tabMuted || showEverything || activeIntents.includes('nutrition');
  const partiallyFiltered = !isEverything(activeIntents) && !tabMuted && !activeIntents.includes('nutrition');

  const [seg, setSeg] = useState<Segment>('meals');
  useEffect(() => {
    if (!showRecipes && seg !== 'log') setSeg('log');
  }, [showRecipes, seg]);
  const [meals, setMeals] = useState<MealWithMacros[]>([]);
  const [plans, setPlans] = useState<Awaited<ReturnType<typeof listPlans>>>([]);
  const [reordering, setReordering] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [busy, setBusy] = useState(false);

  const [savedRec, setSavedRec] = useState<Set<string>>(new Set());
  const [favRec, setFavRec] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [foodSheet, setFoodSheet] = useState<{ product: FoodProduct | null; barcode: string | null } | null>(null);
  const [todayFoods, setTodayFoods] = useState<NutritionEntry[]>([]);
  const [scanned, setScanned] = useState<FoodItem[]>([]);
  const [todayTotals, setTodayTotals] = useState<DayTotals>({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sugar_g: 0, drink_sugar_g: 0, drink_calories: 0 });
  const [todayCardioKcal, setTodayCardioKcal] = useState(0);
  const [importDrafts, setImportDrafts] = useState<{ recipe: ImportedRecipe; servings: number }[]>([]);
  const [dietFilter, setDietFilter] = useState<DietFilter | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [viewMeal, setViewMeal] = useState<(Meal & { ingredients: MealIngredient[] }) | null>(null);
  const importMeta = useRef<{ toInput: (r: ImportedRecipe, servings: number) => Parameters<typeof createMeal>[0] } | null>(null);

  // barcode → product image for today's log rows (entries store the barcode).
  const foodImages = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of scanned) if (f.image_url) m.set(f.barcode, f.image_url);
    return m;
  }, [scanned]);

  const refresh = useCallback(async () => {
    const [m, p, foods, totals, cardio, scanList] = await Promise.all([
      listMeals(),
      listPlans(),
      listFoodForDay(),
      dayTotals(),
      listCardio(),
      listFoodItems(),
    ]);
    setMeals(m);
    setPlans(p);
    setTodayFoods(foods);
    setScanned(scanList);
    setTodayTotals(totals);
    const today = new Date().toDateString();
    setTodayCardioKcal(
      cardio
        .filter((s) => new Date(s.started_at).toDateString() === today)
        .reduce((a, s) => a + (s.calories ?? 0), 0)
    );
  }, []);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  // Dietary filter - a plan qualifies when every meal in it carries the tag.
  const filteredRecMeals = useMemo(
    () => (dietFilter ? RECOMMENDED_MEALS.filter((r) => r.tags.includes(dietFilter)) : RECOMMENDED_MEALS),
    [dietFilter]
  );
  const filteredPlans = useMemo(() => {
    if (!dietFilter) return RECOMMENDED_PLANS;
    return RECOMMENDED_PLANS.filter((p) =>
      p.items.every((i) => RECOMMENDED_MEALS.find((r) => r.id === i.mealId)?.tags.includes(dietFilter))
    );
  }, [dietFilter]);

  // -- Actions -------------------------------------------------------------
  const openMeal = async (m: MealWithMacros) => {
    const full = await getMeal(m.id);
    if (full) setViewMeal(full);
  };

  const move = async (kind: 'meal' | 'plan', index: number, dir: -1 | 1) => {
    const list = kind === 'meal' ? meals : plans;
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const ids = list.map((x) => x.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await (kind === 'meal' ? reorderMeals(ids) : reorderPlans(ids));
    void refresh();
  };

  const confirmDelete = async (kind: 'meal' | 'plan', id: string, name: string) => {
    const ok = await confirm({ title: `Delete ${kind}?`, body: name, confirmText: 'DELETE', destructive: true });
    if (!ok) return;
    void (kind === 'meal' ? deleteMeal(id) : deletePlan(id)).then(refresh);
  };

  const saveRecommended = async (rec: RecommendedMeal) => {
    const id = await createMeal({ ...rec, meal_type: mealTypeFromTags(rec.tags), user_id: userId });
    setSavedRec((s) => new Set(s).add(rec.id));
    void refresh();
    notify('Saved', { body: `${rec.name} is now in your meals.`, tone: 'success' });
  };

  const toggleFavRec = (id: string) => {
    setFavRec((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveRecommendedPlan = async (plan: RecommendedPlan, itemsOverride?: RecommendedPlan['items']) => {
    const items = itemsOverride ?? plan.items;
    if (!(await allowedOrPrompt('mealPlans', await countMyMealPlans(userId)))) return;
    // Create all meals first, then the plan with items
    const mealMap = new Map<string, string>();
    for (const item of items) {
      if (mealMap.has(item.mealId)) continue;
      const rec = RECOMMENDED_MEALS.find((r) => r.id === item.mealId);
      if (rec) mealMap.set(item.mealId, await createMeal({ ...rec, meal_type: mealTypeFromTags(rec.tags), user_id: userId }));
    }
    const planId = await createPlan({ name: plan.name, days: plan.days, user_id: userId, pitch: plan.pitch, goal: plan.goal, tags: plan.tags });
    for (const item of items) {
      const mealId = mealMap.get(item.mealId);
      if (mealId) await addPlanItem({ plan_id: planId, meal_id: mealId, day_index: item.day, slot: item.slot });
    }
    setSavedRec((s) => new Set(s).add(plan.id));
    void refresh();
    notify('Saved', { body: `${plan.name} is now in your plans.`, tone: 'success' });
  };

  const runImport = async () => {
    const url = normaliseUrl(linkInput);
    if (!url) {
      notify('Not a link', { body: 'Paste a full URL to a recipe page.', tone: 'error' });
      return;
    }
    setBusy(true);
    let found: ImportedRecipe[] = [];
    try {
      found = await importRecipesFromUrl(url);
    } catch (e) {
      setBusy(false);
      notify("Couldn't reach that page", { body: e instanceof Error ? e.message : 'Check the link and your connection.', tone: 'error' });
      return;
    }
    setBusy(false);
    if (found.length === 0) {
      notify('No recipe found', { body: "That page doesn't publish structured recipe data. You can still create the meal by hand and scan the ingredients.", tone: 'error' });
      return;
    }
    setLinkInput('');
    const toInput = (r: ImportedRecipe, servings: number) => {
      // Per-ingredient macros from Open Food Facts enrichment.
      const ingMacros = r.ingredients.map((i) => i.calories ?? 0);
      const hasPerIng = ingMacros.some((c) => c > 0);
      return {
        name: r.name,
        description: r.description,
        servings,
        method: r.method,
        tags: r.tags,
        source_url: r.sourceUrl,
        image_uri: r.imageUrl,
        user_id: userId,
        ingredients: hasPerIng
          ? r.ingredients.map((i) => ({ ...i }))
          : r.nutrition
            ? [
                ...r.ingredients.map((i) => ({ ...i })),
                { name: 'Nutrition (from site, whole recipe)', quantity: null, unit: null, calories: r.nutrition.calories * servings, protein_g: r.nutrition.protein_g * servings, carbs_g: r.nutrition.carbs_g * servings, fat_g: r.nutrition.fat_g * servings },
              ]
            : r.ingredients.map((i) => ({ ...i })),
      };
    };
    // Confirm servings before saving - the site may not declare a yield.
    setImportDrafts(found.map((r) => ({ recipe: r, servings: r.servings ?? 0 })));
    setImportOpen(true);
    importMeta.current = { toInput };
  };

  const commitImport = async (mode: 'meals' | 'plan') => {
    const drafts = importDrafts;
    setImportOpen(false);
    setImportDrafts([]);
    const toInput = importMeta.current?.toInput;
    if (!toInput) return;
    if (drafts.length === 1) {
      const id = await createMeal(toInput(drafts[0].recipe, drafts[0].servings || 1));
      void refresh();
      router.push(`/meals/${id}`);
      return;
    }
    if (mode === 'meals') {
      await Promise.all(drafts.map((d) => createMeal(toInput(d.recipe, d.servings || 1))));
      void refresh();
      return;
    }
    if (!(await allowedOrPrompt('mealPlans', await countMyMealPlans(userId)))) return;
    const ids = await Promise.all(drafts.map((d) => createMeal(toInput(d.recipe, d.servings || 1))));
    const planId = await createPlan({ name: drafts[0].recipe.name.split(/[:\--|]/)[0].trim() || 'Imported plan', days: Math.min(7, ids.length), user_id: userId });
    for (let i = 0; i < ids.length; i++) await addPlanItem({ plan_id: planId, meal_id: ids[i], day_index: i % Math.min(7, ids.length), slot: 'dinner' });
    void refresh();
    router.push(`/meals/plan/${planId}`);
  };

  // -- Render --------------------------------------------------------------
  return (
    <Screen>
      <ScreenHeader
        title="Meals"
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {partiallyFiltered && <FocusToggle showAll={showEverything} onToggle={() => setShowEverything((v) => !v)} />}
            {target != null && (
              <View style={styles.targetPill}>
                <Text style={styles.targetPillText}>{target} kcal</Text>
              </View>
            )}
            {seg !== 'discover' && (
              <Pressable onPress={() => setCreateOpen(true)} hitSlop={8}>
                <Plus color={Void.accent} size={24} />
              </Pressable>
            )}
          </View>
        }
      />
      <View style={styles.segments}>
        {(
          [
            ['log', 'Log'],
            ...(showRecipes
              ? ([
                  ['meals', `Meals${meals.length ? ` · ${meals.length}` : ''}`],
                  ['plans', `Plans${plans.length ? ` · ${plans.length}` : ''}`],
                  ['discover', 'Discover'],
                ] as [Segment, string][])
              : []),
          ] as [Segment, string][]
        ).map(([k, label]) => (
          <Pressable key={k} style={[styles.segment, seg === k && styles.segmentOn]} onPress={() => setSeg(k)}>
            <Text
              style={[styles.segmentText, seg === k && { color: Void.accentText }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        {/* -- LOG ---------------------------------------------------------- */}
        {seg === 'log' && (
          <LogSegment
            todayFoods={todayFoods}
            todayTotals={todayTotals}
            target={target}
            burned={todayCardioKcal}
            meals={meals}
            userId={userId}
            foodImages={foodImages}
            onScan={() => setScannerOpen(true)}
            onManual={() => setFoodSheet({ product: null, barcode: null })}
            onEatMeal={(m) => void eatMeal(m, 1, userId).then(() => notify('Logged', { body: `${m.name} · ${m.perServing.calories} kcal added to today.`, tone: 'success' })).then(refresh)}
            onDeleteFood={(id) => void deleteFood(id).then(refresh)}
          />
        )}

        {/* -- MEALS -------------------------------------------------------- */}
        {seg === 'meals' && (
          <>
            <LinkBar
              value={linkInput}
              onChange={setLinkInput}
              onSubmit={() => void runImport()}
              busy={busy}
              placeholder="Paste a recipe link…"
            />
            {meals.length === 0 ? (
              <EmptyState text="No meals yet. Paste a link above, or grab something from Discover." onCta={() => setSeg('discover')} cta="DISCOVER" />
            ) : (
              <>
                {reordering && (
                  <Pressable style={styles.sortDoneBtn} onPress={() => setReordering(false)}>
                    <Text style={styles.sortDoneText}>DONE SORTING</Text>
                  </Pressable>
                )}
                {meals.map((m, i) => (
                  <View key={m.id}>
                    <Pressable style={styles.row} onPress={() => !reordering && void openMeal(m)}>
                      {m.image_uri && (
                        <Image source={{ uri: m.image_uri }} style={styles.rowThumb} contentFit="cover" cachePolicy="memory-disk" transition={150} />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {m.name}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {m.meal_type ? `${MEAL_TYPE_LABEL[m.meal_type]} · ` : ''}
                          {m.perServing.calories} kcal · {Math.round(m.perServing.protein_g)}g protein · {Math.round(m.perServing.carbs_g)}g carbs · {Math.round(m.perServing.fat_g)}g fat
                          {m.ingredientCount ? ` · ${m.ingredientCount} ingredients` : ''}
                        </Text>
                      </View>
                      {reordering ? (
                        <View style={styles.reorder}>
                          <Pressable onPress={() => void move('meal', i, -1)} hitSlop={6} disabled={i === 0}>
                            <ArrowUp color={i === 0 ? Void.border : Void.textSecondary} size={18} />
                          </Pressable>
                          <Pressable onPress={() => void move('meal', i, 1)} hitSlop={6} disabled={i === meals.length - 1}>
                            <ArrowDown color={i === meals.length - 1 ? Void.border : Void.textSecondary} size={18} />
                          </Pressable>
                          <Pressable onPress={() => confirmDelete('meal', m.id, m.name)} hitSlop={6}>
                            <Trash2 color={Void.textTertiary} size={16} />
                          </Pressable>
                        </View>
                      ) : (
                        <>
                          <Pressable onPress={() => void toggleMealFavourite(m.id).then(refresh)} hitSlop={8}>
                            <Star color={m.is_favourite ? Void.accent : Void.textTertiary} fill={m.is_favourite ? Void.accent : 'transparent'} size={18} />
                          </Pressable>
                          <Pressable
                            style={styles.eat}
                            hitSlop={4}
                            onPress={() => {
                              if (m.perServing.calories === 0) {
                                router.push(`/meals/${m.id}`);
                                return;
                              }
                              void eatMeal(m, 1, userId).then(() => notify('Logged', { body: `${m.name} · ${m.perServing.calories} kcal added to today.`, tone: 'success' }));
                            }}>
                            <Utensils color={Void.accentText} size={14} />
                          </Pressable>
                        </>
                      )}
                    </Pressable>

                    {/* Interleave recommended every 8 meals */}
                    {!reordering && (i + 1) % 8 === 0 && i < meals.length - 1 && (
                      <>
                        <View style={styles.recDivider}>
                          <View style={styles.recDividerLine} />
                          <Text style={styles.recDividerLabel}>RECOMMENDED</Text>
                          <View style={styles.recDividerLine} />
                        </View>
                        <RecommendedMealRow
                          rec={RECOMMENDED_MEALS[Math.floor((i + 1) / 8 - 1) % RECOMMENDED_MEALS.length]}
                          saved={savedRec.has(RECOMMENDED_MEALS[Math.floor((i + 1) / 8 - 1) % RECOMMENDED_MEALS.length].id) || meals.some((mm) => mm.name === RECOMMENDED_MEALS[Math.floor((i + 1) / 8 - 1) % RECOMMENDED_MEALS.length].name)}
                          onSave={() => void saveRecommended(RECOMMENDED_MEALS[Math.floor((i + 1) / 8 - 1) % RECOMMENDED_MEALS.length])}
                        />
                      </>
                    )}
                  </View>
                ))}
              </>
            )}

            {/* Scanned foods - scan once, reusable under your recipes */}
            {scanned.length > 0 && (
              <>
                <SectionLabel>SCANNED</SectionLabel>
                <Card style={{ paddingVertical: 6, marginBottom: 12 }}>
                  {scanned.map((f, i) => (
                    <Pressable
                      key={f.id}
                      style={[styles.logFoodRow, i < scanned.length - 1 && styles.logFoodBorder]}
                      onPress={() => {
                        void touchFoodItem(f.id);
                        // FoodItem.serving is nullable; FoodProduct expects a string.
                        setFoodSheet({ product: { ...f, serving: f.serving ?? defaultServingLabel(f.is_drink) }, barcode: null });
                      }}>
                      {f.image_url && (
                        <Image source={{ uri: f.image_url }} style={styles.foodThumb} contentFit="cover" cachePolicy="memory-disk" transition={150} />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.logFoodName} numberOfLines={1}>
                          {f.brand ? `${f.name} · ${f.brand}` : f.name}
                        </Text>
                        <Text style={styles.logFoodMeta}>
                          {f.calories} kcal · {Math.round(f.protein_g)}g protein · {Math.round(f.carbs_g)}g carbs · {Math.round(f.fat_g)}g fat
                          {f.serving ? ` · ${f.serving}` : ''}
                        </Text>
                      </View>
                      <ScanLine color={Void.textTertiary} size={16} />
                    </Pressable>
                  ))}
                </Card>
              </>
            )}
          </>
        )}

        {/* -- PLANS -------------------------------------------------------- */}
        {seg === 'plans' && (
          <>
            <LinkBar
              value={linkInput}
              onChange={setLinkInput}
              onSubmit={() => void runImport()}
              busy={busy}
              placeholder="Paste a meal-plan link…"
            />
            {plans.length === 0 ? (
              <EmptyState text="No meal plans yet. A plan lays meals across the week so hitting your target is a checklist, not a decision." onCta={() => setSeg('discover')} cta="DISCOVER PLANS" />
            ) : (
              <>
                {reordering && (
                  <Pressable style={styles.sortDoneBtn} onPress={() => setReordering(false)}>
                    <Text style={styles.sortDoneText}>DONE SORTING</Text>
                  </Pressable>
                )}
                {plans.map((p, i) => (
                  <Pressable key={p.id} style={styles.row} onPress={() => !reordering && router.push(`/meals/plan/${p.id}`)}>
                    {p.coverImages.length > 0 && (
                      <View style={styles.rowCovers}>
                        {p.coverImages.map((u, j) => (
                          <Image key={j} source={{ uri: u }} style={styles.rowCover} contentFit="cover" cachePolicy="memory-disk" transition={150} />
                        ))}
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={styles.rowMeta}>
                        {p.days} day{p.days === 1 ? '' : 's'} · {p.itemCount} meal{p.itemCount === 1 ? '' : 's'}
                        {p.avgCalories ? ` · ~${p.avgCalories} kcal / day` : ''}
                      </Text>
                    </View>
                    {reordering ? (
                      <View style={styles.reorder}>
                        <Pressable onPress={() => void move('plan', i, -1)} hitSlop={6} disabled={i === 0}>
                          <ArrowUp color={i === 0 ? Void.border : Void.textSecondary} size={18} />
                        </Pressable>
                        <Pressable onPress={() => void move('plan', i, 1)} hitSlop={6} disabled={i === plans.length - 1}>
                          <ArrowDown color={i === plans.length - 1 ? Void.border : Void.textSecondary} size={18} />
                        </Pressable>
                        <Pressable onPress={() => confirmDelete('plan', p.id, p.name)} hitSlop={6}>
                          <Trash2 color={Void.textTertiary} size={16} />
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable onPress={() => void togglePlanFavourite(p.id).then(refresh)} hitSlop={8}>
                        <Star color={p.is_favourite ? Void.accent : Void.textTertiary} fill={p.is_favourite ? Void.accent : 'transparent'} size={18} />
                      </Pressable>
                    )}
                  </Pressable>
                ))}
              </>
            )}
          </>
        )}

        {/* -- DISCOVER ---------------------------------------------------- */}
        {seg === 'discover' && (
          <>
            {/* Dietary filters */}
            <View style={styles.dFilterRow}>
              {DIET_FILTERS.map((f) => (
                <Pressable
                  key={f}
                  style={[styles.crChip, dietFilter === f && styles.crChipOn]}
                  onPress={() => setDietFilter((cur) => (cur === f ? null : f))}>
                  <Text style={[styles.crChipText, dietFilter === f && { color: Void.accent }]}>{f.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>

            {/* Plan cards - full width, visual week layout */}
            <Text style={styles.dSectionLabel}>MEAL PLANS</Text>
            {filteredPlans.length === 0 && (
              <Text style={styles.dFilterEmpty}>No plans match that filter yet.</Text>
            )}
            {filteredPlans.map((p) => (
              <DiscoverPlanCard key={p.id} plan={p} saved={savedRec.has(p.id)} onSave={(items) => void saveRecommendedPlan(p, items)} />
            ))}

            {/* Meals - 2-column grid */}
            <Text style={styles.dSectionLabel}>RECIPES</Text>
            {filteredRecMeals.length === 0 && (
              <Text style={styles.dFilterEmpty}>No recipes match that filter yet.</Text>
            )}
            <View style={styles.dGrid}>
              {filteredRecMeals.map((r) => (
                <DiscoverMealCard
                  key={r.id}
                  rec={r}
                  saved={savedRec.has(r.id) || meals.some((m) => m.name === r.name)}
                  onSave={() => void saveRecommended(r)}
                  fav={favRec.has(r.id)}
                  onFav={() => toggleFavRec(r.id)}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* Sort button for meals/plans */}
      {seg !== 'discover' && !reordering && (meals.length > 0 || plans.length > 0) && (
        <Pressable style={styles.sortBtn} onPress={() => setReordering(true)}>
          <Text style={styles.sortBtnText}>SORT</Text>
        </Pressable>
      )}

      <CreateRecipeModal
        visible={createOpen}
        segment={seg === 'plans' ? 'plans' : 'meals'}
        userId={userId}
        onClose={() => setCreateOpen(false)}
        onSaved={(id, kind) => {
          setCreateOpen(false);
          void refresh();
          if (kind === 'meal') router.push(`/meals/${id}`);
          else router.push(`/meals/plan/${id}`);
        }}
      />

      {/* Barcode scanner */}
      <BarcodeScanner
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onResult={(barcode, product) => {
          setScannerOpen(false);
          setFoodSheet({ product, barcode: product ? null : barcode });
        }}
      />

      {/* Manual food entry / scan result */}
      <FoodSheet
        visible={foodSheet != null}
        product={foodSheet?.product ?? null}
        unknownBarcode={foodSheet?.barcode ?? null}
        onClose={() => setFoodSheet(null)}
        onSave={(draft) => {
          setFoodSheet(null);
          void (async () => {
            // Label corrections persist back to the barcode's record so the
            // next scan returns the fixed values, not the stale lookup.
            if (draft.correctedProduct) {
              const { saveFoodItem } = await import('@/db/repo/foodItems');
              const { primeFoodCache } = await import('@/lib/foodLookup');
              primeFoodCache(draft.correctedProduct);
              await saveFoodItem(draft.correctedProduct).catch((e) =>
                console.warn('[meals] saveFoodItem failed', e)
              );
            }
            const { logFood } = await import('@/db/repo/nutrition');
            const foodId = await logFood({
              name: draft.name,
              calories: draft.calories,
              protein_g: draft.protein_g,
              carbs_g: draft.carbs_g,
              fat_g: draft.fat_g,
              sugar_g: draft.sugar_g,
              is_drink: draft.is_drink,
              serving: draft.serving,
              barcode: draft.barcode,
              source: draft.barcode ? 'barcode' : 'manual',
              user_id: userId,
            });
            // Drinks also land on the hydration ledger - volume only, so the
            // calories/sugar on the nutrition row aren't double-counted.
            // nutrition_id links the shadow so deleting the drink removes it.
            if (draft.is_drink && draft.drink_ml > 0) {
              const { logLiquid } = await import('@/db/repo/liquids');
              const { drinkKind } = await import('@/lib/servingUnits');
              const liquidInput: Parameters<typeof logLiquid>[0] & { nutrition_id?: string } = {
                amount_ml: draft.drink_ml,
                kind: drinkKind(draft.name) as LiquidKind,
                name: draft.name,
                nutrition_id: foodId,
              };
              await logLiquid(liquidInput);
            }
            await refresh();
          })();
        }}
      />

      {/* Recipe detail sheet - same look as Discover */}
      {viewMeal && (
        <MealViewModal
          meal={viewMeal}
          onClose={() => setViewMeal(null)}
          onEdit={() => {
            const id = viewMeal.id;
            setViewMeal(null);
            router.push(`/meals/${id}`);
          }}
          onFav={() => void toggleMealFavourite(viewMeal.id).then(refresh).then(() => setViewMeal(null))}
          onEat={(servings) => {
            const m = viewMeal;
            setViewMeal(null);
            const perServing = mealTotals(m.ingredients, m.servings).perServing;
            void eatMeal({ ...m, perServing, ingredientCount: m.ingredients.length }, servings, userId).then(() =>
              notify('Logged', { body: `${m.name} · ${Math.round(perServing.calories * servings)} kcal added to today.`, tone: 'success' })
            ).then(refresh);
          }}
        />
      )}

      {/* Import confirm - pick servings per recipe before saving */}
      <Sheet
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        title={`IMPORT ${importDrafts.length === 1 ? 'RECIPE' : `${importDrafts.length} RECIPES`}`}
        style={styles.crSheet}>
            <Text style={styles.crSub}>How many servings does {importDrafts.length === 1 ? 'it make' : 'each make'}? Used to work out per-serving macros.</Text>
            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {importDrafts.map((d, i) => (
                <View key={i} style={styles.importRow}>
                  <Text style={styles.importName} numberOfLines={1}>{d.recipe.name}</Text>
                  <View style={styles.importServingsWrap}>
                    <TextInput
                      style={styles.importServingsInput}
                      value={d.servings > 0 ? String(d.servings) : ''}
                      onChangeText={(v) => setImportDrafts((s) => s.map((x, j) => (j === i ? { ...x, servings: parseInt(v, 10) || 0 } : x)))}
                      keyboardType="number-pad"
                      placeholder="?"
                      placeholderTextColor={Void.textTertiary}
                      maxLength={2}
                    />
                    <Text style={styles.importServingsLabel}>SERVINGS</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={styles.crActions}>
              <Pressable onPress={() => setImportOpen(false)} style={styles.crBtn}>
                <Text style={styles.crBtnText}>CANCEL</Text>
              </Pressable>
              {importDrafts.length > 1 && (
                <Pressable onPress={() => void commitImport('plan')} style={styles.crBtn}>
                  <Text style={styles.crBtnText}>MAKE PLAN</Text>
                </Pressable>
              )}
              <Pressable onPress={() => void commitImport('meals')} style={[styles.crBtn, styles.crBtnAccent]}>
                <Text style={[styles.crBtnText, { color: Void.accentText }]}>{importDrafts.length > 1 ? 'ADD MEALS' : 'IMPORT'}</Text>
              </Pressable>
            </View>
      </Sheet>
    </Screen>
  );
}

// -- Components -------------------------------------------------------------

function LinkBar({ value, onChange, onSubmit, busy, placeholder }: { value: string; onChange: (v: string) => void; onSubmit: () => void; busy: boolean; placeholder: string }) {
  return (
    <View style={styles.linkBar}>
      <Link2 color={Void.textTertiary} size={18} />
      <TextInput
        style={styles.linkInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Void.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        editable={!busy}
      />
      {busy ? (
        <ActivityIndicator color={Void.accent} size="small" />
      ) : (
        value.length > 5 && (
          <Pressable hitSlop={8} onPress={onSubmit}>
            <Text style={styles.linkGo}>GO</Text>
          </Pressable>
        )
      )}
    </View>
  );
}

function EmptyState({ text, onCta, cta }: { text: string; onCta: () => void; cta: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
      <Pressable style={styles.emptyCta} onPress={onCta}>
        <Text style={styles.emptyCtaText}>{cta}</Text>
      </Pressable>
    </View>
  );
}

const SCALE_OPTS = [0.5, 1, 1.5, 2];

/** Recipe detail sheet - same look as the Discover meal modal, but for saved meals. */
export function MealViewModal({
  meal,
  onClose,
  onEdit,
  onEat,
  onFav,
}: {
  meal: Meal & { ingredients: MealIngredient[] };
  onClose: () => void;
  onEdit: () => void;
  onEat: (servings: number) => void;
  onFav: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [custom, setCustom] = useState('');
  const factor = custom !== '' ? Math.max(0, parseFloat(custom.replace(',', '.')) || 0) : scale;
  const perServing = useMemo(() => mealTotals(meal.ingredients, meal.servings).perServing, [meal]);
  const total = { calories: perServing.calories * meal.servings * factor, protein_g: perServing.protein_g * meal.servings * factor, carbs_g: perServing.carbs_g * meal.servings * factor, fat_g: perServing.fat_g * meal.servings * factor };
  const goalColor = GOAL_COLOR[meal.goal ?? 'any'] ?? Void.textSecondary;
  const ingFactor = factor;
  return (
    <Sheet visible onClose={onClose} style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderLeft}>
              <View style={[styles.dGoalDot, { backgroundColor: goalColor }]} />
              <Text style={styles.modalTitle}>{meal.name}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <X color={Void.textSecondary} size={22} />
            </Pressable>
          </View>

          <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
            {meal.image_uri && (
              <Image source={{ uri: meal.image_uri }} style={styles.modalHero} contentFit="cover" cachePolicy="memory-disk" transition={150} />
            )}
            {meal.meal_type && (
              <View style={styles.dMealTags}>
                <Text style={[styles.dMealTag, { borderColor: Void.accent, color: Void.accent }]}>{MEAL_TYPE_LABEL[meal.meal_type].toUpperCase()}</Text>
              </View>
            )}
            {!!meal.pitch && <Text style={styles.modalPitch}>{meal.pitch}</Text>}
            {!!meal.description && !meal.pitch && <Text style={styles.modalPitch}>{meal.description}</Text>}
            {meal.tags.length > 0 && (
              <View style={styles.dMealTags}>
                {meal.tags.map((t) => (
                  <Text key={t} style={styles.dMealTag}>{t}</Text>
                ))}
              </View>
            )}

            {/* Scale the whole recipe */}
            <View style={styles.scalerCard}>
              <Text style={styles.scalerLabel}>SCALE RECIPE</Text>
              <View style={styles.scalerChips}>
                {SCALE_OPTS.map((s) => (
                  <Pressable key={s} style={[styles.scalerChip, custom === '' && factor === s && styles.scalerChipOn]} onPress={() => { setCustom(''); setScale(s); }}>
                    <Text style={[styles.scalerChipText, custom === '' && factor === s && { color: Void.accent }]}>×{s}</Text>
                  </Pressable>
                ))}
                <View style={[styles.scalerChip, styles.scalerChipCustom, custom !== '' && styles.scalerChipOn]}>
                  <Text style={styles.scalerChipText}>×</Text>
                  <TextInput
                    style={styles.scalerChipInput}
                    value={custom}
                    onChangeText={setCustom}
                    keyboardType="decimal-pad"
                    placeholder="?"
                    placeholderTextColor={Void.textTertiary}
                  />
                </View>
              </View>
              <Text style={styles.scalerPerLabel}>PER SERVING</Text>
              <View style={styles.macroTileRow}>
                {([
                  ['KCAL', perServing.calories, Void.text],
                  ['PROTEIN', Math.round(perServing.protein_g), '#6EA8FF'],
                  ['CARBS', Math.round(perServing.carbs_g), '#FFB84D'],
                  ['FAT', Math.round(perServing.fat_g), '#FF7A7A'],
                ] as const).map(([l, v, c]) => (
                  <View key={l} style={styles.macroTile}>
                    <Text style={[styles.macroTileVal, { color: c }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{v}</Text>
                    <Text style={styles.macroTileLabel}>{l}{l !== 'KCAL' ? 'G' : ''}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.scalerTotals}>
                <Text style={styles.scalerTotalLabel}>BATCH · ×{factor}</Text>
                <Text style={styles.scalerTotalVal}>{Math.round(total.calories)} kcal · {Math.round(total.protein_g)}P · {Math.round(total.carbs_g)}C · {Math.round(total.fat_g)}F</Text>
              </View>
              <MacroBar p={perServing.protein_g} c={perServing.carbs_g} f={perServing.fat_g} />
            </View>

            <Text style={styles.modalSectionLabel}>INGREDIENTS · {meal.ingredients.length}</Text>
            <View style={styles.ingCard}>
              {meal.ingredients.map((ing, j) => {
                const q = ing.quantity != null ? Math.round(ing.quantity * ingFactor * 10) / 10 : null;
                return (
                  <View key={ing.id} style={[styles.ingRow, j < meal.ingredients.length - 1 && styles.ingBorder]}>
                    <Text style={styles.ingName}>{ing.name}</Text>
                    <Text style={styles.ingQty}>{q != null ? `${q}${ing.unit ? ' ' + ing.unit : ''}` : '-'}</Text>
                  </View>
                );
              })}
            </View>

            {meal.method.length > 0 && (
              <>
                <Text style={styles.modalSectionLabel}>METHOD · {meal.method.length} STEPS</Text>
                <View style={styles.methodCard}>
                  {meal.method.map((s, j) => (
                    <View key={j} style={[styles.methodStep, j < meal.method.length - 1 && styles.ingBorder]}>
                      <Text style={styles.methodNum}>{j + 1}</Text>
                      <Text style={styles.methodText}>{s}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </ScrollView>

          <View style={styles.modalActions}>
            <Pressable style={[styles.modalActionBtn, meal.is_favourite && styles.modalActionOn]} onPress={onFav}>
              <Star color={meal.is_favourite ? Void.accent : Void.textSecondary} fill={meal.is_favourite ? Void.accent : 'transparent'} size={16} />
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.modalActionText, meal.is_favourite && { color: Void.accent }]}>{meal.is_favourite ? 'FAVOURITED' : 'FAVOURITE'}</Text>
            </Pressable>
            <Pressable style={styles.modalActionBtn} onPress={onEdit}>
              <Text style={styles.modalActionText}>EDIT</Text>
            </Pressable>
            <Pressable style={[styles.modalActionBtn, styles.modalActionPrimary]} onPress={() => onEat(factor)}>
              <Utensils color={Void.accentText} size={18} />
              <Text style={[styles.modalActionText, styles.modalActionPrimaryText]}>{factor === 1 ? 'EAT' : `EAT ×${factor}`}</Text>
            </Pressable>
          </View>
    </Sheet>
  );
}


function RecommendedMealRow({ rec, saved, onSave }: { rec: RecommendedMeal; saved: boolean; onSave: () => void }) {
  return (
    <View style={styles.recRow}>
      <View style={{ flex: 1 }}>
        <View style={styles.recTitleRow}>
          <Text style={styles.recTitle} numberOfLines={1}>
            {rec.name}
          </Text>
          <View style={styles.recBadge}>
            <Text style={styles.recBadgeText}>{rec.goal === 'any' ? 'ALL' : rec.goal.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.recMeta}>
          {recKcal(rec)} kcal · {recProt(rec)} g protein · {rec.minutes} min
        </Text>
      </View>
      <Pressable style={[styles.recSave, saved && styles.recSaveDone]} disabled={saved} onPress={onSave} hitSlop={8}>
        {saved ? <Star color={Void.accent} fill={Void.accent} size={14} /> : <Plus color={Void.accent} size={18} />}
      </Pressable>
    </View>
  );
}

const GOAL_COLOR: Record<string, string> = { cut: '#FF5C5C', maintain: '#7DD3FC', bulk: Void.accent, any: Void.textSecondary };
const FAT_C = '#FFB800';
const CARB_C = '#7DD3FC';

function MacroBar({ p, c, f }: { p: number; c: number; f: number }) {
  const total = p * 4 + c * 4 + f * 9;
  if (total === 0) return null;
  const pp = (p * 4) / total;
  const cp = (c * 4) / total;
  const fp = (f * 9) / total;
  return (
    <View style={styles.macroBar}>
      <View style={[styles.macroSeg, { flex: pp, backgroundColor: Void.accent }]} />
      <View style={[styles.macroSeg, { flex: cp, backgroundColor: CARB_C }]} />
      <View style={[styles.macroSeg, { flex: fp, backgroundColor: FAT_C }]} />
    </View>
  );
}

function DiscoverMealCard({ rec, saved, onSave, fav, onFav }: { rec: RecommendedMeal; saved: boolean; onSave: () => void; fav: boolean; onFav: () => void }) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [custom, setCustom] = useState('');
  const factor = custom !== '' ? Math.max(0, parseFloat(custom.replace(',', '.')) || 0) : scale;
  const baseServings = rec.servings ?? 1;
  // Per-person values stay constant
  const kcalPer = recKcal(rec);
  const protPer = recProt(rec);
  const carbsPer = Math.round(rec.ingredients.reduce((s, i) => s + (i.carbs_g ?? 0), 0) / baseServings);
  const fatPer = Math.round(rec.ingredients.reduce((s, i) => s + (i.fat_g ?? 0), 0) / baseServings);
  // Batch totals scale with the recipe factor
  const kcalTotal = Math.round(kcalPer * baseServings * factor);
  const protTotal = Math.round(protPer * baseServings * factor);
  const carbsTotal = Math.round(carbsPer * baseServings * factor);
  const fatTotal = Math.round(fatPer * baseServings * factor);
  const goalColor = GOAL_COLOR[rec.goal] ?? Void.textSecondary;
  return (
    <>
      <Pressable style={styles.dMealCard} onPress={() => setOpen(true)}>
        <CardSheen radius={14} />
        <View style={styles.dMealTop}>
          <View style={[styles.dGoalDot, { backgroundColor: goalColor }]} />
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Pressable style={[styles.dFav, fav && styles.dFavOn]} onPress={onFav} hitSlop={8}>
              <Star color={fav ? Void.accent : Void.textTertiary} fill={fav ? Void.accent : 'transparent'} size={13} />
            </Pressable>
            <Pressable style={[styles.dAdd, saved && styles.dAddDone]} disabled={saved} onPress={onSave} hitSlop={8}>
              {saved ? <Star color={Void.accent} fill={Void.accent} size={14} /> : <Plus color={Void.accent} size={16} />}
            </Pressable>
          </View>
        </View>
        <Text style={styles.dMealTitle} numberOfLines={2}>
          {rec.name}
        </Text>
        <MacroBar p={protPer} c={carbsPer} f={fatPer} />
        <View style={styles.dMealStats}>
          <Text style={styles.dMealStat}>{kcalPer} kcal</Text>
          <Text style={styles.dMealStatDot}>·</Text>
          <Text style={styles.dMealStat}>{recProt(rec)}g P</Text>
          <Text style={styles.dMealStatDot}>·</Text>
          <View style={styles.dMealTime}>
            <Clock color={Void.textTertiary} size={10} />
            <Text style={styles.dMealStat}> {rec.minutes}m</Text>
          </View>
        </View>
      </Pressable>

      <Sheet visible={open} onClose={() => setOpen(false)} style={styles.modalSheet}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <View style={[styles.dGoalDot, { backgroundColor: goalColor }]} />
                <Text style={styles.modalTitle}>{rec.name}</Text>
              </View>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <X color={Void.textSecondary} size={22} />
              </Pressable>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {/* Pitch */}
              <Text style={styles.modalPitch}>{rec.pitch}</Text>

              {/* Tags */}
              {rec.tags.length > 0 && (
                <View style={styles.dMealTags}>
                  {rec.tags.map((t) => (
                    <Text key={t} style={styles.dMealTag}>
                      {t}
                    </Text>
                  ))}
                </View>
              )}

              {/* Scale the whole recipe */}
              <View style={styles.scalerCard}>
                <Text style={styles.scalerLabel}>SCALE RECIPE</Text>
                <View style={styles.scalerChips}>
                  {SCALE_OPTS.map((s) => (
                    <Pressable key={s} style={[styles.scalerChip, custom === '' && factor === s && styles.scalerChipOn]} onPress={() => { setCustom(''); setScale(s); }}>
                      <Text style={[styles.scalerChipText, custom === '' && factor === s && { color: Void.accent }]}>×{s}</Text>
                    </Pressable>
                  ))}
                  <View style={[styles.scalerChip, styles.scalerChipCustom, custom !== '' && styles.scalerChipOn]}>
                    <Text style={styles.scalerChipText}>×</Text>
                    <TextInput
                      style={styles.scalerChipInput}
                      value={custom}
                      onChangeText={setCustom}
                      keyboardType="decimal-pad"
                      placeholder="?"
                      placeholderTextColor={Void.textTertiary}
                    />
                  </View>
                </View>
                <Text style={styles.scalerPerLabel}>PER SERVING</Text>
                <View style={styles.macroTileRow}>
                  {([
                    ['KCAL', kcalPer, Void.text],
                    ['PROTEIN', protPer, '#6EA8FF'],
                    ['CARBS', carbsPer, '#FFB84D'],
                    ['FAT', fatPer, '#FF7A7A'],
                  ] as const).map(([l, v, c]) => (
                    <View key={l} style={styles.macroTile}>
                      <Text style={[styles.macroTileVal, { color: c }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{v}</Text>
                      <Text style={styles.macroTileLabel}>{l}{l !== 'KCAL' ? 'G' : ''}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.scalerTotals}>
                  <Text style={styles.scalerTotalLabel}>BATCH · ×{factor}</Text>
                  <Text style={styles.scalerTotalVal}>{kcalTotal} kcal · {protTotal}P · {carbsTotal}C · {fatTotal}F</Text>
                </View>
                <MacroBar p={protPer} c={carbsPer} f={fatPer} />
              </View>

              {/* Ingredients */}
              <Text style={styles.modalSectionLabel}>INGREDIENTS · {rec.ingredients.length}</Text>
              <View style={styles.ingCard}>
                {rec.ingredients.map((ing, j) => {
                  const q = ing.quantity != null ? Math.round(ing.quantity * factor * 10) / 10 : null;
                  return (
                    <View key={j} style={[styles.ingRow, j < rec.ingredients.length - 1 && styles.ingBorder]}>
                      <Text style={styles.ingName}>{ing.name}</Text>
                      <Text style={styles.ingQty}>{q != null ? `${q}${ing.unit ? ' ' + ing.unit : ''}` : '-'}</Text>
                    </View>
                  );
                })}
              </View>

              {/* Method */}
              <Text style={styles.modalSectionLabel}>METHOD · {rec.method.length} STEPS</Text>
              <View style={styles.methodCard}>
                {rec.method.map((s, j) => (
                  <View key={j} style={[styles.methodStep, j < rec.method.length - 1 && styles.ingBorder]}>
                    <Text style={styles.methodNum}>{j + 1}</Text>
                    <Text style={styles.methodText}>{s}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* Action bar */}
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalActionBtn, fav && styles.modalActionOn]} onPress={onFav}>
                <Star color={fav ? Void.accent : Void.textSecondary} fill={fav ? Void.accent : 'transparent'} size={18} />
                <Text style={[styles.modalActionText, fav && { color: Void.accent }]}>{fav ? 'FAVOURITED' : 'FAVOURITE'}</Text>
              </Pressable>
              <Pressable style={[styles.modalActionBtn, styles.modalActionPrimary, saved && styles.modalActionDone]} disabled={saved} onPress={onSave}>
                {saved ? <Star color={Void.accent} fill={Void.accent} size={18} /> : <Plus color={Void.accentText} size={18} />}
                <Text style={[styles.modalActionText, styles.modalActionPrimaryText, saved && { color: Void.accent }]}>{saved ? 'SAVED' : 'SAVE TO MY MEALS'}</Text>
              </Pressable>
            </View>
      </Sheet>
    </>
  );
}

function DiscoverPlanCard({ plan, saved, onSave }: { plan: RecommendedPlan; saved: boolean; onSave: (items: RecommendedPlan['items']) => void }) {
  const [open, setOpen] = useState(false);
  // Editable copy of the plan's items - swap meals before saving.
  const [items, setItems] = useState<RecommendedPlan['items']>(plan.items);
  const [swapping, setSwapping] = useState<number | null>(null);
  useEffect(() => {
    if (open) setItems(plan.items);
  }, [open, plan.items]);
  const goalColor = GOAL_COLOR[plan.goal] ?? Void.textSecondary;
  const totalKcal = items.reduce((s, item) => {
    const meal = RECOMMENDED_MEALS.find((r) => r.id === item.mealId);
    return s + (meal ? recKcal(meal) : 0);
  }, 0);
  const avgKcal = Math.round(totalKcal / plan.days);
  const swapMeal = (idx: number, mealId: string) => {
    setItems((cur) => cur.map((it, j) => (j === idx ? { ...it, mealId } : it)));
    setSwapping(null);
  };
  return (
    <>
      <Pressable style={styles.dPlanCard} onPress={() => setOpen(true)}>
        <CardSheen radius={16} />
        <View style={styles.dPlanHead}>
          <View style={{ flex: 1 }}>
            <View style={styles.dPlanTitleRow}>
              <View style={[styles.dGoalDot, { backgroundColor: goalColor }]} />
              <Text style={styles.dPlanName}>{plan.name}</Text>
            </View>
            <Text style={styles.dPlanPitch}>{plan.pitch}</Text>
          </View>
          <Pressable style={[styles.dAdd, saved && styles.dAddDone]} disabled={saved} onPress={() => onSave(items)} hitSlop={8}>
            {saved ? <Star color={Void.accent} fill={Void.accent} size={16} /> : <Plus color={Void.accent} size={18} />}
          </Pressable>
        </View>
        <View style={styles.dPlanStats}>
          <View style={styles.dPlanStat}>
            <Text style={styles.dPlanStatVal}>{plan.days}</Text>
            <Text style={styles.dPlanStatLabel}>DAYS</Text>
          </View>
          <View style={styles.dPlanStat}>
            <Text style={styles.dPlanStatVal}>{plan.items.length}</Text>
            <Text style={styles.dPlanStatLabel}>MEALS</Text>
          </View>
          <View style={styles.dPlanStat}>
            <Text style={styles.dPlanStatVal}>{avgKcal}</Text>
            <Text style={styles.dPlanStatLabel}>KCAL/DAY</Text>
          </View>
          <View style={styles.dPlanStat}>
            <Text style={[styles.dPlanStatVal, { color: goalColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{plan.goal.toUpperCase()}</Text>
            <Text style={styles.dPlanStatLabel}>GOAL</Text>
          </View>
        </View>
        {/* Mini week preview */}
        <View style={styles.dPlanPreview}>
          {Array.from({ length: plan.days }, (_, d) => {
            const count = items.filter((i) => i.day === d).length;
            return (
              <View key={d} style={styles.dPlanDayDot}>
                <Text style={styles.dPlanDayNum}>{d + 1}</Text>
                <View style={styles.dPlanDayDots}>
                  {Array.from({ length: count }, (_, j) => (
                    <View key={j} style={styles.dPlanDot} />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      </Pressable>

      <Sheet visible={open} onClose={() => setOpen(false)} style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <View style={[styles.dGoalDot, { backgroundColor: goalColor }]} />
                <Text style={styles.modalTitle}>{plan.name}</Text>
              </View>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <X color={Void.textSecondary} size={22} />
              </Pressable>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.modalPitch}>{plan.pitch}</Text>

              <View style={styles.dPlanStats}>
                <View style={styles.dPlanStat}>
                  <Text style={styles.dPlanStatVal}>{plan.days}</Text>
                  <Text style={styles.dPlanStatLabel}>DAYS</Text>
                </View>
                <View style={styles.dPlanStat}>
                  <Text style={styles.dPlanStatVal}>{plan.items.length}</Text>
                  <Text style={styles.dPlanStatLabel}>MEALS</Text>
                </View>
                <View style={styles.dPlanStat}>
                  <Text style={styles.dPlanStatVal}>{avgKcal}</Text>
                  <Text style={styles.dPlanStatLabel}>KCAL/DAY</Text>
                </View>
                <View style={styles.dPlanStat}>
                  <Text style={[styles.dPlanStatVal, { color: goalColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{plan.goal.toUpperCase()}</Text>
                  <Text style={styles.dPlanStatLabel}>GOAL</Text>
                </View>
              </View>

              {Array.from({ length: plan.days }, (_, d) => {
                const dayItems = items.map((it, idx) => ({ it, idx })).filter(({ it }) => it.day === d);
                if (dayItems.length === 0) return null;
                const dayKcal = dayItems.reduce((s, { it }) => {
                  const meal = RECOMMENDED_MEALS.find((r) => r.id === it.mealId);
                  return s + (meal ? recKcal(meal) : 0);
                }, 0);
                return (
                  <View key={d} style={styles.planDayBlock}>
                    <View style={styles.planDayHeader}>
                      <Text style={styles.planDayLabel}>DAY {d + 1}</Text>
                      <Text style={styles.planDayKcal}>{dayKcal} kcal</Text>
                    </View>
                    {dayItems.map(({ it, idx }) => {
                      const meal = RECOMMENDED_MEALS.find((r) => r.id === it.mealId);
                      return (
                        <Pressable key={idx} style={styles.planMealRow} onPress={() => setSwapping(idx)}>
                          <View style={[styles.planSlotDot, { backgroundColor: goalColor }]} />
                          <Text style={styles.planSlotText}>{SLOT_LABEL[it.slot]}</Text>
                          <Text style={styles.planMealName} numberOfLines={1}>
                            {meal?.name ?? 'Unknown'}
                          </Text>
                          <Text style={styles.planMealKcal}>{meal ? recKcal(meal) : 0}</Text>
                          <Text style={styles.planSwapHint}>SWAP</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </ScrollView>

            {/* Swap picker - other recommended meals for the same slot */}
            <Sheet
              visible={swapping != null}
              onClose={() => setSwapping(null)}
              title={swapping != null ? `SWAP ${SLOT_LABEL[items[swapping].slot].toUpperCase()}` : 'SWAP'}>
              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                {RECOMMENDED_MEALS.filter((r) => swapping != null && r.id !== items[swapping].mealId).map((r) => (
                  <Pressable key={r.id} style={styles.logMealPickRow} onPress={() => swapping != null && swapMeal(swapping, r.id)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.logFoodName} numberOfLines={1}>{r.name}</Text>
                      <Text style={styles.logFoodMeta}>{recKcal(r)} kcal · {recProt(r)}g protein · {r.minutes} min</Text>
                    </View>
                    <Plus color={Void.accent} size={16} />
                  </Pressable>
                ))}
              </ScrollView>
            </Sheet>

            <View style={styles.modalActions}>
              <Pressable style={[styles.modalActionBtn, styles.modalActionPrimary, saved && styles.modalActionDone]} disabled={saved} onPress={() => onSave(items)}>
                {saved ? <Star color={Void.accent} fill={Void.accent} size={18} /> : <Plus color={Void.accentText} size={18} />}
                <Text style={[styles.modalActionText, styles.modalActionPrimaryText, saved && { color: Void.accent }]}>{saved ? 'SAVED' : 'SAVE PLAN'}</Text>
              </Pressable>
            </View>
      </Sheet>
    </>
  );
}

// -- Log Segment -------------------------------------------------------------

function LogSegment({
  todayFoods,
  todayTotals,
  target,
  meals,
  userId,
  foodImages,
  onScan,
  onManual,
  onEatMeal,
  onDeleteFood,
  burned,
}: {
  todayFoods: NutritionEntry[];
  todayTotals: DayTotals;
  target: number | null;
  burned: number;
  meals: MealWithMacros[];
  userId: string | null;
  foodImages: Map<string, string>;
  onScan: () => void;
  onManual: () => void;
  onEatMeal: (m: MealWithMacros) => void;
  onDeleteFood: (id: string) => void;
}) {
  const [showMealPicker, setShowMealPicker] = useState(false);
  const calPct = target != null && todayTotals.calories > 0 ? Math.round((todayTotals.calories / target) * 100) : 0;
  const remaining = target != null ? target - todayTotals.calories : null;

  return (
    <>
      {/* Today's summary */}
      <Card style={{ padding: 16, marginBottom: 12 }}>
        <Text style={styles.logDate}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()}</Text>
        <View style={styles.logSummaryRow}>
          <View style={styles.logSummaryCell}>
            <Text style={styles.logSummaryVal}>{todayTotals.calories}</Text>
            <Text style={styles.logSummaryLabel}>EATEN</Text>
          </View>
          <View style={styles.logSummaryCell}>
            <Text style={[styles.logSummaryVal, { color: remaining != null && remaining < 0 ? Void.danger : Void.accent }]}>
              {remaining != null ? (remaining >= 0 ? remaining : `+${Math.abs(remaining)}`) : '-'}
            </Text>
            <Text style={styles.logSummaryLabel}>{remaining != null ? (remaining >= 0 ? 'LEFT' : 'OVER') : 'NO TARGET'}</Text>
          </View>
          <View style={styles.logSummaryCell}>
            <Text style={styles.logSummaryVal}>{target ?? '-'}</Text>
            <Text style={styles.logSummaryLabel}>TARGET</Text>
          </View>
          <View style={styles.logSummaryCell}>
            <Text style={[styles.logSummaryVal, { color: '#FFB800' }]}>{burned > 0 ? burned : '-'}</Text>
            <Text style={styles.logSummaryLabel}>BURNED</Text>
          </View>
        </View>
        {/* Progress bar */}
        {target != null && (
          <View style={styles.logBar}>
            <View style={[styles.logBarFill, { width: `${Math.min(100, calPct)}%`, backgroundColor: calPct > 100 ? Void.danger : Void.accent }]} />
          </View>
        )}
        {/* Macros */}
        <View style={styles.logMacroRow}>
          <Text style={styles.logMacroItem}>Protein {Math.round(todayTotals.protein_g)}g</Text>
          <Text style={styles.logMacroItem}>Carbs {Math.round(todayTotals.carbs_g)}g</Text>
          <Text style={styles.logMacroItem}>Fat {Math.round(todayTotals.fat_g)}g</Text>
          <Text style={styles.logMacroItem}>Sugar {Math.round(todayTotals.sugar_g)}g</Text>
        </View>
      </Card>

      {/* Quick add buttons */}
      <View style={styles.logActions}>
        <Pressable style={styles.logActionBtn} onPress={onScan}>
          <ScanLine color={Void.accentText} size={18} />
          <Text style={styles.logActionText}>SCAN</Text>
        </Pressable>
        <Pressable style={styles.logActionBtn} onPress={onManual}>
          <Plus color={Void.accentText} size={18} />
          <Text style={styles.logActionText}>ADD FOOD</Text>
        </Pressable>
        <Pressable style={styles.logActionBtn} onPress={() => setShowMealPicker(true)}>
          <Utensils color={Void.accentText} size={18} />
          <Text style={styles.logActionText}>EAT MEAL</Text>
        </Pressable>
      </View>

      {/* Today's food log */}
      <SectionLabel>TODAY'S LOG</SectionLabel>
      {todayFoods.length === 0 ? (
        <Text style={styles.logEmpty}>Nothing logged yet. Scan a barcode, add food manually, or eat a meal.</Text>
      ) : (
        <Card style={{ paddingVertical: 6 }}>
          {todayFoods.map((f, i) => (
            <View key={f.id} style={[styles.logFoodRow, i < todayFoods.length - 1 && styles.logFoodBorder]}>
              {f.barcode && foodImages.get(f.barcode) && (
                <Image source={{ uri: foodImages.get(f.barcode)! }} style={styles.foodThumb} contentFit="cover" cachePolicy="memory-disk" transition={150} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.logFoodName} numberOfLines={1}>{f.name}</Text>
                <Text style={styles.logFoodMeta}>
                  {f.is_drink ? 'DRINK · ' : ''}{f.calories} kcal · {Math.round(f.protein_g)}g protein · {Math.round(f.carbs_g)}g carbs · {Math.round(f.fat_g)}g fat
                  {f.sugar_g > 0 ? ` · ${Math.round(f.sugar_g)}g sugar` : ''}
                  {f.serving ? ` · ${f.serving}` : ''}
                </Text>
              </View>
              <Pressable onPress={() => onDeleteFood(f.id)} hitSlop={8}>
                <Trash2 color={Void.textTertiary} size={16} />
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      {/* Meal picker modal */}
      <Sheet visible={showMealPicker} onClose={() => setShowMealPicker(false)} title="EAT A MEAL" style={styles.crSheet}>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              {meals.length === 0 ? (
                <Text style={styles.logEmpty}>No saved meals. Create one in the Meals tab first.</Text>
              ) : (
                meals.map((m) => (
                  <Pressable
                    key={m.id}
                    style={styles.logMealPickRow}
                    onPress={() => {
                      setShowMealPicker(false);
                      onEatMeal(m);
                    }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.logFoodName} numberOfLines={1}>{m.name}</Text>
                      <Text style={styles.logFoodMeta}>{m.perServing.calories} kcal · {Math.round(m.perServing.protein_g)}g protein · {Math.round(m.perServing.carbs_g)}g carbs · {Math.round(m.perServing.fat_g)}g fat</Text>
                    </View>
                    <Utensils color={Void.accent} size={16} />
                  </Pressable>
                ))
              )}
            </ScrollView>
            <View style={styles.crActions}>
              <Pressable onPress={() => setShowMealPicker(false)} style={[styles.crBtn, styles.crBtnAccent]}>
                <Text style={[styles.crBtnText, { color: Void.accentText }]}>CLOSE</Text>
              </Pressable>
            </View>
      </Sheet>
    </>
  );
}

// -- Create Recipe / Plan Modal ---------------------------------------------

interface DraftIngredient {
  name: string;
  quantity: string;
  unit: string;
  calories: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
  barcode?: string | null;
}

function CreateRecipeModal({
  visible,
  segment,
  userId,
  onClose,
  onSaved,
}: {
  visible: boolean;
  segment: Segment;
  userId: string | null;
  onClose: () => void;
  onSaved: (id: string, kind: 'meal' | 'plan') => void;
}) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [pitch, setPitch] = useState('');
  const [servings, setServings] = useState('1');
  const [days, setDays] = useState('7');
  const [minutes, setMinutes] = useState('');
  const [goal, setGoal] = useState<'cut' | 'maintain' | 'bulk' | 'any'>('any');
  const [mealType, setMealType] = useState<MealType | null>(null);
  const [tags, setTags] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [scanIng, setScanIng] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [ingredients, setIngredients] = useState<DraftIngredient[]>([
    { name: '', quantity: '', unit: 'g', calories: '', protein_g: '', carbs_g: '', fat_g: '' },
  ]);
  const [steps, setSteps] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName(''); setDesc(''); setPitch(''); setServings('1'); setDays('7'); setMinutes('');
    setGoal('any'); setMealType(null); setTags(''); setSourceUrl(''); setImageUri(null);
    setLinkUrl(''); setLinkBusy(false);
    setIngredients([{ name: '', quantity: '', unit: 'g', calories: '', protein_g: '', carbs_g: '', fat_g: '' }]);
    setSteps(['']); setSaving(false);
  };

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [4, 3] });
    if (!res.canceled && res.assets[0]) setImageUri(res.assets[0].uri);
  };

  // Paste-a-link inside the form - pulls the recipe and prefills every field.
  const importLink = async () => {
    const url = normaliseUrl(linkUrl);
    if (!url) { notify('Not a link', { body: 'Paste a full URL to a recipe page.', tone: 'error' }); return; }
    setLinkBusy(true);
    try {
      const found = await importRecipesFromUrl(url);
      const r = found[0];
      if (!r) {
        notify('No recipe found', { body: "That page doesn't publish structured recipe data.", tone: 'error' });
        return;
      }
      setName(r.name); setDesc(r.description ?? ''); setTags(r.tags.join(', '));
      setSourceUrl(r.sourceUrl); setLinkUrl('');
      if (r.servings) setServings(String(r.servings));
      if (r.imageUrl) setImageUri(r.imageUrl);
      setMealType(mealTypeFromTags(r.tags));
      if (r.ingredients.length) {
        setIngredients(r.ingredients.map((i) => ({
          name: i.name, quantity: i.quantity != null ? String(i.quantity) : '', unit: i.unit ?? '',
          calories: i.calories != null ? String(Math.round(i.calories)) : '',
          protein_g: i.protein_g != null ? String(Math.round(i.protein_g * 10) / 10) : '',
          carbs_g: i.carbs_g != null ? String(Math.round(i.carbs_g * 10) / 10) : '',
          fat_g: i.fat_g != null ? String(Math.round(i.fat_g * 10) / 10) : '',
        })));
      }
      if (r.method.length) setSteps(r.method);
      notify('Imported', { body: `${r.name} - check the fields, then create.`, tone: 'success' });
    } catch (e) {
      notify("Couldn't reach that page", { body: e instanceof Error ? e.message : 'Check the link and your connection.', tone: 'error' });
    } finally {
      setLinkBusy(false);
    }
  };

  // Barcode → prefilled ingredient row (every field stays editable).
  const onScanIngredient = (code: string, product: FoodProduct | null) => {
    setScanIng(false);
    const row: DraftIngredient = product
      ? {
          name: product.brand ? `${product.name} (${product.brand})` : product.name,
          quantity: '100',
          unit: product.is_drink ? 'ml' : 'g',
          calories: String(product.per100g.calories),
          protein_g: String(product.per100g.protein_g),
          carbs_g: String(product.per100g.carbs_g),
          fat_g: String(product.per100g.fat_g),
          barcode: code,
        }
      : { name: '', quantity: '', unit: 'g', calories: '', protein_g: '', carbs_g: '', fat_g: '', barcode: code };
    setIngredients((s) => (s.length === 1 && !s[0].name.trim() ? [row] : [...s, row]));
    if (!product) notify('Not in database', { body: `Barcode ${code} isn't in Open Food Facts - enter the label values.`, tone: 'error' });
  };

  const save = async () => {
    if (!name.trim()) { notify('Name required', { body: 'Give it a name.', tone: 'error' }); return; }
    setSaving(true);
    try {
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (segment === 'meals') {
        const ings = ingredients
          .filter((i) => i.name.trim())
          .map((i) => ({
            name: i.name.trim(),
            quantity: i.quantity ? parseFloat(i.quantity) : null,
            unit: i.unit || null,
            calories: i.calories ? parseFloat(i.calories) : 0,
            protein_g: i.protein_g ? parseFloat(i.protein_g) : 0,
            carbs_g: i.carbs_g ? parseFloat(i.carbs_g) : 0,
            fat_g: i.fat_g ? parseFloat(i.fat_g) : 0,
            barcode: i.barcode ?? null,
          }));
        const method = steps.filter((s) => s.trim());
        const id = await createMeal({
          name: name.trim(),
          description: desc.trim() || null,
          pitch: pitch.trim() || null,
          servings: parseInt(servings, 10) || 1,
          minutes: minutes ? parseInt(minutes, 10) : null,
          goal,
          meal_type: mealType,
          image_uri: imageUri,
          tags: tagList,
          source_url: sourceUrl.trim() || null,
          method,
          user_id: userId,
          ingredients: ings,
        });
        reset(); onSaved(id, 'meal');
      } else {
        if (!(await allowedOrPrompt('mealPlans', await countMyMealPlans(userId)))) {
          setSaving(false);
          return;
        }
        const id = await createPlan({
          name: name.trim(),
          description: desc.trim() || null,
          pitch: pitch.trim() || null,
          days: parseInt(days, 10) || 7,
          goal,
          tags: tagList,
          user_id: userId,
        });
        reset(); onSaved(id, 'plan');
      }
    } catch (e) {
      notify('Save failed', { body: e instanceof Error ? e.message : String(e), tone: 'error' });
      setSaving(false);
    }
  };

  const GOAL_OPTS: ('cut' | 'maintain' | 'bulk' | 'any')[] = ['cut', 'maintain', 'bulk', 'any'];

  return (
    <Sheet visible={visible} onClose={onClose} title={segment === 'meals' ? 'NEW RECIPE' : 'NEW PLAN'} style={styles.crSheet}>

          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
            {/* Name */}
            <Text style={styles.crLabel}>NAME</Text>
            <TextInput style={styles.crInput} value={name} onChangeText={setName} placeholder={segment === 'meals' ? 'Chicken & rice' : 'Cut week plan'} placeholderTextColor={Void.textTertiary} autoFocus />

            {/* Pitch */}
            <Text style={styles.crLabel}>PITCH (OPTIONAL)</Text>
            <TextInput style={styles.crInput} value={pitch} onChangeText={setPitch} placeholder="One-line sell, e.g. '40 g protein, 5 min prep'" placeholderTextColor={Void.textTertiary} multiline />

            {/* Description */}
            <Text style={styles.crLabel}>DESCRIPTION (OPTIONAL)</Text>
            <TextInput style={styles.crInput} value={desc} onChangeText={setDesc} placeholder="Short description…" placeholderTextColor={Void.textTertiary} multiline />

            {/* Meal type */}
            {segment === 'meals' && (
              <>
                <Text style={styles.crLabel}>WHICH MEAL</Text>
                <View style={styles.crChips}>
                  {MEAL_TYPES.map((t) => (
                    <Pressable key={t} style={[styles.crChip, mealType === t && styles.crChipOn]} onPress={() => setMealType((cur) => (cur === t ? null : t))}>
                      <Text style={[styles.crChipText, mealType === t && { color: Void.accent }]}>{MEAL_TYPE_LABEL[t].toUpperCase()}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {/* Goal */}
            <Text style={styles.crLabel}>GOAL</Text>
            <View style={styles.crChips}>
              {GOAL_OPTS.map((g) => (
                <Pressable key={g} style={[styles.crChip, goal === g && styles.crChipOn]} onPress={() => setGoal(g)}>
                  <Text style={[styles.crChipText, goal === g && { color: Void.accent }]}>{g.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>

            {/* Tags */}
            <Text style={styles.crLabel}>TAGS (COMMA-SEPARATED)</Text>
            <TextInput style={styles.crInput} value={tags} onChangeText={setTags} placeholder="Breakfast, Meal prep, High protein" placeholderTextColor={Void.textTertiary} />

            {segment === 'meals' ? (
              <>
                {/* Servings + Minutes */}
                <View style={styles.crRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.crLabel}>SERVINGS</Text>
                    <TextInput style={styles.crInput} value={servings} onChangeText={setServings} keyboardType="number-pad" placeholder="1" placeholderTextColor={Void.textTertiary} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={styles.crLabel}>MINUTES</Text>
                    <TextInput style={styles.crInput} value={minutes} onChangeText={setMinutes} keyboardType="number-pad" placeholder="30" placeholderTextColor={Void.textTertiary} />
                  </View>
                </View>

                {/* Photo */}
                <Text style={styles.crLabel}>PHOTO (OPTIONAL)</Text>
                <Pressable style={styles.crPhotoBtn} onPress={() => void pickImage()}>
                  {imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.crPhotoPreview} contentFit="cover" />
                  ) : (
                    <>
                      <Camera color={Void.textTertiary} size={18} />
                      <Text style={styles.crPhotoText}>ADD PHOTO</Text>
                    </>
                  )}
                </Pressable>

                {/* Source URL */}
                <Text style={styles.crLabel}>SOURCE URL (OPTIONAL)</Text>
                <TextInput style={styles.crInput} value={sourceUrl} onChangeText={setSourceUrl} placeholder="https://…" placeholderTextColor={Void.textTertiary} keyboardType="url" autoCapitalize="none" />

                {/* Ingredients */}
                <View style={styles.crSectionHeader}>
                  <Text style={styles.crLabel}>INGREDIENTS</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                    <Pressable onPress={() => setScanIng(true)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <ScanBarcode color={Void.accent} size={18} />
                      <Text style={styles.crChipText}>SCAN</Text>
                    </Pressable>
                    <Pressable onPress={() => setIngredients((s) => [...s, { name: '', quantity: '', unit: 'g', calories: '', protein_g: '', carbs_g: '', fat_g: '' }])} hitSlop={6}>
                      <Plus color={Void.accent} size={20} />
                    </Pressable>
                  </View>
                </View>
                {/* Link autofill */}
                <View style={styles.linkBar}>
                  <Link2 color={Void.textTertiary} size={16} />
                  <TextInput
                    style={styles.linkInput}
                    value={linkUrl}
                    onChangeText={setLinkUrl}
                    placeholder="…or paste a recipe link to autofill"
                    placeholderTextColor={Void.textTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="go"
                    onSubmitEditing={() => void importLink()}
                    editable={!linkBusy}
                  />
                  {linkBusy ? (
                    <ActivityIndicator color={Void.accent} size="small" />
                  ) : (
                    linkUrl.length > 5 && (
                      <Pressable hitSlop={8} onPress={() => void importLink()}>
                        <Text style={styles.linkGo}>GO</Text>
                      </Pressable>
                    )
                  )}
                </View>
                {ingredients.map((ing, i) => (
                  <View key={i} style={styles.crIngRow}>
                    <TextInput
                      style={[styles.crInput, { flex: 1 }]}
                      value={ing.name}
                      onChangeText={(v) => setIngredients((s) => s.map((x, j) => (j === i ? { ...x, name: v } : x)))}
                      placeholder="Ingredient"
                      placeholderTextColor={Void.textTertiary}
                    />
                    <TextInput
                      style={[styles.crInput, { width: 60 }]}
                      value={ing.quantity}
                      onChangeText={(v) => setIngredients((s) => s.map((x, j) => (j === i ? { ...x, quantity: v } : x)))}
                      keyboardType="decimal-pad"
                      placeholder="Qty"
                      placeholderTextColor={Void.textTertiary}
                    />
                    <TextInput
                      style={[styles.crInput, { width: 50 }]}
                      value={ing.unit}
                      onChangeText={(v) => setIngredients((s) => s.map((x, j) => (j === i ? { ...x, unit: v } : x)))}
                      placeholder="unit"
                      placeholderTextColor={Void.textTertiary}
                    />
                    {ingredients.length > 1 && (
                      <Pressable onPress={() => setIngredients((s) => s.filter((_, j) => j !== i))} hitSlop={8}>
                        <Minus color={Void.textTertiary} size={18} />
                      </Pressable>
                    )}
                  </View>
                ))}

                {/* Macros (optional, per ingredient) */}
                <Text style={styles.crMacroHint}>Macros per ingredient (optional - leave blank if unknown):</Text>
                {ingredients.map((ing, i) => (
                  ing.name.trim() ? (
                    <View key={`macro-${i}`} style={styles.crMacroRow}>
                      <Text style={styles.crMacroName} numberOfLines={1}>{ing.name}</Text>
                      <TextInput
                        style={[styles.crInput, styles.crMacroInput]}
                        value={ing.calories}
                        onChangeText={(v) => setIngredients((s) => s.map((x, j) => (j === i ? { ...x, calories: v } : x)))}
                        keyboardType="decimal-pad"
                        placeholder="kcal"
                        placeholderTextColor={Void.textTertiary}
                      />
                      <TextInput
                        style={[styles.crInput, styles.crMacroInput]}
                        value={ing.protein_g}
                        onChangeText={(v) => setIngredients((s) => s.map((x, j) => (j === i ? { ...x, protein_g: v } : x)))}
                        keyboardType="decimal-pad"
                        placeholder="P"
                        placeholderTextColor={Void.textTertiary}
                      />
                      <TextInput
                        style={[styles.crInput, styles.crMacroInput]}
                        value={ing.carbs_g}
                        onChangeText={(v) => setIngredients((s) => s.map((x, j) => (j === i ? { ...x, carbs_g: v } : x)))}
                        keyboardType="decimal-pad"
                        placeholder="C"
                        placeholderTextColor={Void.textTertiary}
                      />
                      <TextInput
                        style={[styles.crInput, styles.crMacroInput]}
                        value={ing.fat_g}
                        onChangeText={(v) => setIngredients((s) => s.map((x, j) => (j === i ? { ...x, fat_g: v } : x)))}
                        keyboardType="decimal-pad"
                        placeholder="F"
                        placeholderTextColor={Void.textTertiary}
                      />
                    </View>
                  ) : null
                ))}

                {/* Method */}
                <View style={styles.crSectionHeader}>
                  <Text style={styles.crLabel}>METHOD</Text>
                  <Pressable onPress={() => setSteps((s) => [...s, ''])}>
                    <Plus color={Void.accent} size={20} />
                  </Pressable>
                </View>
                {steps.map((step, i) => (
                  <View key={i} style={styles.crStepRow}>
                    <Text style={styles.crStepNum}>{i + 1}.</Text>
                    <TextInput
                      style={[styles.crInput, { flex: 1 }]}
                      value={step}
                      onChangeText={(v) => setSteps((s) => s.map((x, j) => (j === i ? v : x)))}
                      placeholder="Describe this step…"
                      placeholderTextColor={Void.textTertiary}
                      multiline
                    />
                    {steps.length > 1 && (
                      <Pressable onPress={() => setSteps((s) => s.filter((_, j) => j !== i))} hitSlop={8}>
                        <Minus color={Void.textTertiary} size={18} />
                      </Pressable>
                    )}
                  </View>
                ))}
              </>
            ) : (
              <>
                {/* Days */}
                <Text style={styles.crLabel}>DAYS</Text>
                <TextInput style={styles.crInput} value={days} onChangeText={setDays} keyboardType="number-pad" placeholder="7" placeholderTextColor={Void.textTertiary} />
                <Text style={styles.crMacroHint}>Add meals to each day after creating the plan.</Text>
              </>
            )}
          </ScrollView>

          <View style={styles.crActions}>
            <Pressable onPress={onClose} style={styles.crBtn}>
              <Text style={styles.crBtnText}>CANCEL</Text>
            </Pressable>
            <Pressable onPress={() => void save()} style={[styles.crBtn, styles.crBtnAccent]} disabled={saving}>
              <Text style={[styles.crBtnText, { color: Void.accentText }]}>{saving ? 'SAVING…' : 'CREATE'}</Text>
            </Pressable>
          </View>
      <BarcodeScanner visible={scanIng} onClose={() => setScanIng(false)} onResult={onScanIngredient} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // Header
  targetPill: { backgroundColor: Void.accentDim, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  targetPillText: { color: Void.accent, fontSize: 12, fontWeight: '800', ...tabular },
  // Segments
  segments: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: Void.border, alignItems: 'center' },
  segmentOn: { backgroundColor: Void.accent, borderColor: Void.accent },
  segmentText: { color: Void.textSecondary, fontSize: 12, fontWeight: '800' },
  // Link bar
  linkBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Void.surface, borderWidth: 1, borderColor: Void.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 },
  linkInput: { flex: 1, color: Void.text, fontSize: 15, padding: 0 },
  linkGo: { color: Void.accent, fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  // Rows
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Void.surface, borderWidth: 1, borderColor: Void.border, borderRadius: 12, padding: 14, marginBottom: 8 },
  rowThumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: Void.surfaceRaised },
  rowCovers: { flexDirection: 'row', marginRight: -2 },
  rowCover: { width: 34, height: 52, borderRadius: 8, backgroundColor: Void.surfaceRaised, marginRight: 2 },
  rowTitle: { color: Void.text, fontSize: 15, fontWeight: '700' },
  rowMeta: { color: Void.textTertiary, fontSize: 11, marginTop: 3, ...tabular },
  reorder: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  eat: { width: 32, height: 32, borderRadius: 16, backgroundColor: Void.accent, alignItems: 'center', justifyContent: 'center' },
  // Expanded
  expanded: { backgroundColor: Void.surface, borderWidth: 1, borderColor: Void.border, borderRadius: 12, padding: 14, marginBottom: 8, marginTop: -4 },
  expDesc: { color: Void.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 10 },
  expLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginTop: 10, marginBottom: 6 },
  expIng: { paddingVertical: 4 },
  expIngName: { color: Void.text, fontSize: 13, fontWeight: '600' },
  expIngMeta: { color: Void.textTertiary, fontSize: 11, marginTop: 1, ...tabular },
  expStep: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  expStepNum: { color: Void.accent, fontSize: 12, fontWeight: '900', ...tabular },
  expStepText: { color: Void.text, fontSize: 13, lineHeight: 18, flex: 1 },
  editBtn: { marginTop: 12, borderWidth: 1, borderColor: Void.accent, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  editBtnText: { color: Void.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  scalerChips: { flexDirection: 'row', gap: 8, marginTop: 8 },
  scalerChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Void.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  scalerChipOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  scalerChipText: { color: Void.textSecondary, fontSize: 13, fontWeight: '700', ...tabular },
  scalerChipCustom: { paddingVertical: 4 },
  scalerChipInput: {
    color: Void.text,
    fontSize: 13,
    fontWeight: '700',
    paddingVertical: 4,
    minWidth: 22,
    textAlign: 'center',
    ...tabular,
  },
  importRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  importName: { flex: 1, color: Void.text, fontSize: 13, fontWeight: '600' },
  importServingsWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  importServingsInput: {
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 8,
    color: Void.text,
    width: 52,
    paddingVertical: 7,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    ...tabular,
  },
  importServingsLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  // Recommended interleave
  recDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 10 },
  recDividerLine: { flex: 1, height: 1, backgroundColor: Void.border },
  recDividerLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '800', letterSpacing: 2 },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Void.surface, borderWidth: 1, borderColor: Void.accentDim, borderRadius: 12, padding: 14, marginBottom: 8 },
  recTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recTitle: { color: Void.text, fontSize: 15, fontWeight: '700', flex: 1 },
  recBadge: { backgroundColor: Void.accentDim, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  recBadgeText: { color: Void.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  recMeta: { color: Void.textTertiary, fontSize: 11, marginTop: 3, ...tabular },
  recSave: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: Void.accent, alignItems: 'center', justifyContent: 'center' },
  recSaveDone: { backgroundColor: Void.accentDim, borderColor: Void.accent },
  // Empty
  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  emptyText: { color: Void.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  emptyCta: { marginTop: 14, borderWidth: 1, borderColor: Void.accent, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 },
  emptyCtaText: { color: Void.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  // Sort
  sortBtn: { position: 'absolute', bottom: 92, right: 20, backgroundColor: Void.surface, borderWidth: 1, borderColor: Void.border, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  sortBtnText: { color: Void.textSecondary, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  sortDoneBtn: { alignSelf: 'center', backgroundColor: Void.accent, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 9, marginBottom: 10 },
  sortDoneText: { color: Void.accentText, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  // Discover
  dSectionLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: 18, marginBottom: 10 },
  dFilterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  dFilterEmpty: { color: Void.textTertiary, fontSize: 12, paddingVertical: 8 },
  modalHero: { width: '100%', height: 160, borderRadius: 12, backgroundColor: Void.surfaceRaised, marginBottom: 12 },
  dGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // Macro bar
  macroBar: { flexDirection: 'row', height: 4, borderRadius: 2, backgroundColor: Void.surfaceRaised, overflow: 'hidden', marginTop: 8 },
  macroSeg: { height: 4 },
  // Meal card (grid)
  dMealCard: { width: '48%', ...cardChrome, borderRadius: 14, padding: 12, marginBottom: 8 },
  dMealTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  dGoalDot: { width: 8, height: 8, borderRadius: 4 },
  dAdd: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: Void.accent, alignItems: 'center', justifyContent: 'center' },
  dAddDone: { backgroundColor: Void.accentDim, borderColor: Void.accent },
  dFav: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: Void.border, alignItems: 'center', justifyContent: 'center' },
  dFavOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  dMealTitle: { color: Void.text, fontSize: 14, fontWeight: '800', letterSpacing: -0.3, lineHeight: 18, minHeight: 36 },
  dMealStats: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, flexWrap: 'wrap' },
  dMealStat: { color: Void.textTertiary, fontSize: 10, fontWeight: '600', ...tabular },
  dMealStatDot: { color: Void.border, fontSize: 10 },
  dMealTime: { flexDirection: 'row', alignItems: 'center' },
  dMealTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  dMealTag: { color: Void.textSecondary, fontSize: 9, fontWeight: '700', borderWidth: 1, borderColor: Void.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  // Plan card (full width)
  dPlanCard: { ...cardChrome, borderRadius: 16, padding: 16, marginBottom: 12 },
  dPlanHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  dPlanTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dPlanName: { color: Void.text, fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  dPlanPitch: { color: Void.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
  dPlanStats: { flexDirection: 'row', gap: 0, marginTop: 14, backgroundColor: Void.canvas, borderRadius: 10, paddingVertical: 10 },
  dPlanStat: { flex: 1, alignItems: 'center' },
  dPlanStatVal: { color: Void.text, fontSize: 16, fontWeight: '900', ...tabular },
  dPlanStatLabel: { color: Void.textTertiary, fontSize: 8, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  // Mini week preview
  dPlanPreview: { flexDirection: 'row', gap: 4, marginTop: 12, paddingHorizontal: 2 },
  dPlanDayDot: { flex: 1, alignItems: 'center' },
  dPlanDayNum: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', marginBottom: 4, ...tabular },
  dPlanDayDots: { flexDirection: 'row', gap: 2, flexWrap: 'wrap', justifyContent: 'center' },
  dPlanDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Void.accent },
  // -- Sheet content ----------------------------------------------------------
  modalSheet: { maxHeight: '88%', padding: 0 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border },
  modalHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  modalTitle: { color: Void.text, fontSize: 18, fontWeight: '900', letterSpacing: -0.5, flex: 1 },
  modalScroll: { paddingHorizontal: 20, paddingTop: 16, flexShrink: 1 },
  modalPitch: { color: Void.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 12 },
  modalSectionLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: 16, marginBottom: 8 },
  // Scaler card
  scalerCard: { backgroundColor: Void.canvas, borderRadius: 12, padding: 14, marginBottom: 4 },
  scalerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scalerLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  scalerStepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: Void.surface, borderWidth: 1, borderColor: Void.border, borderRadius: 10, padding: 3 },
  scalerBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: Void.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  scalerVal: { color: Void.text, fontSize: 16, fontWeight: '900', minWidth: 36, textAlign: 'center', ...tabular },
  scalerTotals: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Void.border },
  scalerTotalLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  scalerTotalVal: { color: Void.text, fontSize: 13, fontWeight: '700', ...tabular },
  scalerPerPerson: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  scalerPerLabel: { color: Void.accent, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  scalerPerVal: { color: Void.text, fontSize: 13, fontWeight: '700', ...tabular },
  macroTileRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  macroTile: { flex: 1, backgroundColor: Void.canvas, borderWidth: 1, borderColor: Void.border, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  macroTileVal: { fontSize: 16, fontWeight: '900', ...tabular },
  macroTileLabel: { color: Void.textTertiary, fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 2 },
  // Ingredients card
  ingCard: { backgroundColor: Void.canvas, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 14 },
  ingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  ingBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border },
  ingName: { color: Void.text, fontSize: 14, fontWeight: '600', flex: 1 },
  ingQty: { color: Void.accent, fontSize: 14, fontWeight: '800', ...tabular },
  // Method card
  methodCard: { backgroundColor: Void.canvas, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 14, marginBottom: 16 },
  methodStep: { flexDirection: 'row', gap: 12, paddingVertical: 10 },
  methodNum: { color: Void.accent, fontSize: 14, fontWeight: '900', ...tabular },
  methodText: { color: Void.text, fontSize: 14, lineHeight: 20, flex: 1 },
  // Plan day blocks (modal)
  planDayBlock: { marginBottom: 16 },
  planDayHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  planDayLabel: { color: Void.textTertiary, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  planDayKcal: { color: Void.textSecondary, fontSize: 13, fontWeight: '700', ...tabular },
  planMealRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, backgroundColor: Void.canvas, borderRadius: 10, paddingHorizontal: 12, marginBottom: 4 },
  planSlotDot: { width: 8, height: 8, borderRadius: 4 },
  planSlotText: { color: Void.textTertiary, fontSize: 11, fontWeight: '600', width: 70 },
  planMealName: { color: Void.text, fontSize: 14, fontWeight: '600', flex: 1 },
  planMealKcal: { color: Void.textTertiary, fontSize: 12, ...tabular },
  planSwapHint: { color: Void.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1, marginLeft: 6 },
  // Modal actions
  modalActions: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Void.border },
  modalActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: Void.border, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 10 },
  modalActionOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  modalActionPrimary: { backgroundColor: Void.accent, borderColor: Void.accent },
  modalActionDone: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Void.accent },
  modalActionText: { color: Void.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, flexShrink: 1 },
  modalActionPrimaryText: { color: Void.accentText },
  // Create recipe/plan sheet
  crSheet: { width: '100%', maxWidth: 400 },
  crSub: { color: Void.textSecondary, fontSize: 12, lineHeight: 17, textAlign: 'center', marginBottom: 14 },
  crLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6, marginTop: 12 },
  crInput: { backgroundColor: Void.canvas, borderWidth: 1, borderColor: Void.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: Void.text, fontSize: 14 },
  crSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 4 },
  crIngRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 6 },
  crMacroHint: { color: Void.textTertiary, fontSize: 11, marginTop: 8, marginBottom: 4 },
  crMacroRow: { flexDirection: 'row', gap: 4, alignItems: 'center', marginBottom: 4 },
  crMacroName: { color: Void.textSecondary, fontSize: 11, flex: 1, maxWidth: 80 },
  crMacroInput: { width: 50, paddingHorizontal: 6, paddingVertical: 6, fontSize: 12 },
  crStepRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 6 },
  crStepNum: { color: Void.accent, fontSize: 14, fontWeight: '700', marginTop: 10 },
  crActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  crBtn: { flex: 1, borderWidth: 1, borderColor: Void.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  crBtnAccent: { backgroundColor: Void.accent, borderColor: Void.accent },
  crBtnText: { color: Void.textSecondary, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  crPhotoBtn: { borderWidth: 1, borderColor: Void.border, borderStyle: 'dashed', borderRadius: 10, minHeight: 56, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, overflow: 'hidden' },
  crPhotoPreview: { width: '100%', height: 120 },
  crPhotoText: { color: Void.textTertiary, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  // Log segment
  logDate: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 12 },
  logSummaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  logSummaryCell: { alignItems: 'center' },
  logSummaryVal: { color: Void.text, fontSize: 28, fontWeight: '900', ...tabular },
  logSummaryLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginTop: 2 },
  logBar: { height: 6, borderRadius: 3, backgroundColor: Void.canvas, marginTop: 12, overflow: 'hidden' },
  logBarFill: { height: '100%', borderRadius: 3 },
  logMacroRow: { flexDirection: 'row', gap: 16, marginTop: 10, justifyContent: 'center' },
  logMacroItem: { color: Void.textSecondary, fontSize: 12, fontWeight: '600' },
  logActions: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  logActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Void.accent, borderRadius: 10, paddingVertical: 12 },
  logActionText: { color: Void.accentText, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  logEmpty: { color: Void.textTertiary, fontSize: 13, textAlign: 'center', paddingVertical: 16, lineHeight: 19 },
  logFoodRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4 },
  logFoodBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border },
  logFoodName: { color: Void.text, fontSize: 14, fontWeight: '600' },
  foodThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: Void.surfaceRaised },
  logFoodMeta: { color: Void.textTertiary, fontSize: 11, marginTop: 2 },
  logMealPickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border },
  // Create modal extras
  crRow: { flexDirection: 'row' },
  crChips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  crChip: { borderWidth: 1, borderColor: Void.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  crChipOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  crChipText: { color: Void.textSecondary, fontSize: 11, fontWeight: '800' },
});


