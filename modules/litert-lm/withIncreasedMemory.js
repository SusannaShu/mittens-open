/**
 * Expo config plugin to add the "Increased Memory Limit" entitlement on iOS.
 *
 * Required for loading the Gemma 4 E2B model (~2.58 GB) on memory-constrained
 * devices like iPhone SE3 (4 GB RAM). Without this entitlement, iOS will
 * terminate the app when it exceeds the default memory budget during model load.
 *
 * This entitlement tells the OS to allow the app to use more memory than
 * the default limit. It's not a guarantee -- iOS can still kill the app
 * under extreme pressure -- but it raises the threshold significantly.
 *
 * Only affects iOS builds. Android has no equivalent restriction.
 */

const { withEntitlementsPlist } = require('expo/config-plugins');

function withIncreasedMemory(config) {
  return withEntitlementsPlist(config, (config) => {
    config.modResults['com.apple.developer.kernel.increased-memory-limit'] = true;
    return config;
  });
}

module.exports = withIncreasedMemory;
