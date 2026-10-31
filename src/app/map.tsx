import { useRouter } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GymMapCard } from '@/components/social/GymMap';
import { GymSearchModal } from '@/components/social/GymSearchModal';
import { Screen, ScreenHeader } from '@/components/ui';
import { createGymCheckin } from '@/lib/social';
import { notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { Void } from '@/theme/tokens';
import { goBack } from '@/lib/nav';

export default function MapScreen() {
  const router = useRouter();
  const userId = useSettings((s) => s.supabase_user_id);
  const [gymPickOpen, setGymPickOpen] = useState(false);

  return (
    <Screen>
      <ScreenHeader title="At the Gym" onBack={() => goBack()} />
      {userId ? (
        <GymMapCard userId={userId} onCheckIn={() => setGymPickOpen(true)} fullPage />
      ) : (
        <View style={styles.guestWrap}>
          <MapPin color={Void.textTertiary} size={28} />
          <Text style={styles.guestText}>
            Sign in on the Feed tab to see where your friends are training.
          </Text>
        </View>
      )}

      {/* Standalone check-in (no post) from the map card */}
      <GymSearchModal
        visible={gymPickOpen}
        onClose={() => setGymPickOpen(false)}
        onPick={(gym) => {
          setGymPickOpen(false);
          if (!userId) return;
          void createGymCheckin(userId, { gym_name: gym.name, lat: gym.lat, lng: gym.lng })
            .then((res) => {
              if (res.ok) notify('Checked in', { body: `${gym.name} - friends see it on the map after a 2h cooldown.`, tone: 'success' });
              else notify('Check-in failed', { body: res.error ?? 'Could not check in. Try again.', tone: 'error' });
            });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  guestWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 14,
  },
  guestText: {
    color: Void.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
