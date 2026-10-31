import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { Check, ChevronDown, Dumbbell, Plus, SlidersHorizontal, Star, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View
} from 'react-native';

import { cardChrome, CardSheen, Screen, ScreenHeader } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import { createExercise, deleteExercise, listExercises, listMuscles, toggleFavourite } from '@/db/repo/exercises';
import { getExerciseImageUrl } from '@/lib/exerciseImages';
import { mapEquipment, searchGitHubExercises, type SearchResult } from '@/lib/githubExerciseSearch';
import { allowedOrPrompt, countMyCustomExercises } from '@/lib/tiers';
import type { Equipment, Exercise } from '@/lib/types';
import { confirm } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { Void } from '@/theme/tokens';

const EQUIPMENT: (Equipment | 'all')[] = [
  'all',
  'barbell',
  'dumbbell',
  'cable',
  'machine',
  'bodyweight',
  'kettlebell',
  'band',
  'other',
];

type SortMode = 'name' | 'muscle' | 'favourites';

const GRID_GAP = 12;
const GRID_PADDING = 16;
const TILE_RADIUS = 14;

export default function LibraryScreen() {
  const router = useRouter();
  const userId = useSettings((s) => s.supabase_user_id);
  const { width: windowWidth } = useWindowDimensions();
  const tileWidth = (windowWidth - GRID_PADDING * 2 - GRID_GAP) / 2;

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [muscles, setMuscles] = useState<string[]>([]);
  const [muscle, setMuscle] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<Equipment | 'all'>('all');
  const [query, setQuery] = useState('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>('name');
  const [filterOpen, setFilterOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // GitHub search-to-add
  const [adding, setAdding] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());
  const searchReqId = useRef(0);

  // Auto-search GitHub as user types
  useEffect(() => {
    if (!adding || !addQuery.trim() || addQuery.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const reqId = ++searchReqId.current;
    const timer = setTimeout(async () => {
      const results = await searchGitHubExercises(addQuery, 30);
      if (searchReqId.current !== reqId) return; // stale response - a newer query is in flight
      setSearchResults(results);
      setSearching(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [addQuery, adding]);

  const refresh = useCallback(async () => {
    setExercises(
      await listExercises({
        muscle: muscle ?? undefined,
        equipment: equipment === 'all' ? undefined : equipment,
        query: query || undefined,
        favouritesOnly,
        sort,
      })
    );
    setMuscles(await listMuscles());
    setVisibleCount(20);
  }, [muscle, equipment, query, favouritesOnly, sort]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const addFromGitHub = useCallback(
    async (result: SearchResult) => {
      if (addingIds.has(result.id)) return;
      setAddingIds((prev) => new Set(prev).add(result.id));
      await createExercise({
        name: result.name,
        target_muscle: result.primaryMuscles[0] || 'Other',
        secondary_muscles: result.secondaryMuscles,
        equipment: mapEquipment(result.equipment),
        user_id: userId,
        github_image_id: result.id,
      });
      void refresh();
    },
    [addingIds, userId, refresh]
  );

  const activeFilterCount =
    (muscle ? 1 : 0) + (equipment !== 'all' ? 1 : 0) + (favouritesOnly ? 1 : 0) + (sort !== 'name' ? 1 : 0);

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Screen>
      <ScreenHeader
        title="Library"
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable onPress={() => setFilterOpen(true)} hitSlop={8}>
              <SlidersHorizontal color={Void.textSecondary} size={20} />
              {activeFilterCount > 0 && <View style={styles.filterBadge} />}
            </Pressable>
            <Pressable
              onPress={() =>
                void countMyCustomExercises(userId).then(
                  (n) => allowedOrPrompt('customExercises', n) && setAdding(true)
                )
              }
              hitSlop={8}>
              <Plus color={Void.accent} size={22} />
            </Pressable>
          </View>
        }
      />
      <TextInput
        style={styles.search}
        placeholder="Search exercises"
        placeholderTextColor={Void.textTertiary}
        value={query}
        onChangeText={setQuery}
      />

      <FlatList
        data={exercises.slice(0, visibleCount)}
        keyExtractor={(e) => e.id}
        numColumns={2}
        columnWrapperStyle={{ gap: GRID_GAP }}
        contentContainerStyle={{ paddingHorizontal: GRID_PADDING, paddingTop: 4, paddingBottom: 100, gap: GRID_GAP }}
        renderItem={({ item }) => {
          const imgUrl = getExerciseImageUrl(item.id, 1, item.github_image_id);
          return (
            <Pressable
              style={({ pressed }) => [
                styles.tile,
                { width: tileWidth },
                pressed && { backgroundColor: Void.surfacePressed },
              ]}
              onPress={() => router.push(`/exercise/${item.id}`)}
              onLongPress={() => {
                if (!item.is_custom) return;
                void confirm({ title: 'Remove exercise?', body: item.name, confirmText: 'REMOVE', destructive: true })
                  .then((ok) => {
                    if (!ok) return;
                    void deleteExercise(item.id).then(refresh);
                  });
              }}>
              <CardSheen radius={TILE_RADIUS} />
              <View style={styles.tileImageClip}>
                {imgUrl ? (
                  <Image source={{ uri: imgUrl }} style={styles.tileImage} contentFit="cover" cachePolicy="memory-disk" transition={150} />
                ) : (
                  <View style={styles.tilePlaceholder}>
                    <View style={styles.tilePlaceholderIcon}>
                      <Dumbbell color={Void.textTertiary} size={20} />
                    </View>
                  </View>
                )}
              </View>
              <View style={styles.tileBody}>
                <Text style={styles.tileName} numberOfLines={1}>
                  {item.name}
                  {item.is_custom ? '  ·' : ''}
                </Text>
                <Text style={styles.tileMeta} numberOfLines={1}>
                  {item.target_muscle}
                  {item.secondary_muscles.length > 0 ? ` + ${item.secondary_muscles.join(', ')}` : ''} ·{' '}
                  {item.equipment}
                </Text>
              </View>
              <Pressable
                style={styles.favBadge}
                onPress={() => {
                  // Under the favourites filter an unfavourited row must drop
                  // out immediately, not linger until the next refocus.
                  const next = !item.is_favourite;
                  setExercises((prev) =>
                    favouritesOnly && !next
                      ? prev.filter((e) => e.id !== item.id)
                      : prev.map((e) =>
                          e.id === item.id ? { ...e, is_favourite: next } : e
                        )
                  );
                  void toggleFavourite(item.id);
                }}
                hitSlop={8}>
                <Star
                  color={item.is_favourite ? Void.accent : Void.textTertiary}
                  fill={item.is_favourite ? Void.accent : 'transparent'}
                  size={15}
                />
              </Pressable>
            </Pressable>
          );
        }}
        ListFooterComponent={
          exercises.length > visibleCount ? (
            <Pressable
              style={({ pressed }) => [styles.showMore, pressed && { opacity: 0.85 }]}
              onPress={() => setVisibleCount((c) => c + 20)}>
              <Text style={styles.showMoreText}>SHOW MORE</Text>
            </Pressable>
          ) : null
        }
      />

      {/* Filter sidebar */}
      <Modal visible={filterOpen} transparent animationType="slide">
        <Pressable style={styles.sidebarBackdrop} onPress={() => setFilterOpen(false)}>
          <Pressable style={styles.sidebar} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sidebarHeader}>
              <Text style={styles.sidebarTitle}>FILTERS</Text>
              <Pressable onPress={() => setFilterOpen(false)} hitSlop={8}>
                <X color={Void.textSecondary} size={20} />
              </Pressable>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>
              {/* Favourites */}
              <FilterSection
                label="FAVOURITES"
                expanded={expandedSections.has('favourites')}
                onToggle={() => toggleSection('favourites')}>
                <Pressable
                  style={[styles.filterRow, favouritesOnly && styles.filterRowActive]}
                  onPress={() => setFavouritesOnly((v) => !v)}>
                  <Star
                    color={favouritesOnly ? Void.accent : Void.textTertiary}
                    fill={favouritesOnly ? Void.accent : 'transparent'}
                    size={16}
                  />
                  <Text style={[styles.filterRowText, favouritesOnly && { color: Void.accent }]}>
                    Favourites only
                  </Text>
                </Pressable>
              </FilterSection>

              {/* Sort */}
              <FilterSection
                label="SORT BY"
                expanded={expandedSections.has('sort')}
                onToggle={() => toggleSection('sort')}>
                {(['name', 'muscle', 'favourites'] as SortMode[]).map((s) => (
                  <Pressable
                    key={s}
                    style={[styles.filterRow, sort === s && styles.filterRowActive]}
                    onPress={() => setSort(s)}>
                    <View style={styles.radioOuter}>
                      {sort === s && <View style={styles.radioInner} />}
                    </View>
                    <Text style={[styles.filterRowText, sort === s && { color: Void.accent }]}>
                      {s === 'name' ? 'Name (A-Z)' : s === 'muscle' ? 'Muscle group' : 'Favourites first'}
                    </Text>
                  </Pressable>
                ))}
              </FilterSection>

              {/* Muscle group */}
              <FilterSection
                label="MUSCLE GROUP"
                expanded={expandedSections.has('muscle')}
                onToggle={() => toggleSection('muscle')}>
                <Pressable
                  style={[styles.filterRow, muscle == null && styles.filterRowActive]}
                  onPress={() => setMuscle(null)}>
                  <View style={styles.radioOuter}>
                    {muscle == null && <View style={styles.radioInner} />}
                  </View>
                  <Text style={[styles.filterRowText, muscle == null && { color: Void.accent }]}>
                    All muscles
                  </Text>
                </Pressable>
                {muscles.map((m) => (
                  <Pressable
                    key={m}
                    style={[styles.filterRow, muscle === m && styles.filterRowActive]}
                    onPress={() => setMuscle(m)}>
                    <View style={styles.radioOuter}>
                      {muscle === m && <View style={styles.radioInner} />}
                    </View>
                    <Text style={[styles.filterRowText, muscle === m && { color: Void.accent }]}>
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </FilterSection>

              {/* Equipment */}
              <FilterSection
                label="EQUIPMENT"
                expanded={expandedSections.has('equipment')}
                onToggle={() => toggleSection('equipment')}>
                {EQUIPMENT.map((e) => (
                  <Pressable
                    key={e}
                    style={[styles.filterRow, equipment === e && styles.filterRowActive]}
                    onPress={() => setEquipment(e)}>
                    <View style={styles.radioOuter}>
                      {equipment === e && <View style={styles.radioInner} />}
                    </View>
                    <Text style={[styles.filterRowText, equipment === e && { color: Void.accent }]}>
                      {e === 'all' ? 'All equipment' : e.charAt(0).toUpperCase() + e.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </FilterSection>
            </ScrollView>

            {/* Reset */}
            <Pressable
              style={styles.resetBtn}
              onPress={() => {
                setMuscle(null);
                setEquipment('all');
                setFavouritesOnly(false);
                setSort('name');
              }}>
              <Text style={styles.resetBtnText}>RESET FILTERS</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* GitHub search-to-add */}
      <Sheet
        visible={adding}
        onClose={() => {
          setAdding(false);
          setAddQuery('');
          setSearchResults([]);
        }}
        title="ADD EXERCISE"
        right={
          <Pressable
            onPress={() => {
              setAdding(false);
              setAddQuery('');
              setSearchResults([]);
            }}
            style={styles.addDoneBtn}
            hitSlop={8}>
            <Text style={styles.addDoneText}>DONE</Text>
          </Pressable>
        }
        style={styles.addSheet}>
            <Text style={styles.addSubtitle}>Search 800+ exercises from the open exercise database</Text>
            <TextInput
              style={styles.addSearch}
              placeholder="e.g. Cable Wood Chopper, Landmine Twist…"
              placeholderTextColor={Void.textTertiary}
              value={addQuery}
              onChangeText={setAddQuery}
              autoFocus
            />

            {searching && (
              <View style={styles.addLoadingRow}>
                <ActivityIndicator color={Void.accent} size="small" />
                <Text style={styles.addLoadingText}>Searching…</Text>
              </View>
            )}

            {!searching && addQuery.trim().length >= 2 && searchResults.length === 0 && (
              <Text style={styles.addEmpty}>No matches found. Try a different spelling.</Text>
            )}

            {!searching && addQuery.trim().length < 2 && (
              <Text style={styles.addHint}>Type at least 2 characters to search.</Text>
            )}

            {!searching && searchResults.length > 0 && (
              <ScrollView style={styles.addScroll} contentContainerStyle={{ paddingBottom: 16 }}>
                {searchResults.map((item) => {
                  const alreadyAdded = addingIds.has(item.id);
                  const existsLocally = exercises.some(
                    (e) => e.name.toLowerCase() === item.name.toLowerCase()
                  );
                  const isAdded = alreadyAdded || existsLocally;
                  return (
                    <Pressable
                      key={item.id}
                      style={({ pressed }) => [
                        styles.addResult,
                        pressed && { backgroundColor: Void.surface },
                        isAdded && styles.addResultDone,
                      ]}
                      onPress={() => void addFromGitHub(item)}
                      disabled={isAdded}>
                      {item.imageUrl ? (
                        <Image source={{ uri: item.imageUrl }} style={styles.addResultImg} contentFit="contain" cachePolicy="memory-disk" transition={150} />
                      ) : (
                        <View style={styles.addResultImg} />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.addResultName}>{item.name}</Text>
                        <Text style={styles.addResultMeta}>
                          {item.primaryMuscles.join(', ')}
                          {item.secondaryMuscles.length > 0 ? ` + ${item.secondaryMuscles.join(', ')}` : ''} ·{' '}
                          {item.equipment || 'other'}
                        </Text>
                      </View>
                      {isAdded ? (
                        <Check color={Void.accent} size={20} />
                      ) : (
                        <Plus color={Void.accent} size={20} />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
      </Sheet>
    </Screen>
  );
}

function FilterSection({
  label,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Pressable style={styles.filterSectionHeader} onPress={onToggle}>
        <Text style={styles.filterLabel}>{label}</Text>
        <ChevronDown
          color={Void.textTertiary}
          size={16}
          style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
        />
      </Pressable>
      {expanded && children}
    </View>
  );
}

const styles = StyleSheet.create({
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
  filterBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Void.accent,
  },
  // 2-column grid tiles
  tile: {
    ...cardChrome,
    borderRadius: TILE_RADIUS,
    overflow: 'visible',
  },
  tileImageClip: {
    height: 110,
    borderTopLeftRadius: TILE_RADIUS,
    borderTopRightRadius: TILE_RADIUS,
    overflow: 'hidden',
    backgroundColor: Void.canvas,
  },
  tileImage: { width: '100%', height: '100%' },
  tilePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Void.surface,
  },
  tilePlaceholderIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Void.canvas,
    borderWidth: 1,
    borderColor: Void.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBody: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10 },
  tileName: { color: Void.text, fontSize: 13, fontWeight: '600' },
  tileMeta: { color: Void.textTertiary, fontSize: 11, marginTop: 2 },
  favBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  showMore: {
    alignSelf: 'center',
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 10,
  },
  showMoreText: { color: Void.accent, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  // Sidebar - glassmorphic with subtle pastel green tint
  sidebarBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  sidebar: {
    width: '72%',
    backgroundColor: 'rgba(15, 18, 16, 0.85)',
    backdropFilter: 'blur(24px)',
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 20,
    marginTop: 60,
    marginBottom: 20,
    marginRight: 12,
    overflow: 'hidden',
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  sidebarTitle: { color: Void.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  filterSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 4,
    paddingVertical: 4,
  },
  filterLabel: {
    color: Void.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  filterRowActive: { backgroundColor: 'rgba(132, 204, 22, 0.1)' },
  filterRowText: { color: Void.textSecondary, fontSize: 14 },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: Void.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: Void.accent,
  },
  resetBtn: {
    marginHorizontal: 20,
    marginBottom: 20,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    alignItems: 'center',
  },
  resetBtnText: { color: Void.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  // GitHub search-to-add modal
  addSheet: {
    maxHeight: '80%',
  },
  addDoneBtn: {
    backgroundColor: Void.accent,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  addDoneText: { color: Void.accentText, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  addSubtitle: {
    color: Void.textTertiary,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 14,
  },
  addSearch: {
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: Void.text,
    fontSize: 15,
    marginBottom: 12,
  },
  addScroll: { maxHeight: 400 },
  addLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  addLoadingText: { color: Void.textTertiary, fontSize: 13 },
  addEmpty: { color: Void.textTertiary, fontSize: 13, paddingVertical: 8 },
  addHint: { color: Void.textTertiary, fontSize: 13, paddingVertical: 8 },
  addResult: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Void.border,
  },
  addResultDone: { opacity: 0.5 },
  addResultImg: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: Void.canvas,
  },
  addResultName: { color: Void.text, fontSize: 14, fontWeight: '600' },
  addResultMeta: { color: Void.textTertiary, fontSize: 11, marginTop: 2 },
});
