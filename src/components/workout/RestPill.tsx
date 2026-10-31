import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RestState } from '@/store/activeWorkout';
import { tabular, Void } from '@/theme/tokens';

interface Props {
  rest: RestState;
  numpadOpen: boolean;
  onAdjust: (deltaSec: number) => void;
  onSkip: () => void;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Floating rest HUD - real-time countdown, ±30s adjustments, skip, and a
 * haptic chime on expiry. `endsAt` timestamps keep it correct across app
 * backgrounding (iOS suspends JS timers; the pill re-syncs on resume).
 */
export function RestPill({ rest, numpadOpen, onAdjust, onSkip }: Props) {
  const insets = useSafeAreaInsets();
  const [remaining, setRemaining] = useState(rest.endsAt - Date.now());
  const chimeFired = useRef(false);

  useEffect(() => {
    chimeFired.current = false;
    let skipTimer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      const left = rest.endsAt - Date.now();
      setRemaining(left);
      if (left <= 0 && !chimeFired.current) {
        chimeFired.current = true;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Hold the 0:00 state briefly so the chime lands, then clear.
        skipTimer = setTimeout(onSkip, 1500);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => {
      clearInterval(id);
      // A stale skip must not kill a just-started new rest.
      if (skipTimer) clearTimeout(skipTimer);
    };
  }, [rest.endsAt, onSkip]);

  const expired = remaining <= 0;
  const frac = expired ? 0 : Math.min(1, remaining / 1000 / rest.durationSec);

  return (
    <View
      style={[
        styles.wrap,
        // Numpad occupies ~290pt at the bottom - the pill floats above it.
        { bottom: numpadOpen ? 300 + insets.bottom : insets.bottom + 24 },
      ]}>
      <View style={styles.pill}>
        <Text style={styles.label} numberOfLines={1}>
          {expired ? 'GO' : rest.label.toUpperCase()}
        </Text>
        <Text style={[styles.time, expired && styles.timeDone]}>{fmt(remaining)}</Text>
        <View style={styles.controls}>
          <Pressable style={styles.ctl} onPress={() => onAdjust(-30)} hitSlop={4}>
            <Text style={styles.ctlText}>−30</Text>
          </Pressable>
          <Pressable style={styles.ctl} onPress={() => onAdjust(30)} hitSlop={4}>
            <Text style={styles.ctlText}>+30</Text>
          </Pressable>
          <Pressable style={[styles.ctl, styles.skip]} onPress={onSkip} hitSlop={4}>
            <Text style={[styles.ctlText, styles.skipText]}>SKIP</Text>
          </Pressable>
        </View>
        <View style={[styles.progress, { width: `${frac * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Void.surfaceRaised,
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  label: { color: Void.textSecondary, fontSize: 10, letterSpacing: 1, maxWidth: 110 },
  time: { color: Void.text, fontSize: 20, fontWeight: '700', ...tabular, minWidth: 58, textAlign: 'center' },
  timeDone: { color: Void.accent },
  controls: { flexDirection: 'row', gap: 6 },
  ctl: {
    borderWidth: 1,
    borderColor: Void.borderStrong,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  ctlText: { color: Void.text, fontSize: 12, fontWeight: '600', ...tabular },
  skip: { backgroundColor: Void.accent, borderColor: Void.accent },
  skipText: { color: Void.accentText },
  progress: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 2,
    backgroundColor: Void.accent,
    opacity: 0.6,
  },
});
