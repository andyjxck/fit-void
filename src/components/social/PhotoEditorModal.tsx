import { FlipType, manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import {
    Check,
    Crop,
    FlipHorizontal2,
    FlipVertical2,
    RotateCcw,
    RotateCw,
    SlidersHorizontal,
    Sparkles,
    Square,
    X,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { Slider } from '@/components/ui/Slider';
import { Void } from '@/theme/tokens';

// -- Preset filters (overlay-based, no native dependency) ---------------

type FilterName = 'Normal' | 'Sepia' | 'Warm' | 'Cool' | 'Vintage' | 'Noir' | 'Fade' | 'Vivid' | 'Polar' | 'Ink';

const FILTERS: { name: FilterName; label: string }[] = [
  { name: 'Normal', label: 'NONE' },
  { name: 'Vivid', label: 'VIVID' },
  { name: 'Warm', label: 'WARM' },
  { name: 'Cool', label: 'COOL' },
  { name: 'Vintage', label: 'VINTAGE' },
  { name: 'Sepia', label: 'SEPIA' },
  { name: 'Noir', label: 'NOIR' },
  { name: 'Fade', label: 'FADE' },
  { name: 'Polar', label: 'POLAR' },
  { name: 'Ink', label: 'INK' },
];

// Each filter is a colour wash; `strength` (0-1) scales the wash opacity so
// the user can dial a filter back instead of accepting full strength.
function FilterOverlay({ name, strength = 1 }: { name: FilterName; strength?: number }) {
  let bg: string | null = null;
  let opacity = 0;
  switch (name) {
    case 'Vivid': bg = '#ff4400'; opacity = 0.08; break;
    case 'Warm': bg = '#ff8800'; opacity = 0.12; break;
    case 'Cool': bg = '#0088ff'; opacity = 0.12; break;
    case 'Vintage': bg = '#cc9966'; opacity = 0.18; break;
    case 'Sepia': bg = '#704214'; opacity = 0.35; break;
    case 'Noir': bg = '#000000'; opacity = 0.25; break;
    case 'Fade': bg = '#ffffff'; opacity = 0.15; break;
    case 'Polar': bg = '#a0d8ef'; opacity = 0.2; break;
    case 'Ink': bg = '#1a1a2e'; opacity = 0.3; break;
    default: return null;
  }
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: bg, opacity: opacity * strength }]}
    />
  );
}

const CROP_PRESETS: { label: string; ratio: number | null }[] = [
  { label: 'ORIGINAL', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
];

// -- Frames --------------------------------------------------------------
// Frames render as inset overlays on the photo edges (inside the stage), so
// they never cover the filtered image - the filter stays visible at any width.

type FrameStyle = 'none' | 'thin' | 'thick' | 'film' | 'rounded' | 'double';

const FRAMES: { key: FrameStyle; label: string }[] = [
  { key: 'none', label: 'NONE' },
  { key: 'thin', label: 'THIN' },
  { key: 'thick', label: 'THICK' },
  { key: 'film', label: 'FILM' },
  { key: 'rounded', label: 'ROUND' },
  { key: 'double', label: 'DOUBLE' },
];

function FrameOverlay({ style, thickness, opacity }: { style: FrameStyle; thickness: number; opacity: number }) {
  if (style === 'none' || thickness <= 0 || opacity <= 0) return null;
  const t = Math.round(thickness);

  if (style === 'film') {
    // Sprocket-hole film strip: black bars top & bottom with punched holes.
    const bar = Math.max(10, t);
    const hole = Math.max(4, Math.min(10, bar * 0.45));
    const strip = (key: string, pos: { top?: number; bottom?: number }) => (
      <View
        key={key}
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: bar,
          backgroundColor: '#000',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-evenly',
          ...pos,
        }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <View
            key={i}
            style={{
              width: hole,
              height: hole * 0.7,
              borderRadius: 2,
              backgroundColor: Void.surface,
            }}
          />
        ))}
      </View>
    );
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
        {strip('top', { top: 0 })}
        {strip('bottom', { bottom: 0 })}
      </View>
    );
  }

  if (style === 'rounded') {
    return (
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderWidth: Math.max(2, t * 0.5), borderColor: '#ffffff', borderRadius: 28, opacity },
        ]}
      />
    );
  }

  if (style === 'double') {
    const outer = Math.max(2, Math.round(t * 0.4));
    const gap = Math.max(4, Math.round(t * 0.35));
    const inner = Math.max(1, Math.round(t * 0.15));
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
        <View style={[StyleSheet.absoluteFill, { borderWidth: outer, borderColor: '#ffffff' }]} />
        <View
          style={{
            position: 'absolute',
            top: outer + gap,
            left: outer + gap,
            right: outer + gap,
            bottom: outer + gap,
            borderWidth: inner,
            borderColor: '#ffffff',
          }}
        />
      </View>
    );
  }

  const color = style === 'thin' ? '#ffffff' : '#000000';
  const width = style === 'thin' ? Math.max(1, Math.min(t, 12)) : Math.max(4, t);
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderWidth: width, borderColor: color, opacity }]}
    />
  );
}

type Tab = 'filters' | 'adjust' | 'crop' | 'transform' | 'frame';

const TABS: { key: Tab; Icon: typeof Crop }[] = [
  { key: 'filters', Icon: Sparkles },
  { key: 'adjust', Icon: SlidersHorizontal },
  { key: 'crop', Icon: Crop },
  { key: 'transform', Icon: RotateCw },
  { key: 'frame', Icon: Square },
];

interface Props {
  visible: boolean;
  imageUri: string | null;
  onSave: (uri: string) => void;
  onClose: () => void;
}

export function PhotoEditorModal({ visible, imageUri, onSave, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const captureView = useRef<View>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [baseUri, setBaseUri] = useState<string | null>(null);
  const [imgW, setImgW] = useState(0);
  const [imgH, setImgH] = useState(0);
  const [filter, setFilter] = useState<FilterName>('Normal');
  const [filterStrength, setFilterStrength] = useState(1);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturate, setSaturate] = useState(0);
  const [warmth, setWarmth] = useState(0);
  const [tint, setTint] = useState(0);
  const [blur, setBlur] = useState(0);
  const [cropRatio, setCropRatio] = useState<number | null>(null);
  const [frameStyle, setFrameStyle] = useState<FrameStyle>('none');
  const [frameThickness, setFrameThickness] = useState(12);
  const [frameOpacity, setFrameOpacity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const [containerW, setContainerW] = useState(0);
  const [containerH, setContainerH] = useState(0);
  const [adjustSel, setAdjustSel] = useState(0);

  // -- Pan / pinch shared values ------------------------------------------
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const stageW = useSharedValue(0);
  const stageH = useSharedValue(0);
  const dispW = useSharedValue(0);
  const dispH = useSharedValue(0);

  // Stage = the crop window (or the full fitted image when no crop is set).
  // Everything exported is what's inside this rect.
  const stage = useMemo(() => {
    if (!imgW || !imgH || !containerW || !containerH) return null;
    const ratio = cropRatio ?? imgW / imgH;
    let w = containerW;
    let h = w / ratio;
    if (h > containerH) {
      h = containerH;
      w = h * ratio;
    }
    return { w: Math.round(w), h: Math.round(h) };
  }, [imgW, imgH, containerW, containerH, cropRatio]);

  // Cover-fit image dims inside the stage - the draggable/zoomable content.
  const disp = useMemo(() => {
    if (!stage || !imgW || !imgH) return null;
    const s = Math.max(stage.w / imgW, stage.h / imgH);
    return { w: imgW * s, h: imgH * s };
  }, [imgW, imgH, stage]);

  // Keep gesture math in sync with layout; reset pan/zoom when the stage or
  // crop ratio changes so the photo recentres inside the new crop window.
  useEffect(() => {
    stageW.value = stage?.w ?? 0;
    stageH.value = stage?.h ?? 0;
    dispW.value = disp?.w ?? 0;
    dispH.value = disp?.h ?? 0;
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
  }, [stage, disp, cropRatio, stageW, stageH, dispW, dispH, scale, savedScale, tx, ty]);

  const clampOffsets = () => {
    'worklet';
    const maxX = Math.max(0, (dispW.value * scale.value - stageW.value) / 2);
    const maxY = Math.max(0, (dispH.value * scale.value - stageH.value) / 2);
    tx.value = Math.min(maxX, Math.max(-maxX, tx.value));
    ty.value = Math.min(maxY, Math.max(-maxY, ty.value));
  };

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = tx.value;
      startY.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY;
      clampOffsets();
    });

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(4, Math.max(1, savedScale.value * e.scale));
      clampOffsets();
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const gesture = Gesture.Simultaneous(pan, pinch);

  const photoAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  if (visible && imageUri && imageUri !== loadedUri) {
    setLoadedUri(imageUri);
    setBaseUri(imageUri);
    // New image: clear dims so onLoad re-seeds instead of reusing the
    // previous photo's size (misaligned crop/overlay rects otherwise).
    setImgW(0);
    setImgH(0);
    setFilter('Normal');
    setFilterStrength(1);
    setBrightness(0);
    setContrast(0);
    setSaturate(0);
    setWarmth(0);
    setTint(0);
    setBlur(0);
    setCropRatio(null);
    setFrameStyle('none');
    setFrameThickness(12);
    setFrameOpacity(1);
    setTab(null);
    setSaving(false);
    setBusy(false);
    setAdjustSel(0);
  }

  // Seed dims straight from the file - don't depend on the preview Image's
  // onLoad firing (it can silently fail on some picked URIs, leaving a black
  // stage forever).
  useEffect(() => {
    if (!baseUri || imgW) return;
    Image.getSize(
      baseUri,
      (w, h) => {
        if (w && h) { setImgW(w); setImgH(h); }
      },
      () => {}
    );
  }, [baseUri, imgW]);

  const applyManip = useCallback(async (actions: Parameters<typeof manipulateAsync>[1]) => {
    if (!baseUri || busy) return;
    setBusy(true);
    try {
      const res = await manipulateAsync(baseUri, actions, { format: SaveFormat.JPEG, compress: 0.95 });
      setBaseUri(res.uri);
      setImgW(res.width);
      setImgH(res.height);
      // Rotating/flipping changes the geometry under the crop window.
      setCropRatio(null);
    } finally {
      setBusy(false);
    }
  }, [baseUri, busy]);

  const save = async () => {
    if (saving || !captureView.current) return;
    setSaving(true);
    try {
      // The capture ref wraps the crop-window stage, so pan/pinch/filter/
      // frame are all baked into the exported bitmap exactly as previewed.
      const uri = await captureRef(captureView, { format: 'jpg', quality: 0.92 });
      onSave(uri);
    } catch {
      setSaving(false);
    }
  };

  const adjustmentOverlays = useMemo(() => {
    const layers: React.ReactElement[] = [];
    const clip = StyleSheet.absoluteFill;
    if (brightness > 0) {
      layers.push(<View key="bright" style={[clip, { backgroundColor: '#ffffff', opacity: brightness * 0.4 }]} />);
    } else if (brightness < 0) {
      layers.push(<View key="dark" style={[clip, { backgroundColor: '#000000', opacity: -brightness * 0.4 }]} />);
    }
    if (contrast < 0) {
      layers.push(<View key="contrast" style={[clip, { backgroundColor: '#808080', opacity: -contrast * 0.3 }]} />);
    }
    if (saturate < 0) {
      layers.push(<View key="sat" style={[clip, { backgroundColor: '#808080', opacity: -saturate * 0.5 }]} />);
    }
    if (warmth > 0) {
      layers.push(<View key="warm" style={[clip, { backgroundColor: '#ff6600', opacity: warmth * 0.15 }]} />);
    } else if (warmth < 0) {
      layers.push(<View key="cool" style={[clip, { backgroundColor: '#0066ff', opacity: -warmth * 0.15 }]} />);
    }
    if (tint > 0) {
      layers.push(<View key="tintm" style={[clip, { backgroundColor: '#ff00ff', opacity: tint * 0.1 }]} />);
    } else if (tint < 0) {
      layers.push(<View key="tintg" style={[clip, { backgroundColor: '#00ff00', opacity: -tint * 0.1 }]} />);
    }
    return layers;
  }, [brightness, contrast, saturate, warmth, tint]);

  const adjustments = useMemo(() => ([
    { key: 'BRIGHTNESS', label: 'BRIGHTNESS', value: brightness, set: setBrightness, min: -1, max: 1, def: 0 },
    { key: 'CONTRAST', label: 'CONTRAST', value: contrast, set: setContrast, min: -1, max: 1, def: 0 },
    { key: 'SATURATION', label: 'SATURATION', value: saturate, set: setSaturate, min: -1, max: 1, def: 0 },
    { key: 'WARMTH', label: 'WARMTH', value: warmth, set: setWarmth, min: -1, max: 1, def: 0 },
    { key: 'TINT', label: 'TINT', value: tint, set: setTint, min: -1, max: 1, def: 0 },
    { key: 'BLUR', label: 'BLUR', value: blur, set: setBlur, min: 0, max: 10, def: 0 },
  ]), [brightness, contrast, saturate, warmth, tint, blur]);

  if (!visible || !baseUri) return null;

  const activeAdjust = adjustments[adjustSel];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onClose} hitSlop={8}>
            <X color={Void.text} size={24} />
          </Pressable>
          <Text style={styles.title}>EDIT PHOTO</Text>
          <Pressable onPress={() => void save()} disabled={saving || busy} hitSlop={8}>
            {saving ? <ActivityIndicator color={Void.accent} size="small" /> : <Check color={Void.accent} size={26} />}
          </Pressable>
        </View>

        {/* Preview - the stage is the crop window; pan/pinch the photo inside it */}
        <View
          style={styles.previewWrap}
          onLayout={(e) => { setContainerW(e.nativeEvent.layout.width); setContainerH(e.nativeEvent.layout.height); }}>
          {stage && disp && (
            <GestureDetector gesture={gesture}>
              <View
                ref={captureView}
                collapsable={false}
                style={[
                  styles.stage,
                  { width: stage.w, height: stage.h },
                  cropRatio != null && styles.stageCropping,
                ]}>
                <Animated.View
                  style={[
                    {
                      position: 'absolute',
                      left: (stage.w - disp.w) / 2,
                      top: (stage.h - disp.h) / 2,
                      width: disp.w,
                      height: disp.h,
                    },
                    photoAnimStyle,
                  ]}>
                  <Image
                    source={{ uri: baseUri }}
                    style={{ width: disp.w, height: disp.h }}
                    resizeMode="cover"
                    blurRadius={blur}
                    onError={(e) => console.warn('[PhotoEditor] image failed:', e.nativeEvent.error)}
                    onLoad={(e) => {
                      const { width, height } = e.nativeEvent.source;
                      if (!imgW && width && height) { setImgW(width); setImgH(height); }
                    }}
                  />
                </Animated.View>
                {/* Compositing order: adjustments -> filter -> frame, all inside
                    the stage so a max-width frame can never hide the filter. */}
                {adjustmentOverlays}
                {filter !== 'Normal' && <FilterOverlay name={filter} strength={filterStrength} />}
                <FrameOverlay style={frameStyle} thickness={frameThickness} opacity={frameOpacity} />
              </View>
            </GestureDetector>
          )}
          {busy && (
            <View style={styles.busyOverlay}>
              <ActivityIndicator color={Void.accent} size="large" />
            </View>
          )}
        </View>

        {/* Drawer + floating bar */}
        <View style={styles.bottomWrap}>
          {/* Expanding drawer */}
          {tab !== null && (
            <View style={styles.drawer}>
              {tab === 'filters' && (
                <View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                    {FILTERS.map((f) => (
                      <Pressable
                        key={f.name}
                        onPress={() => { setFilter(f.name); setFilterStrength(1); }}
                        style={styles.filterCell}>
                        <View style={[styles.filterThumb, filter === f.name && styles.filterThumbOn]}>
                          <Image source={{ uri: baseUri }} style={{ width: 64, height: 64 }} resizeMode="cover" />
                          <FilterOverlay name={f.name} />
                        </View>
                        <Text style={[styles.filterLabel, filter === f.name && styles.filterLabelOn]}>{f.label}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  {filter !== 'Normal' && (
                    <View style={styles.borderSliderRow}>
                      <Text style={styles.sliderLabel}>STRENGTH</Text>
                      <View style={{ flex: 1 }}>
                        <Slider
                          value={filterStrength}
                          min={0}
                          max={1}
                          step={0.01}
                          onChange={setFilterStrength}
                        />
                      </View>
                      <Text style={styles.sliderValue}>{Math.round(filterStrength * 100)}%</Text>
                    </View>
                  )}
                </View>
              )}

              {tab === 'adjust' && (
                <View style={styles.adjustPanel}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.adjustTabs}>
                    {adjustments.map((a, i) => {
                      const active = i === adjustSel;
                      const dirty = a.value !== a.def;
                      return (
                        <Pressable
                          key={a.key}
                          onPress={() => setAdjustSel(i)}
                          style={styles.adjustTab}>
                          <Text style={[styles.adjustTabText, active && styles.adjustTabTextOn]}>
                            {a.label}
                          </Text>
                          {dirty && !active && <View style={styles.adjustDot} />}
                          {active && <View style={styles.adjustTabUnderline} />}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <View style={styles.adjustSliderRow}>
                    <View style={{ flex: 1 }}>
                      <Slider
                        value={activeAdjust.value}
                        min={activeAdjust.min}
                        max={activeAdjust.max}
                        step={0.01}
                        onChange={activeAdjust.set}
                      />
                    </View>
                    <Pressable
                      onPress={() => activeAdjust.set(activeAdjust.def)}
                      hitSlop={6}
                      style={[styles.adjustReset, activeAdjust.value === activeAdjust.def && { opacity: 0 }]}>
                      <Text style={styles.adjustResetText}>RESET</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {tab === 'crop' && (
                <View>
                  <View style={styles.optionRow}>
                    {CROP_PRESETS.map((p) => {
                      const active = cropRatio === p.ratio;
                      return (
                        <Pressable
                          key={p.label}
                          style={[styles.optionBtn, active && styles.optionBtnOn]}
                          onPress={() => setCropRatio(p.ratio)}>
                          <Text style={[styles.optionText, active && styles.optionTextOn]}>{p.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {cropRatio != null && (
                    <Text style={styles.hint}>DRAG TO POSITION - PINCH TO ZOOM</Text>
                  )}
                </View>
              )}

              {tab === 'transform' && (
                <View style={styles.optionRow}>
                  <Pressable style={styles.iconBtn} onPress={() => void applyManip([{ rotate: -90 }])} hitSlop={4}>
                    <RotateCcw color={Void.text} size={22} />
                  </Pressable>
                  <Pressable style={styles.iconBtn} onPress={() => void applyManip([{ rotate: 90 }])} hitSlop={4}>
                    <RotateCw color={Void.text} size={22} />
                  </Pressable>
                  <Pressable style={styles.iconBtn} onPress={() => void applyManip([{ flip: FlipType.Horizontal }])} hitSlop={4}>
                    <FlipHorizontal2 color={Void.text} size={22} />
                  </Pressable>
                  <Pressable style={styles.iconBtn} onPress={() => void applyManip([{ flip: FlipType.Vertical }])} hitSlop={4}>
                    <FlipVertical2 color={Void.text} size={22} />
                  </Pressable>
                </View>
              )}

              {tab === 'frame' && (
                <View style={styles.framePanel}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                    {FRAMES.map((f) => (
                      <Pressable
                        key={f.key}
                        onPress={() => setFrameStyle(f.key)}
                        style={styles.filterCell}>
                        <View style={[styles.frameSwatch, f.key === frameStyle && styles.swatchOn]}>
                          <FrameSwatchPreview styleKey={f.key} />
                        </View>
                        <Text style={[styles.filterLabel, f.key === frameStyle && styles.filterLabelOn]}>{f.label}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  {frameStyle !== 'none' && (
                    <>
                      <View style={styles.borderSliderRow}>
                        <Text style={styles.sliderLabel}>THICKNESS</Text>
                        <View style={{ flex: 1 }}>
                          <Slider value={frameThickness} min={0} max={40} step={1} onChange={setFrameThickness} />
                        </View>
                        <Text style={styles.sliderValue}>{frameThickness}px</Text>
                      </View>
                      <View style={styles.borderSliderRow}>
                        <Text style={styles.sliderLabel}>OPACITY</Text>
                        <View style={{ flex: 1 }}>
                          <Slider value={frameOpacity} min={0} max={1} step={0.01} onChange={setFrameOpacity} />
                        </View>
                        <Text style={styles.sliderValue}>{Math.round(frameOpacity * 100)}%</Text>
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Floating icon bar */}
          <View style={styles.bar}>
            {TABS.map((t) => {
              const active = tab === t.key;
              const Icon = t.Icon;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setTab(active ? null : t.key)}
                  style={styles.barItem}
                  hitSlop={4}>
                  <Icon color={active ? Void.accent : Void.textTertiary} size={22} />
                </Pressable>
              );
            })}
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** Tiny inline preview of each frame style for the picker swatches. */
function FrameSwatchPreview({ styleKey }: { styleKey: FrameStyle }) {
  if (styleKey === 'none') {
    return <X color={Void.textTertiary} size={16} />;
  }
  if (styleKey === 'film') {
    return (
      <View style={styles.swatchInner}>
        <View style={styles.filmBar} />
        <View style={{ flex: 1 }} />
        <View style={styles.filmBar} />
      </View>
    );
  }
  const border =
    styleKey === 'thin' ? { borderWidth: 1.5, borderColor: '#fff' }
    : styleKey === 'thick' ? { borderWidth: 5, borderColor: '#000' }
    : styleKey === 'rounded' ? { borderWidth: 2, borderColor: '#fff', borderRadius: 10 }
    : { borderWidth: 2.5, borderColor: '#fff' };
  return (
    <View style={[styles.swatchInner, { padding: styleKey === 'double' ? 4 : 0 }]}>
      <View style={[{ flex: 1 }, border]}>
        {styleKey === 'double' && <View style={{ flex: 1, margin: 3, borderWidth: 1, borderColor: '#fff' }} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Void.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { color: Void.text, fontSize: 13, fontWeight: '800', letterSpacing: 2 },
  previewWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  stage: {
    backgroundColor: Void.surface,
    overflow: 'hidden',
  },
  stageCropping: {
    borderWidth: 1,
    borderColor: Void.borderStrong,
  },
  busyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  // Bottom area
  bottomWrap: { paddingHorizontal: 28, paddingBottom: 18 },
  // Drawer
  drawer: {
    backgroundColor: Void.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Void.border,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  // Floating bar - matches the app's nav bar
  bar: {
    flexDirection: 'row',
    backgroundColor: Void.surface,
    borderTopColor: Void.border,
    borderTopWidth: 1,
    borderRadius: 26,
    height: 54,
    paddingHorizontal: 4,
    paddingBottom: 2,
    paddingTop: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  barItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
    paddingHorizontal: 2,
    borderRadius: 22,
  },
  // Filters
  filterRow: { gap: 10, paddingVertical: 12, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  filterCell: { alignItems: 'center' },
  filterThumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  filterThumbOn: { borderColor: Void.accent },
  filterLabel: { color: Void.textTertiary, fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 6 },
  filterLabelOn: { color: Void.accent },
  // Adjust - tab-style selector with underline
  adjustPanel: { paddingVertical: 14, paddingHorizontal: 16 },
  adjustTabs: { gap: 0, alignItems: 'center', paddingBottom: 4 },
  adjustTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    alignItems: 'center',
  },
  adjustTabText: { color: Void.textTertiary, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  adjustTabTextOn: { color: Void.text },
  adjustDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: Void.accent, position: 'absolute', top: 4, right: 8 },
  adjustTabUnderline: {
    position: 'absolute',
    bottom: 0,
    width: 20,
    height: 2,
    borderRadius: 1,
    backgroundColor: Void.accent,
  },
  adjustSliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 10,
  },
  adjustReset: { paddingHorizontal: 8, paddingVertical: 4 },
  adjustResetText: { color: Void.accent, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  sliderLabel: { color: Void.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  sliderValue: { color: Void.textTertiary, fontSize: 10, fontWeight: '700', minWidth: 36, textAlign: 'right' },
  hint: {
    color: Void.textTertiary,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    textAlign: 'center',
    paddingBottom: 12,
  },
  // Options
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12, paddingHorizontal: 12, justifyContent: 'center' },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 99,
    backgroundColor: Void.canvas,
    borderWidth: 1,
    borderColor: Void.border,
  },
  optionBtnOn: { borderColor: Void.accent },
  optionText: { color: Void.text, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  optionTextOn: { color: Void.accent },
  iconBtn: {
    width: 48,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: Void.canvas,
    borderWidth: 1,
    borderColor: Void.border,
  },
  // Frame
  frameSwatch: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Void.border,
    backgroundColor: Void.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  swatchInner: { flex: 1, width: '100%' },
  filmBar: { height: 8, backgroundColor: '#000' },
  swatchOn: { borderColor: Void.accent },
  framePanel: { alignItems: 'center', paddingVertical: 12 },
  borderSliderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%', marginTop: 10, paddingHorizontal: 16 },
});
