import { useCallback, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { Void } from '@/theme/tokens';

interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}

/** Minimal stepped slider - no native slider dep, driven by RNGH pan/tap. */
export function Slider({ value, min, max, step = 1, onChange }: Props) {
  const [width, setWidth] = useState(0);
  // Guard min===max: the range is zero-width, so the fill fraction is 0.
  const frac = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;

  const setFromX = useCallback(
    (x: number) => {
      if (width <= 0) return;
      const f = Math.min(1, Math.max(0, x / width));
      const snapped = Math.round((min + f * (max - min)) / step) * step;
      const clamped = Math.min(max, Math.max(min, snapped));
      if (clamped !== value) onChange(clamped);
    },
    [width, min, max, step, value, onChange]
  );

  const pan = Gesture.Pan()
    .onBegin((e) => runOnJS(setFromX)(e.x))
    .onUpdate((e) => runOnJS(setFromX)(e.x));
  const tap = Gesture.Tap().onEnd((e) => runOnJS(setFromX)(e.x));
  const gesture = Gesture.Race(pan, tap);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.hit} onLayout={onLayout}>
        <View style={styles.track} />
        <View style={[styles.fill, { width: `${frac * 100}%` }]} />
        <View style={[styles.thumb, { left: frac * (width - 22) }]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hit: { height: 34, justifyContent: 'center' },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Void.border,
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: Void.accent,
  },
  thumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Void.text,
    borderWidth: 2,
    borderColor: Void.accent,
  },
});
