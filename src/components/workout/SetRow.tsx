import { Check, ChevronDown, Trash2, Undo2, X } from 'lucide-react-native';
import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { displayWeight, formatDuration } from '@/lib/format';
import type { SetType, TrackingType, WeightUnit } from '@/lib/types';
import { effectiveReps, effectiveWeight, type LiveSet } from '@/store/activeWorkout';
import { tabular, Void } from '@/theme/tokens';

export type SetField = 'weight' | 'reps' | 'duration' | 'distance' | 'hr' | 'rpe' | 'meta';

/** An optional input on the hidden extras row - a first-class field (rpe,
 *  hr) or a named meta extra (incline_pct, resistance...). */
export interface ExtraField {
  field: 'rpe' | 'hr' | 'meta';
  metaKey?: string;
  label: string;
  unit: string;
}

const TYPE_META: Record<SetType, { letter: string; color: string }> = {
  normal: { letter: 'N', color: Void.textSecondary },
  warmup: { letter: 'W', color: Void.warmup },
  drop: { letter: 'D', color: Void.drop },
  failure: { letter: 'F', color: Void.failure },
};

const NEXT_TYPE: Record<SetType, SetType> = {
  normal: 'warmup',
  warmup: 'drop',
  drop: 'failure',
  failure: 'normal',
};

/**
 * Swipe action rendered by ReanimatedSwipeable. Extracted as a real component
 * so its hooks are stable across renders - never inline useAnimatedStyle in
 * the renderRightActions closure.
 */
function RowAction({
  translation,
  done,
}: {
  translation: SharedValue<number>;
  done: boolean;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: translation.value + 72 }],
  }));
  return (
    <Animated.View
      style={[styles.swipeAction, done && styles.swipeActionUndo, style]}>
      {done ? (
        <Undo2 color={Void.text} size={18} />
      ) : (
        <Check color={Void.accentText} size={20} strokeWidth={3} />
      )}
    </Animated.View>
  );
}

/** Swipe-right delete action, mirrored on the left edge. */
function RowDeleteAction({ translation }: { translation: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: translation.value - 72 }],
  }));
  return (
    <Animated.View style={[styles.swipeAction, styles.swipeActionDelete, style]}>
      <Trash2 color={Void.text} size={18} />
    </Animated.View>
  );
}

interface Props {
  set: LiveSet;
  index: number;
  unit: WeightUnit;
  trackingType?: TrackingType;
  /** Bodyweight exercise - the weight field is added load on top of bw. */
  addedWeight?: boolean;
  /** Optional inputs revealed by the expand chevron under the row. */
  extras?: ExtraField[];
  active?: boolean; // the next set to perform
  /** Which zone the numpad is currently writing to - gets an accent
   *  underline so there's always a visible focus target. */
  focusedField?: SetField | null;
  focusedMetaKey?: string;
  onFocusField: (field: SetField, metaKey?: string) => void;
  onComplete: () => void;
  onUncomplete: () => void;
  onDelete: () => void;
  onCycleType: (t: SetType) => void;
  /** false when this is the block's only set - an exercise keeps >= 1 set. */
  canDelete?: boolean;
}

/** Compact read row - values are tap-to-edit, not input boxes. */
export function SetRow({
  set,
  index,
  unit,
  trackingType = 'strength',
  addedWeight = false,
  extras = [],
  active,
  focusedField = null,
  focusedMetaKey,
  onFocusField,
  onComplete,
  onUncomplete,
  onDelete,
  onCycleType,
  canDelete = true,
}: Props) {
  const [extrasOpen, setExtrasOpen] = useState(false);
  const meta = TYPE_META[set.setType];
  const done = set.isCompleted;
  const weight = displayWeight(effectiveWeight(set), unit);
  const reps = effectiveReps(set);
  const weightGhost = set.weightKg == null;
  const repsGhost = set.reps == null;
  const durationGhost = set.durationSeconds == null;
  const distanceGhost = set.distanceM == null;

  // Which two value zones to show, per tracking type - each block always
  // keeps the same 2-zone layout, just swaps what fills it.
  const zones: { field: SetField; label: string; value: string; ghost: boolean }[] =
    trackingType === 'cardio'
      ? [
          { field: 'duration', label: '', value: durationGhost ? '-' : formatDuration(set.durationSeconds!), ghost: durationGhost },
          { field: 'distance', label: 'm', value: distanceGhost ? '-' : String(Math.round(set.distanceM!)), ghost: distanceGhost },
          { field: 'hr', label: 'bpm', value: set.avgHr != null ? String(set.avgHr) : '-', ghost: set.avgHr == null },
        ]
      : trackingType === 'hold'
        ? [
            { field: 'duration', label: '', value: durationGhost ? '-' : formatDuration(set.durationSeconds!), ghost: durationGhost },
          ]
      : trackingType === 'carry'
        ? [
            { field: 'weight' as const, label: unit, value: weight || '-', ghost: weightGhost },
            set.distanceM != null
              ? { field: 'distance' as const, label: 'm', value: String(Math.round(set.distanceM)), ghost: false }
              : { field: 'duration' as const, label: '', value: durationGhost ? '-' : formatDuration(set.durationSeconds!), ghost: durationGhost },
          ]
        : [
            { field: 'weight' as const, label: addedWeight ? `+${unit}` : unit, value: weight || '-', ghost: weightGhost },
            { field: 'reps' as const, label: '', value: reps != null ? String(reps) : '-', ghost: repsGhost },
          ];

  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={48}
      renderRightActions={(_progress, translation) => (
        <RowAction translation={translation} done={done} />
      )}
      renderLeftActions={
        canDelete
          ? (_progress, translation) => <RowDeleteAction translation={translation} />
          : undefined
      }
      onSwipeableOpen={(dir) => {
        // ReanimatedSwipeable names directions by swipe motion: 'right' means
        // the user swiped right, revealing renderLeftActions (delete).
        if (dir === 'right') {
          if (canDelete) onDelete();
        } else {
          done ? onUncomplete() : onComplete();
        }
      }}>
      <View>
      <View style={[styles.row, active && styles.rowActive, done && styles.rowDone]}>
        <Pressable
          style={styles.typeBadge}
          onPress={() => onCycleType(NEXT_TYPE[set.setType])}
          onLongPress={onDelete}>
          <Text style={[styles.typeLetter, { color: meta.color }]}>{meta.letter}</Text>
          <Text style={styles.setNum}>{index + 1}</Text>
        </Pressable>

        {zones.map((z, zi) => (
          <Fragment key={z.field}>
            {zi > 0 && <Text style={styles.times}>{trackingType === 'strength' ? '×' : '·'}</Text>}
            <Pressable
              style={[styles.valueZone, focusedField === z.field && styles.zoneFocused]}
              onPress={() => onFocusField(z.field)}
              hitSlop={4}>
              <Text
                style={[
                  styles.value,
                  z.ghost && styles.ghostText,
                  done && !z.ghost && styles.doneText,
                  focusedField === z.field && styles.valueFocused,
                ]}>
                {z.value}
                {z.label ? <Text style={styles.unitLabel}> {z.label}</Text> : null}
              </Text>
            </Pressable>
          </Fragment>
        ))}
        {zones.length === 1 && <View style={styles.valueZone} />}

        <Pressable
          style={[styles.check, done && styles.checkDone]}
          onPress={done ? onUncomplete : onComplete}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 6 }}>
          <Check size={16} strokeWidth={3} color={done ? Void.accentText : Void.textTertiary} />
        </Pressable>

        {/* Explicit remove - gestures alone weren't discoverable enough.
            Hidden on the block's only set: an exercise keeps >= 1 set. */}
        {canDelete ? (
          <Pressable style={styles.removeBtn} onPress={onDelete} hitSlop={8}>
            <X size={14} color={Void.textTertiary} />
          </Pressable>
        ) : (
          <View style={styles.removeBtn} />
        )}
      </View>

      {/* Extras - chevron under the row reveals optional inputs (incline,
          RPE, resistance...) without crowding the main fields. */}
      {extras.length > 0 && (
        <Pressable
          style={styles.extrasToggle}
          onPress={() => setExtrasOpen((v) => !v)}
          hitSlop={6}>
          <ChevronDown
            size={12}
            color={extrasOpen ? Void.accent : Void.textTertiary}
            style={extrasOpen ? { transform: [{ rotate: '180deg' }] } : undefined}
          />
        </Pressable>
      )}
      {extrasOpen && extras.length > 0 && (
        // Same grid as the main row: badge spacer, flex value zones, then
        // spacers for the check/remove buttons - extras line up exactly
        // under the main fields.
        <View style={[styles.row, styles.extrasRow]}>
          <View style={styles.typeBadge} />
          {extras.map((e, i) => {
            const v =
              e.field === 'rpe' ? set.rpe
              : e.field === 'hr' ? set.avgHr
              : set.meta?.[e.metaKey ?? ''];
            const isFocused =
              focusedField === e.field && (e.field !== 'meta' || e.metaKey === focusedMetaKey);
            return (
              <Fragment key={e.metaKey ?? e.field}>
                {i > 0 && <Text style={styles.times}>·</Text>}
                <Pressable
                  style={[styles.valueZone, isFocused && styles.zoneFocused]}
                  onPress={() => onFocusField(e.field, e.metaKey)}
                  hitSlop={4}>
                  <Text style={styles.extraLabel}>{e.label}</Text>
                  <Text
                    style={[
                      styles.value,
                      styles.extraValue,
                      v == null && styles.ghostText,
                      isFocused && styles.valueFocused,
                    ]}>
                    {v != null ? String(v) : '-'}
                    {e.unit ? <Text style={styles.unitLabel}> {e.unit}</Text> : null}
                  </Text>
                </Pressable>
              </Fragment>
            );
          })}
          <View style={styles.checkSpacer} />
          <View style={styles.removeBtn} />
        </View>
      )}
      </View>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 6,
  },
  rowDone: { opacity: 0.6 },
  rowActive: {
    backgroundColor: Void.accentDim,
    borderRadius: 8,
    marginHorizontal: -6,
    paddingHorizontal: 12,
  },
  typeBadge: { width: 30, flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  typeLetter: { fontSize: 10, fontWeight: '800' },
  setNum: { color: Void.textTertiary, fontSize: 12, ...tabular },
  valueZone: {
    flex: 1,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  zoneFocused: { borderBottomColor: Void.accent },
  valueFocused: { color: Void.accent },
  value: { color: Void.text, fontSize: 17, fontWeight: '600', ...tabular },
  ghostText: { color: Void.ghost },
  doneText: { color: Void.text },
  unitLabel: { color: Void.textTertiary, fontSize: 11, fontWeight: '400' },
  times: { color: Void.textTertiary, fontSize: 14 },
  check: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: Void.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { backgroundColor: Void.accent, borderColor: Void.accent },
  removeBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeAction: {
    width: 72,
    marginLeft: -72,
    backgroundColor: Void.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  swipeActionUndo: { backgroundColor: Void.borderStrong },
  swipeActionDelete: {
    backgroundColor: Void.danger,
    marginLeft: 0,
    marginRight: -72,
  },
  extrasToggle: { alignItems: 'center', paddingVertical: 2 },
  extrasRow: { paddingVertical: 0, paddingBottom: 8 },
  extraLabel: {
    color: Void.textTertiary,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 1,
  },
  extraValue: { fontSize: 14, fontWeight: '600' },
  checkSpacer: { width: 30, height: 30 },
});
