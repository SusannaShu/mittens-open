/**
 * Tier Selector -- auto-detect device RAM and pick the best local model.
 *
 * TIERS:
 *   Comfort  (7GB+):  Gemma E2B native multimodal -- best quality
 *   Standard (4-7GB): Gemma 3 1B QAT Q4 -- text-only, clean JSON via grammar
 *   Lite     (<4GB):  Gemma 3 1B QAT Q4 -- same model, fits on any device
 *
 * NOTE: Gemma 3 1B is text-only (no vision). Image inputs on standard/lite
 * tier fall through to text-only processing. Vision requires 7GB+ (E2B tier)
 * or a cloud brain.
 *
 * NOTE: Android's Device.totalMemory returns usable RAM, not physical.
 * A Pixel 7a (8GB physical) reports ~7.4GB. Threshold accounts for this.
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getModel, getDownloadSize, formatBytes, type LocalModel } from './modelRegistry';

/** Result of checking if a model can run on this device */
export interface CanRunResult {
  canRun: boolean;
  reason?: string;
}

const TIER_KEY = 'mittens_local_tier';
const CUSTOM_VISION_KEY = 'mittens_local_vision_model';
const CUSTOM_REASONING_KEY = 'mittens_local_reasoning_model';

export type LocalTier = 'comfort' | 'standard' | 'lite';

export interface TierConfig {
  tier: LocalTier;
  modelId: string;           // the single model (or multimodal model) for this tier
  totalDownloadBytes: number;
  totalDownloadDisplay: string;
  peakRAM_MB: number;
  label: string;
  description: string;
}

/** All tier definitions */
const TIER_CONFIGS: Record<LocalTier, Omit<TierConfig, 'totalDownloadBytes' | 'totalDownloadDisplay'>> = {
  comfort: {
    tier: 'comfort',
    modelId: 'gemma-e2b',
    peakRAM_MB: 1500,
    label: 'Full',
    description: 'Best quality -- Gemma 4 E2B handles text, vision, and audio in one model.',
  },
  standard: {
    tier: 'standard',
    modelId: 'gemma3-1b-q4',
    peakRAM_MB: 800,
    label: 'Balanced',
    description: 'Gemma 3 1B -- fast text reasoning with grammar-enforced JSON output.',
  },
  lite: {
    tier: 'lite',
    modelId: 'gemma3-1b-q4',
    peakRAM_MB: 800,
    label: 'Lite',
    description: 'Gemma 3 1B -- smallest download, reliable structured output.',
  },
};

/** Get device RAM in GB */
export function getDeviceRAM_GB(): number {
  return (Device.totalMemory || 0) / (1024 * 1024 * 1024);
}

let _lastDetectedTier: LocalTier | null = null;

/** Auto-detect the best tier for this device */
export function detectTier(): LocalTier {
  const ramGB = getDeviceRAM_GB();
  // Android reports usable RAM (~7.4GB for 8GB physical), so use 7GB threshold
  const tier = ramGB >= 7 ? 'comfort' : ramGB >= 4 ? 'standard' : 'lite';
  if (tier !== _lastDetectedTier) {
    console.log(`[TierSelector] RAM: ${ramGB.toFixed(1)}GB -> ${tier}`);
    _lastDetectedTier = tier;
  }
  return tier;
}

/** Build full tier config with computed download sizes */
export function getTierConfig(tier: LocalTier): TierConfig {
  const base = TIER_CONFIGS[tier];
  const model = getModel(base.modelId);
  const totalBytes = model ? getDownloadSize(model) : 0;

  return {
    ...base,
    totalDownloadBytes: totalBytes,
    totalDownloadDisplay: formatBytes(totalBytes),
  };
}

/** Get all tier configs (for display in UI) */
export function getAllTierConfigs(): TierConfig[] {
  return (['comfort', 'standard', 'lite'] as LocalTier[]).map(getTierConfig);
}

/** Save selected tier */
export async function saveTier(tier: LocalTier): Promise<void> {
  await AsyncStorage.setItem(TIER_KEY, tier);
}

/** Load saved tier (null if not yet selected) */
export async function getSavedTier(): Promise<LocalTier | null> {
  const saved = await AsyncStorage.getItem(TIER_KEY);
  if (saved === 'comfort' || saved === 'standard' || saved === 'lite') return saved;
  return null;
}

/** Get the active tier (saved or auto-detected, validated against actual device) */
export async function getActiveTier(): Promise<LocalTier> {
  const saved = await getSavedTier();
  const detected = detectTier();

  if (!saved) return detected;

  // If saved tier is lower than what the device can handle, upgrade
  // This handles threshold changes (e.g. 8GB -> 7GB comfort threshold)
  const rank: Record<LocalTier, number> = { lite: 0, standard: 1, comfort: 2 };
  if (rank[saved] < rank[detected]) {
    console.log(`[TierSelector] Upgrading saved tier ${saved} -> ${detected}`);
    await saveTier(detected);
    return detected;
  }

  return saved;
}

/** Get the active tier config */
export async function getActiveTierConfig(): Promise<TierConfig> {
  const tier = await getActiveTier();
  return getTierConfig(tier);
}

/**
 * Check if a specific local model can run on this device.
 * Uses Device.totalMemory to check against the model's minRAM_GB.
 * iPhone SE 3 (A15, 4GB) reports ~3.7GB via expo-device.
 */
export function canRunModel(modelId: string): CanRunResult {
  const model = getModel(modelId);
  if (!model) return { canRun: false, reason: 'Unknown model' };



  const ramGB = getDeviceRAM_GB();
  const minRAM = model.minRAM_GB ?? 0;

  if (ramGB < minRAM) {
    return {
      canRun: false,
      reason: `needs ${minRAM}GB+`,
    };
  }
  return { canRun: true };
}
