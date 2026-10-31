import { Image } from 'expo-image';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { ChevronLeft, Copy, Plus, ShoppingBag, Star, Trash2, Utensils } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import {
    addPlanItem,
    deletePlan,
    getMeal,
    getPlan,
    listMeals,
    removePlanItem,
    toggleMealFavourite,
    togglePlanFavourite,
    updatePlan,
    updatePlanItem,
    type MealWithMacros,
} from '@/db/repo/meals';
import { logFood } from '@/db/repo/nutrition';
import { eatMeal } from '@/lib/eatMeal';
import { formatShoppingListHtml, type ShoppingGroup, type ShoppingLine } from '@/lib/mealMath';
import type { Meal, MealIngredient, MealPlan, MealPlanItem, MealSlot } from '@/lib/types';
import { MealViewModal } from '@/app/(tabs)/meals';
import { confirm, notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { tabular, Void } from '@/theme/tokens';
import { goBack } from '@/lib/nav';

const AMBER = '#FFB800';
const CYAN = '#7DD3FC';
const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const SLOT_LABEL: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
const SLOT_ICON: Record<MealSlot, string> = { breakfast: '☀', lunch: '◐', dinner: '●', snack: '◇' };

const fmt = (v: number | null | undefined) => (v == null ? '' : Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const userId = useSettings((s) => s.supabase_user_id);
  const target = useSettings((s) => s.calorie_override);

  const [plan, setPlan] = useState<(MealPlan & { items: (MealPlanItem & { meal: MealWithMacros })[] }) | null>(null);
  const [meals, setMeals] = useState<MealWithMacros[]>([]);
  const [adding, setAdding] = useState<{ dayIndex: number; slot: MealSlot } | null>(null);
  const [editMeta, setEditMeta] = useState(false);
  const [itemAction, setItemAction] = useState<(MealPlanItem & { meal: MealWithMacros }) | null>(null);
  const [viewItem, setViewItem] = useState<{
    item: MealPlanItem & { meal: MealWithMacros };
    meal: Meal & { ingredients: MealIngredient[] };
  } | null>(null);
  const [editName, setEditName] = useState('');
  const [editDays, setEditDays] = useState('');

  const refresh = useCallback(async () => {
    if (!id) return;
    const [p, m] = await Promise.all([getPlan(id), listMeals()]);
    setPlan(p);
    setMeals(m);
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  if (!plan) return <Screen />;

  const dayKcal = (di: number) =>
    plan.items.filter((i) => i.day_index === di).reduce((s, i) => s + i.meal.perServing.calories * i.servings, 0);
  const dayProt = (di: number) =>
    Math.round(plan.items.filter((i) => i.day_index === di).reduce((s, i) => s + i.meal.perServing.protein_g * i.servings, 0));

  const applyDay = async (di: number) => {
    const items = plan.items.filter((i) => i.day_index === di);
    if (items.length === 0) return;
    for (const it of items) {
      const m = it.meal;
      const kcal = Math.round(m.perServing.calories * it.servings);
      await logFood({
        name: m.name,
        calories: kcal,
        protein_g: Math.round(m.perServing.protein_g * it.servings * 10) / 10,
        carbs_g: Math.round(m.perServing.carbs_g * it.servings * 10) / 10,
        fat_g: Math.round(m.perServing.fat_g * it.servings * 10) / 10,
        serving: `${fmt(it.servings)} × ${m.name}`,
        source: 'quick',
        user_id: userId,
      });
    }
    notify('Logged', { body: `Day ${di + 1} added to today (${Math.round(dayKcal(di))} kcal).`, tone: 'success' });
  };

  const shareShoppingList = async () => {
    // Pull real ingredient rows for every meal in the plan, scaled by the
    // servings each slot asks for, then emit one section per meal so the
    // list reads like the recipe cards instead of one flat dedupe.
    const mealIds = [...new Set(plan.items.map((i) => i.meal_id))];
    const fullMeals = await Promise.all(mealIds.map((mid) => getMeal(mid)));
    const byId = new Map(fullMeals.filter(Boolean).map((m) => [m!.id, m!]));
    const groups: ShoppingGroup[] = [];
    for (let di = 0; di < plan.days; di++) {
      const dayItems = plan.items.filter((i) => i.day_index === di);
      for (const slot of SLOTS) {
        for (const it of dayItems.filter((i) => i.slot === slot)) {
          const full = byId.get(it.meal_id);
          const lines: ShoppingLine[] =
            !full || full.ingredients.length === 0
              ? [{ name: it.meal.name, quantity: it.servings, unit: 'serving' }]
              : full.ingredients.map((ing) => ({
                  name: ing.name,
                  quantity: ing.quantity != null ? Math.round(ing.quantity * it.servings * 100) / 100 : null,
                  unit: ing.unit,
                }));
          groups.push({
            heading: `DAY ${di + 1} · ${SLOT_LABEL[slot]}`,
            title: it.meal.name,
            meta: `×${fmt(it.servings)} serving${it.servings === 1 ? '' : 's'}`,
            lines,
          });
        }
      }
    }
    const html = formatShoppingListHtml(groups, `${plan.name} - shopping list`);
    // Strip path separators and other unsafe characters from the file name.
    const safeName = plan.name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_') || 'plan';
    const file = new (await import('expo-file-system')).File((await import('expo-file-system')).Paths.cache, `${safeName}_shopping.html`);
    file.write(html);
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'text/html', dialogTitle: plan.name });
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.top}>
        <Pressable onPress={() => goBack()} hitSlop={8}>
          <ChevronLeft color={Void.text} size={24} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <Pressable
            hitSlop={8}
            onPress={() => {
              setEditName(plan.name);
              setEditDays(String(plan.days));
              setEditMeta(true);
            }}>
            <Copy color={Void.textSecondary} size={19} />
          </Pressable>
          <Pressable onPress={() => void togglePlanFavourite(plan.id).then(refresh)} hitSlop={8}>
            <Star color={plan.is_favourite ? Void.accent : Void.textTertiary} fill={plan.is_favourite ? Void.accent : 'transparent'} size={21} />
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={() =>
              void (async () => {
                const ok = await confirm({
                  title: 'Delete plan?',
                  body: plan.name,
                  confirmText: 'DELETE',
                  destructive: true,
                });
                if (!ok) return;
                await deletePlan(plan.id);
                router.back();
              })()
            }>
            <Trash2 color={Void.textTertiary} size={19} />
          </Pressable>
        </View>
      </View>

      <View style={{ paddingHorizontal: 16 }}>
        <Text style={styles.name}>{plan.name}</Text>
        {plan.description ? <Text style={styles.desc}>{plan.description}</Text> : null}
        <View style={styles.summary}>
          <Text style={styles.summaryStat}>
            <Text style={styles.summaryVal}>{plan.days}</Text> day{plan.days === 1 ? '' : 's'}
          </Text>
          <Text style={styles.summaryStat}>
            <Text style={styles.summaryVal}>{plan.items.length}</Text> meal{plan.items.length === 1 ? '' : 's'}
          </Text>
          <Text style={styles.summaryStat}>
            <Text style={styles.summaryVal}>{Math.round(plan.items.reduce((s, i) => s + i.meal.perServing.calories * i.servings, 0) / Math.max(1, plan.days))}</Text>{' '}
            kcal / day
          </Text>
        </View>
        <Pressable style={styles.shopBtn} onPress={() => void shareShoppingList()}>
          <ShoppingBag color={Void.accent} size={15} />
          <Text style={styles.shopText}>SHARE SHOPPING LIST</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 60, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        {Array.from({ length: plan.days }, (_, di) => {
          const items = plan.items.filter((i) => i.day_index === di);
          const kcal = dayKcal(di);
          const over = target != null && kcal > target;
          return (
            <View key={di} style={styles.day}>
              <View style={styles.dayHead}>
                <View>
                  <Text style={styles.dayTitle}>DAY {di + 1}</Text>
                  <Text style={[styles.dayKcal, { color: kcal === 0 ? Void.textTertiary : over ? AMBER : Void.textSecondary }]}>
                    {kcal === 0 ? 'No meals yet' : `${Math.round(kcal)} kcal · ${dayProt(di)} g protein`}
                  </Text>
                </View>
                {items.length > 0 && (
                  <Pressable style={styles.applyBtn} onPress={() => void applyDay(di)}>
                    <Utensils color={Void.accentText} size={13} />
                    <Text style={styles.applyText}>LOG DAY</Text>
                  </Pressable>
                )}
              </View>
              {SLOTS.map((slot) => {
                const slotItems = items.filter((i) => i.slot === slot);
                return (
                  <View key={slot} style={styles.slot}>
                    <Text style={styles.slotLabel}>
                      {SLOT_ICON[slot]} {SLOT_LABEL[slot]}
                    </Text>
                    {slotItems.map((it) => (
                      <View key={it.id} style={styles.slotItem}>
                        {it.meal.image_uri && (
                          <Image source={{ uri: it.meal.image_uri }} style={styles.slotThumb} contentFit="cover" cachePolicy="memory-disk" transition={150} />
                        )}
                        <Pressable
                          style={{ flex: 1 }}
                          onPress={() =>
                            void getMeal(it.meal_id).then((full) => {
                              if (full) setViewItem({ item: it, meal: full });
                            })
                          }
                          onLongPress={() => setItemAction(it)}>
                          <Text style={styles.slotItemName} numberOfLines={1}>
                            {it.meal.name}
                          </Text>
                          <Text style={styles.slotItemMeta}>
                            {fmt(it.servings)} × · {Math.round(it.meal.perServing.calories * it.servings)} kcal ·{' '}
                            {Math.round(it.meal.perServing.protein_g * it.servings)}g protein
                          </Text>
                        </Pressable>
                      </View>
                    ))}
                    <Pressable style={styles.slotAdd} onPress={() => setAdding({ dayIndex: di, slot })}>
                      <Plus color={Void.textTertiary} size={14} />
                      <Text style={styles.slotAddText}>Add {SLOT_LABEL[slot].toLowerCase()}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      {/* Add meal picker */}
      <Sheet
        visible={adding != null}
        onClose={() => setAdding(null)}
        title={adding ? `${SLOT_LABEL[adding.slot]} · DAY ${adding.dayIndex + 1}` : 'ADD MEAL'}>
        {meals.length === 0 ? (
          <Text style={styles.empty}>No meals yet. Create one first, then add it here.</Text>
        ) : (
          <ScrollView style={{ maxHeight: 460 }}>
            {meals.map((m) => (
              <Pressable
                key={m.id}
                style={styles.pickRow}
                onPress={() =>
                  void addPlanItem({ plan_id: plan.id, meal_id: m.id, day_index: adding!.dayIndex, slot: adding!.slot }).then(() => {
                    setAdding(null);
                    refresh();
                  })
                }>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickName}>{m.name}</Text>
                  <Text style={styles.pickMeta}>
                    {m.perServing.calories} kcal · {Math.round(m.perServing.protein_g)}g protein · {m.ingredientCount} ingredients
                  </Text>
                </View>
                <Plus color={Void.accent} size={18} />
              </Pressable>
            ))}
          </ScrollView>
        )}
      </Sheet>

      {/* Edit meta */}
      <Sheet visible={editMeta} onClose={() => setEditMeta(false)} title="EDIT PLAN">
        <Text style={styles.fieldLabel}>NAME</Text>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholder="Plan name"
              placeholderTextColor={Void.textTertiary}
            />
            <Text style={styles.fieldLabel}>DAYS (1-14)</Text>
            <TextInput
              style={styles.input}
              value={editDays}
              onChangeText={setEditDays}
              keyboardType="number-pad"
              placeholder="7"
              placeholderTextColor={Void.textTertiary}
            />
        <View style={styles.sheetRow}>
          <Pressable onPress={() => setEditMeta(false)} style={styles.btn}>
            <Text style={styles.btnText}>CANCEL</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnAccent]}
            onPress={() =>
              void (async () => {
                const newDays = Math.min(14, Math.max(1, parseInt(editDays, 10) || plan.days));
                await updatePlan(plan.id, {
                  name: editName.trim() || plan.name,
                  days: newDays,
                });
                // Shrinking the plan orphans items on hidden days - they would
                // keep counting toward kcal/day and the shopping list.
                if (newDays < plan.days) {
                  await Promise.all(
                    plan.items.filter((i) => i.day_index >= newDays).map((i) => removePlanItem(i.id))
                  );
                }
                setEditMeta(false);
                refresh();
              })()
            }>
            <Text style={[styles.btnText, { color: Void.accentText }]}>SAVE</Text>
          </Pressable>
        </View>
      </Sheet>

      {/* Recipe view - tap a planned meal to see ingredients + method */}
      {viewItem && (
        <MealViewModal
          meal={viewItem.meal}
          onClose={() => setViewItem(null)}
          onEdit={() => {
            const mid = viewItem.meal.id;
            setViewItem(null);
            router.push(`/meals/${mid}`);
          }}
          onFav={() =>
            void toggleMealFavourite(viewItem.meal.id).then(() => {
              setViewItem(null);
              refresh();
            })
          }
          onEat={(factor) => {
            const { item, meal } = viewItem;
            const servings = item.servings * factor;
            setViewItem(null);
            void eatMeal(item.meal, servings, userId).then(() =>
              notify('Logged', {
                body: `${meal.name} · ${Math.round(item.meal.perServing.calories * servings)} kcal added to today.`,
                tone: 'success',
              })
            );
          }}
        />
      )}

      {/* Plan item actions - long-press a meal */}
      <Sheet visible={itemAction != null} onClose={() => setItemAction(null)} title={itemAction?.meal.name.toUpperCase() ?? ''}>
        {itemAction && (
          <View style={{ gap: 10 }}>
            <Text style={styles.pickMeta}>
              {Math.round(itemAction.meal.perServing.calories * itemAction.servings)} kcal · {fmt(itemAction.servings)} serving{itemAction.servings === 1 ? '' : 's'}
            </Text>
            <Pressable
              style={[styles.btn, styles.btnAccent, { alignItems: 'center' }]}
              onPress={() =>
                void eatMeal(itemAction.meal, itemAction.servings, userId).then(() => {
                  notify('Logged', { body: `${itemAction.meal.name} added to today.`, tone: 'success' });
                  setItemAction(null);
                })
              }>
              <Text style={[styles.btnText, { color: Void.accentText }]}>EAT NOW</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnGhost, { alignItems: 'center' }]}
              onPress={() =>
                void updatePlanItem(itemAction.id, { servings: itemAction.servings !== 1 ? 1 : 2 }).then(() => {
                  setItemAction(null);
                  refresh();
                })
              }>
              <Text style={styles.btnText}>{itemAction.servings !== 1 ? 'SET 1 SERVING' : 'SET 2 SERVINGS'}</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnGhost, { alignItems: 'center' }]}
              onPress={() =>
                void removePlanItem(itemAction.id).then(() => {
                  setItemAction(null);
                  refresh();
                })
              }>
              <Text style={[styles.btnText, { color: Void.danger }]}>REMOVE FROM PLAN</Text>
            </Pressable>
          </View>
        )}
      </Sheet>
    </Screen>
  );
}

// Minimal TextInput import (the file uses it in the meta sheet)

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 6 },
  name: { color: Void.text, fontSize: 26, fontWeight: '900', letterSpacing: -0.8 },
  desc: { color: Void.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 4 },
  summary: { flexDirection: 'row', gap: 16, marginTop: 14 },
  summaryStat: { color: Void.textTertiary, fontSize: 12 },
  summaryVal: { color: Void.text, fontSize: 18, fontWeight: '900', ...tabular },
  shopBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: Void.accent, borderRadius: 10, paddingVertical: 11, marginTop: 14 },
  shopText: { color: Void.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  day: { marginTop: 22 },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  dayTitle: { color: Void.textTertiary, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  dayKcal: { color: Void.textSecondary, fontSize: 12, marginTop: 2, ...tabular },
  applyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Void.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  applyText: { color: Void.accentText, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  slot: { marginBottom: 8 },
  slotLabel: { color: Void.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6, marginLeft: 2 },
  slotItem: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Void.surface, borderWidth: 1, borderColor: Void.border, borderRadius: 10, padding: 12, marginBottom: 6 },
  slotThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: Void.surfaceRaised },
  slotItemName: { color: Void.text, fontSize: 14, fontWeight: '600' },
  slotItemMeta: { color: Void.textTertiary, fontSize: 11, marginTop: 2, ...tabular },
  slotAdd: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 4 },
  slotAddText: { color: Void.textTertiary, fontSize: 12, fontWeight: '600' },
  empty: { color: Void.textTertiary, fontSize: 13, textAlign: 'center', paddingVertical: 20, lineHeight: 19 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border },
  pickName: { color: Void.text, fontSize: 14, fontWeight: '600' },
  pickMeta: { color: Void.textTertiary, fontSize: 11, marginTop: 2, ...tabular },
  fieldLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginBottom: 6 },
  input: { backgroundColor: Void.surfaceRaised, borderWidth: 1, borderColor: Void.border, borderRadius: 10, color: Void.text, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, marginBottom: 12 },
  sheetRow: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnAccent: { backgroundColor: Void.accent },
  btnGhost: { borderWidth: 1, borderColor: Void.borderStrong },
  btnText: { color: Void.textSecondary, fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },
});
