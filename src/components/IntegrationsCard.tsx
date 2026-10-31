import { Activity, Heart, HeartPulse, Watch } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, SectionLabel } from '@/components/ui';
import { logMeasurement } from '@/db/repo/measurements';
import {
    connectGoogleHealth,
    disconnectGoogleHealth,
    getGoogleProfileFields,
    googleHealthConfigured,
} from '@/lib/googleHealth';
import { importGoogleHealthData } from '@/lib/googleHealthImport';
import {
    getHealthCharacteristics,
    getHealthToday,
    getLatestWeightKg,
    isHealthAvailable,
    requestHealthAuth
} from '@/lib/health';
import { importHealthData } from '@/lib/healthImport';
import {
    HEALTH_QUOTA_MESSAGE,
    HealthQuotaError,
    healthImportsRemaining,
    isPro,
    showUpgradePrompt
} from '@/lib/tiers';
import { notify } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { Void } from '@/theme/tokens';

/** Fill local profile fields (height, birth year, sex, activity) from Google
 *  Health when unset - never overwrites a value the user set themselves. */
export async function applyGoogleProfileFields(): Promise<void> {
  const s = useSettings.getState();
  const needs = s.height_cm == null || s.birth_year == null || s.sex == null;
  if (!needs && s.activity_level !== 'moderate') return;
  const fields = await getGoogleProfileFields().catch(() => null);
  if (!fields) return;
  const patch: Partial<typeof s> = {};
  if (s.height_cm == null && fields.heightCm != null) patch.height_cm = fields.heightCm;
  if (s.birth_year == null && fields.birthYear != null) patch.birth_year = fields.birthYear;
  if (s.sex == null && fields.sex != null) patch.sex = fields.sex;
  // 'moderate' is the factory default - a measured level beats it.
  if (s.activity_level === 'moderate' && fields.activityLevel != null) {
    patch.activity_level = fields.activityLevel;
  }
  if (Object.keys(patch).length > 0) {
    s.set(patch);
    notify('Profile filled from Google', {
      body: `Set ${Object.keys(patch).join(', ').replace(/_/g, ' ')}.`,
      tone: 'success',
    });
  }
}

/** Fill local profile fields (birth year, sex, height) from Apple Health
 *  characteristics when unset - never overwrites user-set values. */
export async function applyHealthProfileFields(): Promise<void> {
  const s = useSettings.getState();
  if (s.height_cm != null && s.birth_year != null && s.sex != null) return;
  const c = await getHealthCharacteristics().catch(() => null);
  if (!c) return;
  const patch: Partial<typeof s> = {};
  if (s.height_cm == null && c.heightCm != null) patch.height_cm = c.heightCm;
  if (s.birth_year == null && c.birthYear != null) patch.birth_year = c.birthYear;
  if (s.sex == null && c.sex != null) patch.sex = c.sex;
  if (Object.keys(patch).length > 0) {
    s.set(patch);
    notify('Profile filled from Apple Health', {
      body: `Set ${Object.keys(patch).join(', ').replace(/_/g, ' ')}.`,
      tone: 'success',
    });
  }
}

/** Connected-app rows: Apple Health / Health Connect + Google Health (Fitbit). */
export function IntegrationsCard() {
  const fitbitConnected = useSettings((s) => s.fitbit_connected);
  const [healthConnected, setHealthConnected] = useState(false);
  const [importsLeft, setImportsLeft] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const available = await isHealthAvailable();
      setHealthConnected(available && useSettings.getState().health_connected);
      if (!isPro()) setImportsLeft(await healthImportsRemaining());
    })();
  }, []);

  const connectHealth = useCallback(async () => {
    try {
      const { status, error } = await requestHealthAuth();
      if (status === 'authorized') {
        const latest = await getLatestWeightKg();
        if (latest) {
          await logMeasurement({ metric_type: 'weight', value: latest.value, logged_at: latest.date });
        }
        await applyHealthProfileFields();
        const imported = await importHealthData(useSettings.getState().supabase_user_id);
        setHealthConnected(true);
        void getHealthToday();
        useSettings.getState().set({ health_connected: true });
        notify('Health connected', {
          body:
            `Imported ${imported.cardio} cardio session${imported.cardio === 1 ? '' : 's'}, ` +
            `${imported.sleep} sleep night${imported.sleep === 1 ? '' : 's'} and ` +
            `${imported.restingHr} resting HR reading${imported.restingHr === 1 ? '' : 's'}.`,
          tone: 'success',
        });
      } else if (status === 'notauthorized') {
        notify('Permission needed', {
          body: error
            ? `HealthKit said: ${error}`
            : 'Enable Apple Health in Settings → Privacy → Health to sync your data.',
          tone: 'error',
        });
      } else {
        notify('Apple Health unavailable', { body: error ?? 'Not supported on this device.', tone: 'error' });
      }
    } catch (e) {
      if (e instanceof HealthQuotaError) {
        showUpgradePrompt('Weekly import limit', HEALTH_QUOTA_MESSAGE);
      } else {
        notify('Apple Health error', { body: e instanceof Error ? e.message : 'Failed to connect to Apple Health.', tone: 'error' });
      }
    }
  }, []);

  const connectFitbitNow = useCallback(async () => {
    if (useSettings.getState().fitbit_connected) {
      await disconnectGoogleHealth();
      useSettings.getState().set({ fitbit_connected: false });
      notify('Fitbit disconnected', { tone: 'info' });
      return;
    }
    if (!googleHealthConfigured()) {
      notify('Google Health not configured', {
        body: 'Add your Google Cloud OAuth client ID in src/lib/googleHealth.ts.',
        tone: 'error',
      });
      return;
    }
    const res = await connectGoogleHealth();
    if (res === 'cancelled') return;
    if (res === 'error') {
      notify('Fitbit connect failed', {
        body: 'Check the OAuth client and scopes in Google Cloud, and that your account is a test user.',
        tone: 'error',
      });
      return;
    }
    useSettings.getState().set({ fitbit_connected: true });
    await applyGoogleProfileFields().catch(() => {});
    const imported = await importGoogleHealthData(useSettings.getState().supabase_user_id).catch((e) => {
      if (e instanceof HealthQuotaError) {
        showUpgradePrompt('Weekly import limit', HEALTH_QUOTA_MESSAGE);
      } else {
        notify('Fitbit import failed', {
          body: e instanceof Error ? e.message : 'Google Health import failed - try again.',
          tone: 'error',
        });
      }
      return null;
    });
    if (!imported) return;
    notify('Fitbit connected', {
      body:
        `Imported ${imported.cardio} workout${imported.cardio === 1 ? '' : 's'}, ` +
        `${imported.sleep} sleep night${imported.sleep === 1 ? '' : 's'}, ` +
        `${imported.restingHr} resting HR, ${imported.weight} weight reading${imported.weight === 1 ? '' : 's'}, ` +
        `${imported.bodyFat} body fat, ${imported.hydration} drink${imported.hydration === 1 ? '' : 's'} and ` +
        `${imported.food} food log${imported.food === 1 ? '' : 's'}.`,
      tone: 'success',
    });
  }, []);

  return (
    <>
      <SectionLabel>CONNECT</SectionLabel>
      <Card style={{ paddingVertical: 6 }}>
        {/* Apple Health / Health Connect */}
        <Pressable
          style={[styles.row, styles.rowBorder]}
          onPress={() => {
            if (healthConnected) {
              useSettings.getState().set({ health_connected: false });
              setHealthConnected(false);
              notify('Health disconnected', {
                body: `Stopped importing. Imported data stays. Revoke access fully in ${Platform.OS === 'android' ? 'Health Connect' : 'Settings → Health → Data Access'}.`,
                tone: 'info',
              });
            } else {
              void connectHealth();
            }
          }}>
          <Heart color={Void.textSecondary} size={18} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.label}>
              {Platform.OS === 'android' ? 'Health Connect' : 'Apple Health'}
            </Text>
            <Text style={styles.sub}>
              {healthConnected
                ? `Connected - tap to disconnect${importsLeft != null ? ` · ${importsLeft} import${importsLeft === 1 ? '' : 's'} left this week` : ''}`
                : 'Sync weight, workouts, sleep, HR & activity'}
            </Text>
          </View>
          <Text style={styles.badge}>{healthConnected ? 'CONNECTED' : 'CONNECT'}</Text>
        </Pressable>

        {/* Apple Watch + Google Fit - only prompt while health isn't connected */}
        {!healthConnected && (
          <>
            <Pressable
              style={[styles.row, styles.rowBorder]}
              onPress={() => void connectHealth()}>
              <Watch color={Void.textSecondary} size={18} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.label}>Apple Watch</Text>
                <Text style={styles.sub}>Heart rate & active energy</Text>
              </View>
              <Text style={styles.badge}>CONNECT</Text>
            </Pressable>

            {Platform.OS === 'android' && (
              <Pressable
                style={[styles.row, styles.rowBorder]}
                onPress={() => void connectHealth()}>
                <Activity color={Void.textSecondary} size={18} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.label}>Google Fit</Text>
                  <Text style={styles.sub}>Activity & steps</Text>
                </View>
                <Text style={styles.badge}>CONNECT</Text>
              </Pressable>
            )}
          </>
        )}

        {/* Fitbit / Pixel Watch - Google Health API (Fitbit's successor) */}
        <Pressable
          style={styles.row}
          onPress={() => void connectFitbitNow()}>
          <HeartPulse color={Void.textSecondary} size={18} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.label}>Fitbit / Pixel Watch</Text>
            <Text style={styles.sub}>
              {fitbitConnected
                ? `Connected - tap to disconnect${importsLeft != null ? ` · ${importsLeft} import${importsLeft === 1 ? '' : 's'} left this week` : ''}`
                : 'Workouts, HR, sleep, water & food via Google Health'}
            </Text>
          </View>
          <Text style={styles.badge}>
            {fitbitConnected ? 'CONNECTED' : 'CONNECT'}
          </Text>
        </Pressable>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Void.border },
  label: { color: Void.text, fontSize: 14, fontWeight: '600' },
  sub: { color: Void.textTertiary, fontSize: 11, marginTop: 1 },
  badge: { color: Void.textTertiary, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
});
