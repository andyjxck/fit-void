import * as Location from 'expo-location';
import { MapPin, Timer } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { cardChrome, CardSheen } from '@/components/ui';
import { listGymMapCheckins, subscribeToCheckins, type GymCheckin } from '@/lib/social';
import { Void } from '@/theme/tokens';

// react-native-maps is a native module - require lazily so an unlinked build
// (Expo Go / stale archive) degrades to the list view instead of crashing.
type MapViewType = React.ComponentType<{
  style?: object;
  initialRegion?: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  children?: React.ReactNode;
  onMapReady?: () => void;
  ref?: unknown;
}>;
type MarkerType = React.ComponentType<{
  coordinate: { latitude: number; longitude: number };
  title?: string;
  description?: string;
  pinColor?: string;
  children?: React.ReactNode;
}>;

let MapView: MapViewType | null = null;
let Marker: MarkerType | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
} catch {
  /* maps native module not linked */
}

const timeAgo = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  return `${Math.round(h)}h ago`;
};

export function GymMapCard({ userId, onCheckIn, fullPage = false }: {
  userId: string;
  onCheckIn: () => void;
  /** Standalone-screen mode: card + map grow to fill the page and the
   *  no-map fallback lists more check-ins in a scroll view. */
  fullPage?: boolean;
}) {
  const [checkins, setCheckins] = useState<GymCheckin[]>([]);
  const [deviceRegion, setDeviceRegion] = useState<{
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  } | null>(null);
  const mapRef = useRef<{ fitToCoordinates?: (c: { latitude: number; longitude: number }[], o: object) => void } | null>(null);

  const refresh = useCallback(async () => {
    setCheckins(await listGymMapCheckins(userId));
  }, [userId]);

  useEffect(() => {
    void refresh();
    // Realtime for new check-ins + a slow poll so the 24h window/cooldown age out.
    const unsub = subscribeToCheckins(userId, () => void refresh());
    const t = setInterval(() => void refresh(), 300_000);
    return () => { unsub(); clearInterval(t); };
  }, [refresh, userId]);

  // Resolve device location so the map still has a sensible centre when no
  // check-ins carry coordinates.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) return;
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setDeviceRegion({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
          });
        }
      } catch {
        /* no location - neutral region fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const located = checkins.filter((c) => c.lat != null && c.lng != null);

  const region = located.length
    ? (() => {
        const lats = located.map((c) => c.lat as number);
        const lngs = located.map((c) => c.lng as number);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        return {
          latitude: (minLat + maxLat) / 2,
          longitude: (minLng + maxLng) / 2,
          latitudeDelta: Math.max(0.04, (maxLat - minLat) * 1.4),
          longitudeDelta: Math.max(0.04, (maxLng - minLng) * 1.4),
        };
      })()
    : deviceRegion ?? {
        // Neutral world view when neither check-ins nor device location exist.
        latitude: 20,
        longitude: 0,
        latitudeDelta: 60,
        longitudeDelta: 60,
      };

  const fallbackContent =
    checkins.length === 0 ? (
      <Text style={styles.empty}>No friends checked in yet (check-ins appear after a 2h cooldown).</Text>
    ) : (
      checkins.slice(0, fullPage ? 24 : 6).map((c) => (
        <View key={c.id} style={styles.row}>
          <MapPin color={Void.accent} size={14} />
          <Text style={styles.rowText} numberOfLines={1}>
            {c.display_name ?? 'Friend'} @ {c.gym_name}
          </Text>
          <Text style={styles.rowMeta}>{timeAgo(c.created_at)}</Text>
        </View>
      ))
    );

  return (
    <View style={[styles.card, fullPage && styles.cardFull]}>
      <CardSheen radius={16} />
      <View style={styles.header}>
        <Text style={styles.title}>FRIEND GYMS · 24H</Text>
        <Pressable style={styles.checkInBtn} onPress={onCheckIn} hitSlop={6}>
          <MapPin color={Void.accentText} size={14} />
          <Text style={styles.checkInText}>CHECK IN</Text>
        </Pressable>
      </View>

      {MapView ? (
        <>
          <MapView
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {...({ ref: mapRef } as any)}
            style={[styles.map, fullPage && styles.mapFull]}
            initialRegion={region}
            onMapReady={() => {
              if (located.length === 0) return;
              mapRef.current?.fitToCoordinates?.(
                located.map((c) => ({ latitude: c.lat as number, longitude: c.lng as number })),
                { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false }
              );
            }}>
            {located.map((c) =>
              Marker ? (
                <Marker
                  key={c.id}
                  coordinate={{ latitude: c.lat as number, longitude: c.lng as number }}
                  title={c.gym_name}
                  description={`${c.display_name ?? 'Friend'} · ${timeAgo(c.created_at)}`}
                  pinColor={Void.accent}
                />
              ) : null
            )}
          </MapView>
          {fullPage ? (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.fallback} showsVerticalScrollIndicator={false}>
              {fallbackContent}
            </ScrollView>
          ) : (
            <View style={styles.fallback}>{fallbackContent}</View>
          )}
        </>
      ) : fullPage ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.fallback} showsVerticalScrollIndicator={false}>
          {fallbackContent}
        </ScrollView>
      ) : (
        <View style={styles.fallback}>{fallbackContent}</View>
      )}

      <View style={styles.footer}>
        <Timer color={Void.textTertiary} size={11} />
        <Text style={styles.footerText}>Friends show on the map 2h after check-in</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...cardChrome,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
  },
  cardFull: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
  },
  title: { color: Void.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  checkInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Void.accent,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  checkInText: { color: Void.accentText, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  map: { height: 220 },
  // flexGrow stretches past the 220 base height to fill the card on /map.
  mapFull: { flex: 1 },
  fallback: { paddingHorizontal: 14, paddingBottom: 8 },
  empty: { color: Void.textTertiary, fontSize: 12, paddingVertical: 16, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
  rowText: { flex: 1, color: Void.text, fontSize: 12, fontWeight: '600' },
  rowMeta: { color: Void.textTertiary, fontSize: 10 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  footerText: { color: Void.textTertiary, fontSize: 9, letterSpacing: 0.5 },
});
