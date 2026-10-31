import { Image } from 'expo-image';
import { Check, Dumbbell, Plus, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createExercise, listExercises, listMuscles, updateExerciseTrackingType } from '@/db/repo/exercises';
import { getExerciseImageUrl } from '@/lib/exerciseImages';
import { mapEquipment, searchGitHubExercises, type SearchResult } from '@/lib/githubExerciseSearch';
import { allowedOrPrompt, countMyCustomExercises } from '@/lib/tiers';
import { classifyNameTracking } from '@/lib/trackingType';
import type { Equipment, Exercise, TrackingType } from '@/lib/types';
import { useSettings } from '@/store/settings';
import { Void } from '@/theme/tokens';

const EQUIPMENT: Equipment[] = [
  'barbell',
  'dumbbell',
  'cable',
  'machine',
  'bodyweight',
  'kettlebell',
  'band',
  'other',
];

const TRACKING: { type: TrackingType; label: string }[] = [
  { type: 'strength', label: 'Weight + reps' },
  { type: 'cardio', label: 'Cardio' },
  { type: 'hold', label: 'Timed hold' },
  { type: 'carry', label: 'Weight + distance' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onPick: (exercise: Exercise) => void;
}

export function ExercisePicker({ visible, onClose, onPick }: Props) {
  const insets = useSafeAreaInsets();
  const userId = useSettings((s) => s.supabase_user_id);
  const [query, setQuery] = useState('');
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [muscles, setMuscles] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMuscle, setNewMuscle] = useState('Other');
  const [newEquipment, setNewEquipment] = useState<Equipment>('other');
  const [newTracking, setNewTracking] = useState<TrackingType>('strength');
  const [trackingPicked, setTrackingPicked] = useState(false);
  const [ghResults, setGhResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());

  // Debounced search of the 800+ exercise database as the user types.
  useEffect(() => {
    if (query.trim().length < 2) {
      setGhResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let stale = false;
    const timer = setTimeout(async () => {
      const res = await searchGitHubExercises(query, 12);
      // Slower queries must not overwrite newer results.
      if (stale) return;
      setGhResults(res);
      setSearching(false);
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setCreating(false);
      void listExercises().then(setExercises);
      void listMuscles().then(setMuscles);
    }
  }, [visible]);

  const filtered = query
    ? exercises.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
    : exercises;

  const exactMatch = query.trim().length > 0 &&
    exercises.some((e) => e.name.toLowerCase() === query.trim().toLowerCase());

  const openCreate = () => {
    void countMyCustomExercises(userId).then((n) => {
      if (!allowedOrPrompt('customExercises', n)) return;
      setNewName(query.trim());
      setNewMuscle('Other');
      setNewEquipment('other');
      setNewTracking(classifyNameTracking(query.trim()));
      setTrackingPicked(false);
      setCreating(true);
    });
  };

  /** Pick a GitHub-database exercise: saves it to the library, then into the workout. */
  const pickRemote = async (r: SearchResult) => {
    if (addingIds.has(r.id)) return;
    setAddingIds((prev) => new Set(prev).add(r.id));
    try {
      const ex = await createExercise({
        name: r.name,
        target_muscle: r.primaryMuscles[0] || 'Other',
        secondary_muscles: r.secondaryMuscles,
        equipment: mapEquipment(r.equipment),
        tracking_type: r.trackingType,
        user_id: userId,
        github_image_id: r.id,
      });
      onPick(ex);
      onClose();
    } finally {
      // Re-enable the row even when createExercise throws.
      setAddingIds((prev) => {
        const next = new Set(prev);
        next.delete(r.id);
        return next;
      });
    }
  };

  const saveNew = async () => {
    const name = newName.trim();
    if (!name) return;
    const ex = await createExercise({
      name,
      target_muscle: newMuscle,
      equipment: newEquipment,
      tracking_type: newTracking,
      user_id: userId,
    });
    setCreating(false);
    onPick(ex);
    onClose();
  };

  const muscleOptions = muscles.includes('Other') ? muscles : [...muscles, 'Other'];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{creating ? 'NEW EXERCISE' : 'ADD EXERCISE'}</Text>
          <Pressable onPress={creating ? () => setCreating(false) : onClose} hitSlop={8}>
            <X color={Void.textSecondary} size={22} />
          </Pressable>
        </View>

        {creating ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
            <Text style={styles.fieldLabel}>NAME</Text>
            <TextInput
              style={styles.search}
              placeholder="e.g. Jefferson Curl"
              placeholderTextColor={Void.textTertiary}
              value={newName}
              onChangeText={(v) => {
                setNewName(v);
                // Name drives the tracking guess until the user picks one.
                if (!trackingPicked) setNewTracking(classifyNameTracking(v));
              }}
              autoFocus
            />
            <Text style={styles.fieldLabel}>PRIMARY MUSCLE</Text>
            <View style={styles.chips}>
              {muscleOptions.map((m) => (
                <Pressable
                  key={m}
                  style={[styles.chip, newMuscle === m && styles.chipOn]}
                  onPress={() => setNewMuscle(m)}>
                  <Text style={[styles.chipText, newMuscle === m && { color: Void.accent }]}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>TRACKS AS</Text>
            <View style={styles.chips}>
              {TRACKING.map((t) => (
                <Pressable
                  key={t.type}
                  style={[styles.chip, newTracking === t.type && styles.chipOn]}
                  onPress={() => {
                    setNewTracking(t.type);
                    setTrackingPicked(true);
                  }}>
                  <Text style={[styles.chipText, newTracking === t.type && { color: Void.accent }]}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>EQUIPMENT</Text>
            <View style={styles.chips}>
              {EQUIPMENT.map((e) => (
                <Pressable
                  key={e}
                  style={[styles.chip, newEquipment === e && styles.chipOn]}
                  onPress={() => setNewEquipment(e)}>
                  <Text style={[styles.chipText, newEquipment === e && { color: Void.accent }]}>
                    {e[0].toUpperCase() + e.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={[styles.createBtn, !newName.trim() && { opacity: 0.5 }]}
              disabled={!newName.trim()}
              onPress={() => void saveNew()}>
              <Check color={Void.accentText} size={16} />
              <Text style={styles.createBtnText}>CREATE & ADD TO WORKOUT</Text>
            </Pressable>
          </ScrollView>
        ) : (
          <>
            <TextInput
              style={styles.search}
              placeholder="Search exercises"
              placeholderTextColor={Void.textTertiary}
              value={query}
              onChangeText={setQuery}
              autoFocus={false}
            />
            <FlatList
              data={filtered}
              keyExtractor={(e) => e.id}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                query.trim().length > 1 && !exactMatch ? (
                  <Pressable style={styles.createRow} onPress={openCreate}>
                    <Plus color={Void.accent} size={16} />
                    <Text style={styles.createRowText}>Create “{query.trim()}”</Text>
                  </Pressable>
                ) : null
              }
              ListFooterComponent={
                <>
                  {searching && (
                    <View style={styles.searchingRow}>
                      <ActivityIndicator color={Void.accent} size="small" />
                      <Text style={styles.searchingText}>Searching exercise database…</Text>
                    </View>
                  )}
                  {ghResults.map((r) => {
                    // Every row adds to the routine. If the name's already in
                    // the library the existing exercise is picked; otherwise
                    // the remote result is saved to the library on the way.
                    const existing = exercises.find(
                      (e) => e.name.toLowerCase() === r.name.toLowerCase()
                    );
                    const added = addingIds.has(r.id);
                    return (
                      <Pressable
                        key={r.id}
                        style={[styles.item, styles.ghItem]}
                        disabled={added}
                        onPress={() => {
                          if (existing) {
                            // Heal a stale tag: an exercise saved before
                            // tracking_type existed (or as a custom) may be
                            // stuck on 'strength' when the database knows
                            // it's cardio/hold/carry.
                            if (
                              existing.tracking_type === 'strength' &&
                              r.trackingType !== 'strength'
                            ) {
                              void updateExerciseTrackingType(existing.id, r.trackingType);
                              onPick({ ...existing, tracking_type: r.trackingType });
                            } else {
                              onPick(existing);
                            }
                            onClose();
                            return;
                          }
                          void pickRemote(r);
                        }}>
                        {r.imageUrl ? (
                          <Image source={{ uri: r.imageUrl }} style={styles.ghThumb} contentFit="contain" cachePolicy="memory-disk" transition={150} />
                        ) : (
                          <View style={[styles.ghThumb, styles.thumbEmpty]}>
                            <Dumbbell color={Void.textTertiary} size={16} />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.itemName}>{r.name}</Text>
                          <Text style={styles.itemMeta}>
                            {r.primaryMuscles.join(', ')}
                            {r.secondaryMuscles.length > 0 ? ` + ${r.secondaryMuscles.join(', ')}` : ''} ·{' '}
                            {r.equipment || 'other'} · from database
                          </Text>
                        </View>
                        {added ? (
                          <ActivityIndicator color={Void.accent} size="small" />
                        ) : (
                          <Plus color={Void.accent} size={18} />
                        )}
                      </Pressable>
                    );
                  })}
                  <Pressable style={styles.createRow} onPress={openCreate}>
                    <Plus color={Void.accent} size={16} />
                    <Text style={styles.createRowText}>Create custom exercise</Text>
                  </Pressable>
                </>
              }
              renderItem={({ item }) => {
                const imgUrl = getExerciseImageUrl(item.id, 1, item.github_image_id);
                return (
                  <Pressable
                    style={({ pressed }) => [styles.item, styles.itemRow, pressed && styles.itemPressed]}
                    onPress={() => {
                      onPick(item);
                      onClose();
                    }}>
                    {imgUrl ? (
                      <Image source={{ uri: imgUrl }} style={styles.thumb} contentFit="contain" cachePolicy="memory-disk" transition={150} />
                    ) : (
                      <View style={[styles.thumb, styles.thumbEmpty]}>
                        <Dumbbell color={Void.textTertiary} size={16} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemMeta}>
                        {item.target_muscle} · {item.equipment}
                        {item.is_custom ? ' · custom' : ''}
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
            />
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Void.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { color: Void.text, fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  search: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: Void.surface,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: Void.text,
    fontSize: 15,
  },
  item: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Void.border,
  },
  itemPressed: { backgroundColor: Void.surface },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: Void.surface },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  itemName: { color: Void.text, fontSize: 15, fontWeight: '600' },
  itemMeta: { color: Void.textTertiary, fontSize: 12, marginTop: 2 },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Void.border,
  },
  createRowText: { color: Void.accent, fontSize: 14, fontWeight: '700' },
  fieldLabel: {
    color: Void.textTertiary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  chip: {
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipOn: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  chipText: { color: Void.textSecondary, fontSize: 13, fontWeight: '600' },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Void.accent,
    borderRadius: 12,
    paddingVertical: 15,
    marginHorizontal: 16,
    marginTop: 28,
  },
  createBtnText: { color: Void.accentText, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchingText: { color: Void.textTertiary, fontSize: 12 },
  ghItem: { gap: 12, flexDirection: 'row', alignItems: 'center' },
  ghThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: Void.surface },
});
