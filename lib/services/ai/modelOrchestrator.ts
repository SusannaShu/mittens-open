/**
 * ModelOrchestrator -- tier-aware device capability checker.
 *
 * With Gemma 3 1B (text-only via llama.rn) for Standard/Lite tiers,
 * there is NO model swapping needed. The orchestrator now simply:
 *   - Reports device RAM and tier
 *   - Checks if local inference is available
 *   - Provides helpers used by the Profile UI
 *
 * Model lifecycle is handled directly by each Brain implementation:
 *   Full tier:      E2BBrain manages LiteRT-LM
 *   Standard/Lite:  LlamaRNBrain manages llama.rn with Gemma 3 1B
 */

import * as Device from 'expo-device';
import { getActiveTier, type LocalTier } from './tierSelector';

const COMFORT_RAM_THRESHOLD_GB = 8;

export class ModelOrchestrator {
  /**
   * Check if the device is memory-constrained (below comfort threshold).
   * Used by the Profile UI to show tier info.
   */
  static isLowRAMDevice(): boolean {
    return this.getDeviceRAMGB() < COMFORT_RAM_THRESHOLD_GB;
  }

  /** Get total device RAM in GB */
  static getDeviceRAMGB(): number {
    return (Device.totalMemory || 0) / (1024 * 1024 * 1024);
  }

  /** Get the current tier */
  static async getTier(): Promise<LocalTier> {
    return getActiveTier();
  }

  /**
   * Check if any local brain is currently available.
   * Returns true if either E2B or llama.rn models are downloaded.
   */
  static async isLocalAvailable(): Promise<boolean> {
    try {
      const { isLocalBrainAvailable } = require('../../brain/selector');
      return isLocalBrainAvailable();
    } catch {
      return false;
    }
  }
}
