/**
 * Hydration tracker for the Meals Log segment. Self-contained: fetches its own
 * data on focus, quick-add buttons log water, OTHER opens a modal for named
 * drinks (soda, coffee, …) with optional calories.
 */
import { useFocusEffect } from 'expo-router';
import { Droplets, GlassWater, Plus, Trash2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import {
    deleteLiquid,
    KIND_DEFAULT_NAME,
    LIQUID_KINDS,
    liquidTargetMl,
    listLiquidsForDay,
    logLiquid,
    type LiquidEntry,
    type LiquidKind,
} from '@/db/repo/liquids';
import { listMeasurements } from '@/db/repo/measurements';
import { getProfile } from '@/db/repo/settings';
import { tabular, Void } from '@/theme/tokens';

const QUICK_ML = [250, 500];

export function HydrationCard() {
  const [entries, setEntries] = useState<LiquidEntry[]>([]);
  const [target, setTarget] = useState(2000);
  const [modalOpen, setModalOpen] = useState(false);
  const [kind, setKind] = useState<LiquidKind>('water');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('330');
  const [cals, setCals] = useState('');
  const [sugar, setSugar] = useState('');

  const load = useCallback(async () => {
    const [rows, w, p] = await Promise.all([listLiquidsForDay(), listMeasurements('weight'), getProfile()]);
    setEntries(rows);
    setTarget(liquidTargetMl(w[0]?.value ?? null, p.water_target_ml));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const totalMl = entries.reduce((s, e) => s + e.amount_ml, 0);
  const pct = target > 0 ? Math.min(100, (totalMl / target) * 100) : 0;
  const litres = totalMl >= 1000 ? `${(totalMl / 1000).toFixed(1)}` : `${Math.round(totalMl)}`;

  const quickAdd = (ml: number) => void logLiquid({ amount_ml: ml }).then(load);

  // Closing without saving restores the defaults for next time.
  const closeModal = () => {
    setModalOpen(false);
    setKind('water');
    setName('');
    setAmount('330');
    setCals('');
    setSugar('');
  };

  const amountNum = parseFloat(amount.replace(',', '.'));
  const canLog = Number.isFinite(amountNum) && amountNum > 0;

  const addOther = async () => {
    if (!canLog) return;
    await logLiquid({
      kind,
      name: name.trim() || KIND_DEFAULT_NAME[kind],
      amount_ml: Math.round(amountNum),
      calories: parseFloat(cals.replace(',', '.')) || 0,
      sugar_g: parseFloat(sugar.replace(',', '.')) || 0,
    });
    closeModal();
    await load();
  };

  return (
    <Card style={{ padding: 16, marginBottom: 12 }}>
      <View style={styles.headRow}>
        <View style={styles.headLeft}>
          <View style={styles.iconTile}>
            <Droplets color={Void.accent} size={14} />
          </View>
          <Text style={styles.label}>HYDRATION</Text>
        </View>
        <Text style={styles.total} {...tabular}>
          {litres}
          <Text style={styles.totalTarget}>{totalMl >= 1000 ? ` / ${(target / 1000).toFixed(1)}L` : ` / ${target}ml`}</Text>
        </Text>
      </View>

      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>

      <View style={styles.quickRow}>
        {QUICK_ML.map((ml) => (
          <Pressable key={ml} style={styles.quickBtn} onPress={() => quickAdd(ml)}>
            <GlassWater color={Void.accentText} size={14} />
            <Text style={styles.quickText}>+{ml}ml</Text>
          </Pressable>
        ))}
        <Pressable style={[styles.quickBtn, styles.quickBtnGhost]} onPress={() => setModalOpen(true)}>
          <Plus color={Void.accent} size={14} />
          <Text style={[styles.quickText, { color: Void.accent }]}>DRINK</Text>
        </Pressable>
      </View>

      {entries.length > 0 && (
        <View style={styles.entryList}>
          {entries.map((e, i) => (
            <View key={e.id} style={[styles.entryRow, i < entries.length - 1 && styles.entryBorder]}>
              <Text style={styles.entryName} numberOfLines={1}>{e.name}</Text>
              <Text style={styles.entryMeta}>
                {e.amount_ml}ml{e.calories > 0 ? ` · ${e.calories} kcal` : ''}{e.sugar_g > 0 ? ` · ${Math.round(e.sugar_g)}g sugar` : ''}
              </Text>
              <Pressable onPress={() => void deleteLiquid(e.id).then(load)} hitSlop={8}>
                <Trash2 color={Void.textTertiary} size={14} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* Other-drink modal */}
      <Sheet visible={modalOpen} onClose={closeModal} title="LOG A DRINK">
            <View style={styles.kindGrid}>
              {LIQUID_KINDS.map((k) => (
                <Pressable
                  key={k}
                  style={[styles.kindChip, kind === k && styles.kindChipOn]}
                  onPress={() => setKind(k)}>
                  <Text style={[styles.kindText, kind === k && { color: Void.accentText }]}>
                    {KIND_DEFAULT_NAME[k].toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={KIND_DEFAULT_NAME[kind]}
              placeholderTextColor={Void.textTertiary}
            />
            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>AMOUNT (ml)</Text>
                <TextInput
                  style={styles.input}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="number-pad"
                  placeholder="330"
                  placeholderTextColor={Void.textTertiary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>CALORIES (opt)</Text>
                <TextInput
                  style={styles.input}
                  value={cals}
                  onChangeText={setCals}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={Void.textTertiary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>SUGAR g (opt)</Text>
                <TextInput
                  style={styles.input}
                  value={sugar}
                  onChangeText={setSugar}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={Void.textTertiary}
                />
              </View>
            </View>

            <Pressable
              style={[
                styles.quickBtn,
                { alignSelf: 'stretch', justifyContent: 'center', marginTop: 12 },
                !canLog && { opacity: 0.4 },
              ]}
              disabled={!canLog}
              onPress={() => void addOther()}>
              <Text style={styles.quickText}>LOG DRINK</Text>
            </Pressable>
      </Sheet>
    </Card>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconTile: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: Void.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  total: { color: Void.text, fontSize: 22, fontWeight: '700' },
  totalTarget: { color: Void.textTertiary, fontSize: 12, fontWeight: '500' },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: Void.surfaceRaised, marginTop: 10, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3, backgroundColor: Void.accent },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Void.accent,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  quickBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Void.accent },
  quickText: { color: Void.accentText, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  entryList: { marginTop: 12 },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
  entryBorder: { borderBottomWidth: 1, borderBottomColor: Void.border },
  entryName: { flex: 1, color: Void.text, fontSize: 13, fontWeight: '600' },
  entryMeta: { color: Void.textTertiary, fontSize: 11 },
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  kindChip: {
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  kindChipOn: { backgroundColor: Void.accent, borderColor: Void.accent },
  kindText: { color: Void.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  fieldRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  fieldLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 5 },
  input: {
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Void.text,
    fontSize: 14,
    backgroundColor: Void.canvas,
  },
});

