import * as Location from 'expo-location';
import { MapPin, Navigation } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View
} from 'react-native';

import { Sheet } from '@/components/ui/Sheet';
import { distanceUnitFor } from '@/lib/cardio';
import { formatDistance, nearbyGyms, searchGyms, type GymPlace } from '@/lib/gyms';
import { useSettings } from '@/store/settings';
import { Void } from '@/theme/tokens';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the chosen place - `lat`/`lng` null when entered by hand. */
  onPick: (gym: GymPlace) => void;
}

export function GymSearchModal({ visible, onClose, onPick }: Props) {
  const dist = distanceUnitFor(useSettings((s) => s.weight_unit));
  const [query, setQuery] = useState('');
  const [nearby, setNearby] = useState<GymPlace[]>([]);
  const [results, setResults] = useState<GymPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);

  // Resolve location once on open, then load nearby gyms.
  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setResults([]);
    setNearby([]);
    setHere(null);
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.granted) {
          // Last-known is instant; a live fix can hang for many seconds on
          // poor GPS - race it against a timeout, then fall back entirely.
          let pos = await Location.getLastKnownPositionAsync();
          if (!pos) {
            pos = await Promise.race([
              Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
              new Promise<null>((r) => setTimeout(() => r(null), 8000)),
            ]);
          }
          if (pos && !cancelled) {
            const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setHere(coords);
            setNearby(await nearbyGyms(coords));
          }
        }
      } catch (e) {
        console.warn('[GymSearchModal] location failed:', e);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Debounced name search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let stale = false;
    const t = setTimeout(async () => {
      const res = await searchGyms(q, here);
      // A slow response must not overwrite a newer query's results.
      if (!stale) setResults(res);
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [query, here]);

  const shown = query.trim() ? results : nearby;

  return (
    <Sheet visible={visible} onClose={onClose} title="TAG A GYM" style={{ maxHeight: '80%', minHeight: '55%' }}>
          <View style={styles.searchRow}>
            <MapPin color={Void.textTertiary} size={16} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search gyms…"
              placeholderTextColor={Void.textTertiary}
              autoCapitalize="words"
              autoFocus
            />
          </View>

          {busy && (
            <View style={styles.busyRow}>
              <ActivityIndicator color={Void.accent} size="small" />
              <Text style={styles.busyText}>FINDING NEARBY GYMS…</Text>
            </View>
          )}

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {query.trim().length > 0 && (
              <Pressable
                style={styles.row}
                onPress={() => onPick({ name: query.trim(), lat: null, lng: null })}>
                <Navigation color={Void.accent} size={16} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>Use "{query.trim()}"</Text>
                  <Text style={styles.rowMeta}>name only, no location</Text>
                </View>
              </Pressable>
            )}
            {shown.map((g, i) => (
              <Pressable key={`${g.name}-${i}`} style={styles.row} onPress={() => onPick(g)}>
                <MapPin color={Void.accent} size={16} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{g.name}</Text>
                  {g.distance_m != null && (
                    <Text style={styles.rowMeta}>{formatDistance(g.distance_m, dist)} away</Text>
                  )}
                </View>
              </Pressable>
            ))}
            {!busy && shown.length === 0 && !query.trim() && (
              <Text style={styles.empty}>
                Type a gym name to search, or allow location access to see nearby gyms.
              </Text>
            )}
            {!busy && query.trim().length > 0 && shown.length === 0 && (
              <Text style={styles.empty}>No matches - tap "Use" above to tag the name anyway.</Text>
            )}
          </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Void.canvas,
    borderWidth: 1,
    borderColor: Void.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  searchInput: { flex: 1, color: Void.text, fontSize: 15, padding: 0 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  busyText: { color: Void.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Void.border,
  },
  rowName: { color: Void.text, fontSize: 14, fontWeight: '600' },
  rowMeta: { color: Void.textTertiary, fontSize: 11, marginTop: 2 },
  empty: { color: Void.textTertiary, fontSize: 12, paddingVertical: 20, textAlign: 'center' },
});


