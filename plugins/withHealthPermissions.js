/**
 * Declares Health Connect uses-permissions in the Android manifest.
 * react-native-health-connect's own plugin only wires the permission-rationale
 * intent filters - record permissions must be declared by the app itself, and
 * this keeps them durable across `expo prebuild --clean`.
 */
const { AndroidConfig, createRunOncePlugin, withAndroidManifest } = require('@expo/config-plugins');

const PERMISSIONS = [
  'android.permission.health.READ_EXERCISE',
  'android.permission.health.READ_DISTANCE',
  'android.permission.health.READ_HEART_RATE',
  'android.permission.health.READ_SLEEP',
  'android.permission.health.READ_RESTING_HEART_RATE',
  'android.permission.health.READ_WEIGHT',
];

const withHealthPermissions = (config) =>
  withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] ?? [];
    const existing = new Set(
      manifest['uses-permission'].map((p) => p.$?.['android:name']).filter(Boolean)
    );
    for (const p of PERMISSIONS) {
      if (!existing.has(p)) {
        manifest['uses-permission'].push({ $: { 'android:name': p } });
      }
    }
    return c;
  });

module.exports = createRunOncePlugin(withHealthPermissions, 'with-health-permissions', '1.0.0');
