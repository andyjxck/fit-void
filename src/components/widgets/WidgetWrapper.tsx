import {
    ChevronLeft,
    ChevronRight,
    Expand,
    Lock,
    X
} from 'lucide-react-native';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { sizeDims, type WidgetSize } from '@/lib/widgetTypes';
import { Void } from '@/theme/tokens';

interface Props {
  id: string;
  size: WidgetSize;
  editMode: boolean;
  /** Small category label rendered in the widget's top-left corner
   *  (e.g. METRICS / ACTIONS / ROUTINES) - replaces section headers. */
  tag?: string;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  alignRight?: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onRemove: () => void;
  onCycleSize: () => void;
  /** Edit-mode pencil (top-left) - opens the thing's editor (e.g. routine). */
  onEdit?: () => void;
  /** Moving + resizing is a Pro surface. When false the arrows and size
   *  control render dimmed and tapping them fires `onRearrangeLocked`;
   *  remove (X) and tap-to-edit stay free. */
  canRearrange?: boolean;
  /** Called when a free user taps a locked move/resize control. */
  onRearrangeLocked?: () => void;
  children: ReactNode;
}

export function WidgetWrapper({
  id,
  size,
  editMode,
  tag,
  canMoveLeft,
  canMoveRight,
  onMoveLeft,
  onMoveRight,
  onRemove,
  onCycleSize,
  onEdit,
  canRearrange = true,
  onRearrangeLocked,
  children,
}: Props) {
  // Locked controls keep their visual spot (the upsell surface) but swap
  // their action for the paywall prompt.
  const rearrange = (fn: () => void) => (canRearrange ? fn : () => onRearrangeLocked?.());
  const { w, h } = sizeDims(size);
  const aspectH = w === 1 ? (h === 1 ? 160 : 340) : undefined;

  return (
    <View
      style={[styles.wrap, editMode && styles.editTilt]}>
      {tag ? (
        <View style={styles.tagBadge} pointerEvents="none">
          <Text style={styles.tagText}>{tag}</Text>
        </View>
      ) : null}
      {editMode && (
        <>
          <Pressable style={styles.removeBadge} onPress={onRemove} hitSlop={8}>
            <X color={Void.accentText} size={14} fill={Void.accentText} />
          </Pressable>
          <View style={[styles.editControls, !canRearrange && { opacity: 0.45 }]}>
            {w === 1 && canMoveLeft && (
              <Pressable style={styles.ctrlBtn} onPress={rearrange(onMoveLeft)} hitSlop={8}>
                <ChevronLeft color={Void.text} size={13} />
              </Pressable>
            )}
            {w === 1 && canMoveRight && (
              <Pressable style={styles.ctrlBtn} onPress={rearrange(onMoveRight)} hitSlop={8}>
                <ChevronRight color={Void.text} size={13} />
              </Pressable>
            )}
            <Pressable style={styles.ctrlBtn} onPress={rearrange(onCycleSize)} hitSlop={8}>
              <Expand color={Void.text} size={13} />
            </Pressable>
            {!canRearrange && (
              <View style={styles.ctrlLock}>
                <Lock color={Void.accent} size={10} />
              </View>
            )}
          </View>
        </>
      )}
      <View
        style={[styles.inner, aspectH ? { minHeight: aspectH } : undefined]}
        pointerEvents={editMode ? 'none' : 'auto'}>
        {children}
      </View>
      {editMode && onEdit && (
        // Tapping the widget body in edit mode opens its editor - controls
        // and badges sit above this layer and still win their own taps.
        <Pressable style={styles.editTap} onPress={onEdit} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', marginBottom: 10 },
  editTilt: { transform: [{ rotate: '0.5deg' }] },
  inner: { flex: 1 },
  tagBadge: {
    position: 'absolute',
    top: 6,
    left: 8,
    zIndex: 5,
  },
  tagText: {
    color: Void.textTertiary,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
  },
  editTap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 6,
  },
  removeBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Void.accent,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  editControls: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 0,
    zIndex: 10,
  },
  ctrlBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlLock: {
    position: 'absolute',
    top: -5,
    right: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Void.canvas,
    borderWidth: 1,
    borderColor: Void.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
