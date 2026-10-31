import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { ClipPath, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';

import { Card } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import { formatVolume } from '@/lib/format';
import { muscleHeat, type MuscleHeatResult } from '@/lib/muscleHeat';
import {
    BODY_SILHOUETTE,
    BODY_SILHOUETTE_F,
    MUSCLE_REGIONS,
    MUSCLE_REGIONS_F,
    type MuscleRegion,
    type MuscleView,
} from '@/lib/muscleMap';
import { useSettings } from '@/store/settings';
import { tabular, Void } from '@/theme/tokens';

const DAY_OPTIONS = [7, 14, 30] as const;
const LEGEND = ['Resting', 'Light', 'Moderate', 'Heavy', 'Max'];

/** Resting muscle fill - clearly visible against the dark card. */
const RESTING_FILL = '#2A2A2A';

/** 0 = neutral dark, ramps to electric lime at full intensity. */
function heatColor(t: number): string {
  if (t <= 0) return RESTING_FILL;
  const r = Math.round(36 + (204 - 36) * t);
  const g = Math.round(54 + (255 - 54) * t);
  return `rgb(${r},${g},0)`;
}

const LEGEND_STOPS = [0, 0.25, 0.5, 0.75, 1].map((t) => heatColor(t));

function RegionShape({
  region,
  fill,
  selected,
  onPress,
}: {
  region: MuscleRegion;
  fill: string;
  selected: boolean;
  onPress: () => void;
}) {
  const opacity = fill === RESTING_FILL ? 0.9 : 0.95;
  const stroke = selected ? Void.accent : 'rgba(0,0,0,0.5)';
  const strokeWidth = selected ? 1.5 : 1;
  if (region.shape.kind === 'ellipse') {
    return null;
  }
  return <Path d={region.shape.d} fill={fill} opacity={opacity} stroke={stroke} strokeWidth={strokeWidth} onPress={onPress} />;
}

export function BodyHeatmap() {
  const unit = useSettings((s) => s.weight_unit);
  const sex = useSettings((s) => s.sex);
  const [view, setView] = useState<MuscleView>('front');
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<MuscleHeatResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<'volume' | 'sets' | 'kcal' | null>(null);
  // Stale-load guard: a slow 30d query must not overwrite a newer 7d result.
  const reqId = useRef(0);

  const load = useCallback(
    async (d: number) => {
      const id = ++reqId.current;
      const res = await muscleHeat(d);
      if (id === reqId.current) setData(res);
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      void load(days);
    }, [days, load])
  );

  const heat = data?.heat ?? new Map<string, number>();
  const volume = data?.volume ?? new Map<string, number>();
  const female = sex === 'female';
  const silhouette = female ? BODY_SILHOUETTE_F : BODY_SILHOUETTE;
  const regions = (female ? MUSCLE_REGIONS_F : MUSCLE_REGIONS).filter((r) => r.view === view);

  const selIntensity = selected ? heat.get(selected) ?? 0 : 0;
  const selVolume = selected ? volume.get(selected) ?? 0 : 0;

  return (
    <Card style={{ padding: 14 }}>
      {/* Controls */}
      <View style={s.controls}>
        <View style={s.dayRow}>
          {DAY_OPTIONS.map((d) => (
            <Pressable
              key={d}
              onPress={() => setDays(d)}
              style={[s.dayPill, days === d && s.dayPillActive]}>
              <Text style={[s.dayText, days === d && s.dayTextActive]}>{d}d</Text>
            </Pressable>
          ))}
        </View>
        <View style={s.viewToggle}>
          <Pressable
            onPress={() => setView('front')}
            style={[s.viewBtn, view === 'front' && s.viewBtnActive]}>
            <Text style={[s.viewText, view === 'front' && s.viewTextActive]}>Front</Text>
          </Pressable>
          <Pressable
            onPress={() => setView('back')}
            style={[s.viewBtn, view === 'back' && s.viewBtnActive]}>
            <Text style={[s.viewText, view === 'back' && s.viewTextActive]}>Back</Text>
          </Pressable>
        </View>
      </View>

      {/* Silhouette */}
      <View style={s.svgWrap}>
        <Svg width="100%" height={300} viewBox="0 0 200 440" preserveAspectRatio="xMidYMid meet">
          <Defs>
            <LinearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#303030" />
              <Stop offset="1" stopColor="#1E1E1E" />
            </LinearGradient>
            <ClipPath id="bodyClip">
              <Path d={silhouette} />
            </ClipPath>
          </Defs>
          <Path d={silhouette} fill="url(#skin)" stroke="#4A4A4A" strokeWidth={1} />
          <G clipPath="url(#bodyClip)">
            {regions.map((r, i) => {
              const t = heat.get(r.muscle) ?? 0;
              return (
                <RegionShape
                  key={`${r.muscle}-${r.view}-${i}`}
                  region={r}
                  fill={heatColor(t)}
                  selected={selected === r.muscle}
                  onPress={() => setSelected(r.muscle)}
                />
              );
            })}
          </G>
        </Svg>
      </View>

      {/* Tooltip */}
      <View style={s.tooltip}>
        {selected ? (
          <View style={s.tooltipRow}>
            <View style={[s.tooltipDot, { backgroundColor: heatColor(selIntensity) }]} />
            <Text style={s.tooltipMuscle}>{selected}</Text>
            <Text style={s.tooltipMeta}>
              {Math.round(selIntensity * 100)}% · {formatVolume(selVolume, unit)} {unit}
            </Text>
          </View>
        ) : (
          <Text style={s.tooltipHint}>Tap a muscle to see its volume.</Text>
        )}
      </View>

      {/* Legend */}
      <View style={s.legend}>
        {LEGEND_STOPS.map((c, i) => (
          <View key={i} style={s.legendItem}>
            <View style={[s.legendSwatch, { backgroundColor: c }]} />
            <Text style={s.legendLabel}>{LEGEND[i]}</Text>
          </View>
        ))}
      </View>

      {/* Stats - tap for the detailed breakdown */}
      <View style={s.stats}>
        <Pressable style={s.stat} onPress={() => setDetail('volume')} hitSlop={6}>
          <Text style={s.statVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {data ? formatVolume(data.totalVolume, unit) : '-'}
          </Text>
          <Text style={s.statLabel}>{unit.toUpperCase()} LIFTED</Text>
        </Pressable>
        <Pressable style={s.stat} onPress={() => setDetail('sets')} hitSlop={6}>
          <Text style={s.statVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {data?.sets ?? '-'}
          </Text>
          <Text style={s.statLabel}>HARD SETS</Text>
        </Pressable>
        <Pressable style={s.stat} onPress={() => setDetail('kcal')} hitSlop={6}>
          <Text style={[s.statVal, { color: Void.accent }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {data?.calories ?? '-'}
          </Text>
          <Text style={s.statLabel}>KCAL EATEN</Text>
        </Pressable>
      </View>

      <Sheet visible={detail != null} onClose={() => setDetail(null)}>
        <View style={s.detailSheet}>
          <Text style={s.detailTitle}>
            {detail === 'volume' ? `${unit.toUpperCase()} LIFTED · ${days}D` : detail === 'sets' ? `HARD SETS · ${days}D` : `KCAL EATEN · ${days}D`}
          </Text>
          {detail === 'volume' &&
            [...(data?.volume.entries() ?? [])]
              .sort((a, b) => b[1] - a[1])
              .map(([muscle, v]) => (
                <View key={muscle} style={s.detailRow}>
                  <Text style={s.detailName}>{muscle}</Text>
                  <Text style={s.detailVal}>{formatVolume(v, unit)} {unit}</Text>
                </View>
              ))}
          {detail === 'sets' &&
            [...(data?.setsByMuscle.entries() ?? [])]
              .sort((a, b) => b[1] - a[1])
              .map(([muscle, n]) => (
                <View key={muscle} style={s.detailRow}>
                  <Text style={s.detailName}>{muscle}</Text>
                  <Text style={s.detailVal}>{n} sets</Text>
                </View>
              ))}
          {detail === 'kcal' &&
            (data?.caloriesByDay ?? []).map((d) => (
              <View key={d.day} style={s.detailRow}>
                <Text style={s.detailName}>
                  {new Date(`${d.day}T12:00:00`).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}
                </Text>
                <Text style={s.detailVal}>{Math.round(d.calories)} kcal</Text>
              </View>
            ))}
          {detail != null && (data == null || (detail === 'volume' && data.volume.size === 0) || (detail === 'sets' && data.setsByMuscle.size === 0)) && (
            <Text style={s.detailEmpty}>Nothing logged in this window.</Text>
          )}
        </View>
      </Sheet>
    </Card>
  );
}

const s = StyleSheet.create({
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  dayRow: { flexDirection: 'row', gap: 6 },
  dayPill: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: Void.border },
  dayPillActive: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  dayText: { color: Void.textSecondary, fontSize: 12, fontWeight: '700', ...tabular },
  dayTextActive: { color: Void.accent },
  viewToggle: { flexDirection: 'row', gap: 6 },
  viewBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: Void.border },
  viewBtnActive: { borderColor: Void.accent, backgroundColor: Void.accentDim },
  viewText: { color: Void.textSecondary, fontSize: 12, fontWeight: '700' },
  viewTextActive: { color: Void.accent },
  svgWrap: { alignItems: 'center', marginVertical: 4 },
  tooltip: { minHeight: 22, justifyContent: 'center' },
  tooltipRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tooltipDot: { width: 10, height: 10, borderRadius: 5 },
  tooltipMuscle: { color: Void.text, fontSize: 13, fontWeight: '700' },
  tooltipMeta: { color: Void.textSecondary, fontSize: 12, ...tabular },
  tooltipHint: { color: Void.textTertiary, fontSize: 12 },
  legend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  legendItem: { alignItems: 'center', gap: 4 },
  legendSwatch: { width: 18, height: 10, borderRadius: 2 },
  legendLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '600' },
  stats: { flexDirection: 'row', marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Void.border },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  statVal: { color: Void.text, fontSize: 18, fontWeight: '800', ...tabular },
  statLabel: { color: Void.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  detailSheet: { paddingHorizontal: 20, paddingBottom: 34 },
  detailTitle: { color: Void.text, fontSize: 15, fontWeight: '800', letterSpacing: 0.6, marginBottom: 14 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border },
  detailName: { color: Void.textSecondary, fontSize: 13, fontWeight: '600' },
  detailVal: { color: Void.text, fontSize: 13, fontWeight: '700', ...tabular },
  detailEmpty: { color: Void.textTertiary, fontSize: 13, paddingVertical: 12 },
});
