import { useFocusEffect } from 'expo-router';
import { RotateCcw, Trash2, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Screen, ScreenHeader } from '@/components/ui';
import {
    listArchivedRoutines,
    permanentlyDeleteRoutine,
    restoreRoutine,
    type ArchivedRoutine,
} from '@/db/repo/routines';
import {
    listArchivedWorkouts,
    permanentlyDeleteWorkout,
    restoreWorkout,
    type ArchivedWorkout,
} from '@/db/repo/workouts';
import { goBack } from '@/lib/nav';
import { confirm } from '@/store/notify';
import { Void } from '@/theme/tokens';

type ArchiveItem =
  | ({ kind: 'workout' } & ArchivedWorkout)
  | ({ kind: 'routine' } & ArchivedRoutine);

export default function ArchiveScreen() {
  const [items, setItems] = useState<ArchiveItem[]>([]);

  const refresh = useCallback(async () => {
    const [workouts, routines] = await Promise.all([
      listArchivedWorkouts(),
      listArchivedRoutines(),
    ]);
    const merged: ArchiveItem[] = [
      ...workouts.map((w) => ({ kind: 'workout' as const, ...w })),
      ...routines.map((r) => ({ kind: 'routine' as const, ...r })),
    ];
    merged.sort((a, b) => b.archived_at.localeCompare(a.archived_at));
    setItems(merged);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const restore = useCallback(
    async (item: ArchiveItem) => {
      if (item.kind === 'workout') await restoreWorkout(item.id);
      else await restoreRoutine(item.id);
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (item: ArchiveItem) => {
      const ok = await confirm({
        title: 'Delete permanently?',
        body: `${item.title} will be gone for good - this can't be undone.`,
        confirmText: 'DELETE',
        destructive: true,
      });
      if (!ok) return;
      if (item.kind === 'workout') await permanentlyDeleteWorkout(item.id);
      else await permanentlyDeleteRoutine(item.id);
      await refresh();
    },
    [refresh]
  );

  return (
    <Screen>
      <ScreenHeader
        title="Archive"
        right={
          <Pressable onPress={() => goBack()} hitSlop={8}>
            <X color={Void.textSecondary} size={22} />
          </Pressable>
        }
      />
      <FlatList
        data={items}
        keyExtractor={(i) => `${i.kind}:${i.id}`}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.kind}>
                    {item.kind === 'workout' ? 'WORKOUT' : 'ROUTINE'}
                  </Text>
                </View>
                <Text style={styles.date}>
                  {item.kind === 'workout'
                    ? new Date(item.started_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : `${item.folder_name} · ${item.exercise_count} exercise${item.exercise_count === 1 ? '' : 's'}`}
                </Text>
                <Text style={styles.daysLeft}>
                  {item.days_left} day{item.days_left === 1 ? '' : 's'} until permanent deletion
                </Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.btn, styles.restoreBtn, pressed && { opacity: 0.85 }]}
                onPress={() => void restore(item)}
                hitSlop={6}>
                <RotateCcw size={16} color={Void.accentText} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.btn, styles.deleteBtn, pressed && { opacity: 0.85 }]}
                onPress={() => void remove(item)}
                hitSlop={6}>
                <Trash2 size={16} color={Void.textSecondary} />
              </Pressable>
            </View>
          </Card>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Nothing archived. Deleted workouts and routines are kept here for 28 days.</Text>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 10, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: Void.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  kind: { color: Void.textTertiary, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  date: { color: Void.textTertiary, fontSize: 12, marginTop: 3 },
  daysLeft: { color: Void.accent, fontSize: 10, fontWeight: '600', marginTop: 6, letterSpacing: 0.5 },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restoreBtn: { backgroundColor: Void.accent },
  deleteBtn: {
    borderWidth: 1,
    borderColor: Void.borderStrong,
  },
  empty: {
    color: Void.textTertiary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 40,
    paddingHorizontal: 40,
    lineHeight: 20,
  },
});
