/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'watch',
  name: 'watch',
  displayName: 'Fit Void',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '10.0',
  // Single-size 1024 icon - plugin generates the AppIcon asset catalog and
  // ASSETCATALOG_COMPILER_APPICON_NAME so archive validation passes.
  icon: '../../assets/images/watchlogo.png',
  frameworks: ['SwiftUI', 'WatchConnectivity', 'HealthKit', 'CoreLocation'],
  entitlements: {
    // Watch-side HKWorkoutSession (Phase E) needs HealthKit on the watch too.
    'com.apple.developer.healthkit': true,
  },
});
