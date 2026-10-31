import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tabular } from '@/theme/tokens';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const MAX_SCALE = 5;

/** One fullscreen photo with pinch, pan, and double-tap zoom. Pan is clamped
 *  to the zoomed bounds so the image can't be flung off-screen. */
function ZoomableImage({ uri, aspect, onZoomChange }: { uri: string; aspect: number; onZoomChange?: (zoomed: boolean) => void }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const imgW = SCREEN_W;
  const imgH = SCREEN_W / aspect;

  const clamp = () => {
    'worklet';
    const maxX = Math.max(0, (imgW * scale.value - SCREEN_W) / 2);
    const maxY = Math.max(0, (imgH * scale.value - SCREEN_H) / 2);
    tx.value = Math.min(maxX, Math.max(-maxX, tx.value));
    ty.value = Math.min(maxY, Math.max(-maxY, ty.value));
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * e.scale));
      clamp();
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
      }
      if (onZoomChange) runOnJS(onZoomChange)(savedScale.value > 1);
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .onStart(() => {
      startX.value = tx.value;
      startY.value = ty.value;
    })
    .onUpdate((e) => {
      if (scale.value <= 1) return;
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY;
      clamp();
    });

  // Double-tap toggles between fit and 2.5x zoom at the tap point.
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (onZoomChange) runOnJS(onZoomChange)(savedScale.value <= 1);
      if (savedScale.value > 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
      } else {
        const z = 2.5;
        scale.value = withTiming(z);
        savedScale.value = z;
        tx.value = withTiming(
          Math.min(Math.max(-(e.x - imgW / 2) * (z - 1), -(imgW * z - SCREEN_W) / 2), (imgW * z - SCREEN_W) / 2)
        );
        ty.value = withTiming(
          Math.min(Math.max(-(e.y - imgH / 2) * (z - 1), -(imgH * z - SCREEN_H) / 2), (imgH * z - SCREEN_H) / 2)
        );
      }
    });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.page, animStyle]}>
        <Image
          source={{ uri }}
          style={{ width: imgW, height: imgH }}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * Fullscreen photo pager for feed posts. Swipe between photos, pinch /
 * double-tap to zoom, X or backdrop to close.
 */
export function PhotoViewer({
  urls,
  aspects,
  initialIndex,
  onClose,
}: {
  urls: string[];
  /** Per-image w/h ratios; falls back to 4:5 when unknown. */
  aspects?: number[];
  initialIndex: number;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const pagerRef = useRef<ScrollView>(null);

  useEffect(() => {
    // Scroll to the tapped photo after the modal has laid out.
    const t = setTimeout(() => {
      pagerRef.current?.scrollTo({ x: initialIndex * SCREEN_W, animated: false });
    }, 50);
    return () => clearTimeout(t);
  }, [initialIndex]);

  const onScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      setIdx(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W));
    },
    []
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}>
          {urls.map((url, i) => (
            <View key={i} style={{ width: SCREEN_W }}>
              {i === idx || Math.abs(i - idx) <= 1 ? (
                <ZoomableImage uri={url} aspect={aspects?.[i] ?? 0.8} onZoomChange={setZoomed} />
              ) : (
                <View style={styles.page} />
              )}
            </View>
          ))}
        </ScrollView>

        <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
          <Text style={styles.counter}>{idx + 1} / {urls.length}</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <X color="#fff" size={22} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)', justifyContent: 'center' },
  page: { flex: 1, width: SCREEN_W, alignItems: 'center', justifyContent: 'center' },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: { color: '#fff', fontSize: 13, fontWeight: '700', ...tabular },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
