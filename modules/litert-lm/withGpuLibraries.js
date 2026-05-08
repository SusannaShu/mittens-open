/**
 * Expo config plugin to add GPU native library declarations to AndroidManifest.xml.
 * Required by LiteRT-LM for GPU-accelerated inference on Android.
 *
 * These <uses-native-library> tags are optional (required="false") -- the app
 * still works on devices without GPU support, just using CPU fallback.
 */

const { withAndroidManifest } = require('expo/config-plugins');

function withGpuLibraries(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const app = manifest.manifest.application?.[0];

    if (!app) return config;

    // Ensure the 'uses-native-library' array exists
    if (!app['uses-native-library']) {
      app['uses-native-library'] = [];
    }

    const libs = app['uses-native-library'];

    // Add libvndksupport.so if not already present
    if (!libs.find(l => l.$?.['android:name'] === 'libvndksupport.so')) {
      libs.push({
        $: {
          'android:name': 'libvndksupport.so',
          'android:required': 'false',
        },
      });
    }

    // Add libOpenCL.so if not already present
    if (!libs.find(l => l.$?.['android:name'] === 'libOpenCL.so')) {
      libs.push({
        $: {
          'android:name': 'libOpenCL.so',
          'android:required': 'false',
        },
      });
    }

    return config;
  });
}

module.exports = withGpuLibraries;
