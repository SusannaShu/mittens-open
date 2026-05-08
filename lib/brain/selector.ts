/**
 * Brain Selector -- returns the correct Brain based on user settings.
 *
 * REPLACES: the inference half of lib/providers/providerFactory.ts
 * (data provider half stays -- it's a separate concern)
 *
 * USAGE:
 *   import { getBrain } from '../brain/selector';
 *   const brain = await getBrain();
 *   const result = await brain.text('identify this food');
 *
 * BRIDGE:
 *   The profile UI writes inferenceMode + ollamaConfig via providerFactory.
 *   This selector reads those same keys so the two systems stay in sync.
 *
 * LOCAL AI TIERS:
 *   Comfort  (8GB+): E2B brain via LiteRT-LM (Gemma 4 E2B multimodal)
 *   Standard (4-6GB): LlamaRN brain via llama.rn (Gemma 3 1B, text-only)
 *   Lite     (3GB):   LlamaRN brain via llama.rn (Gemma 3 1B Q4, text-only)
 *
 * The brain is cached per config. If user changes settings, cache invalidates.
 */

import { Brain, BrainId } from './types';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BRAIN_KEY = 'mittens_brain_id';
const INFERENCE_KEY = 'mittens_inference_mode';
const OLLAMA_URL_KEY = 'mittens_ollama_url';
const OLLAMA_API_KEY = 'mittens_ollama_key';
const OLLAMA_MODEL_KEY = 'mittens_ollama_model';
const GEMINI_API_KEY = 'mittens_gemini_api_key';
const CLAUDE_API_KEY = 'mittens_claude_api_key';
const CLAUDE_VARIANT_KEY = 'mittens_claude_variant';

const BACKEND_CLOUD_BRAINS = new Set([
  'gemini-flash',
  'claude-sonnet',
  'claude-opus',
  'groq-free',
  'openrouter-free',
]);

let cachedBrain: Brain | null = null;
let cachedBrainId: BrainId | null = null;
let resolvedBrainId: BrainId | null = null;

/** Get the currently selected brain */
export async function getBrain(): Promise<Brain> {
  const id = await getBrainId();
  if (cachedBrain && cachedBrainId === id) return cachedBrain;

  cachedBrain = await createBrain(id);
  cachedBrainId = id;
  return cachedBrain;
}

/**
 * Get just the brain ID.
 *
 * Derives the ID from the inference mode that the profile UI writes,
 * rather than maintaining a separate key. This ensures the brain
 * selector stays in sync with the profile model selection.
 *
 * Results are cached in memory -- call invalidateBrainCache() to reset.
 */
export async function getBrainId(): Promise<BrainId> {
  if (resolvedBrainId) return resolvedBrainId;

  // First check explicit brain ID (set by setBrainId)
  const explicit = await AsyncStorage.getItem(BRAIN_KEY);
  if (explicit) {
    // Legacy 'gemini' brain ID -> route through backend cloud instead of direct API
    if (explicit === 'gemini') {
      await AsyncStorage.setItem(BRAIN_KEY, 'gemini-flash');
      resolvedBrainId = 'gemini-flash';
      return resolvedBrainId;
    }

    // New local VLM brain IDs -- these are explicit model selections, no tier correction needed
    if (['fastvlm', 'smolvlm2', 'moondream2'].includes(explicit)) {
      resolvedBrainId = explicit as BrainId;
      return resolvedBrainId;
    }

    // Validate legacy local brain IDs against the actual tier to prevent mismatches
    // (e.g. 'llama-rn' saved but device upgraded to comfort tier)
    if (explicit === 'llama-rn' || explicit === 'e2b') {
      const { getActiveTier } = require('../services/ai/tierSelector');
      const tier = await getActiveTier();
      const correctId = tier === 'comfort' ? 'e2b' : 'llama-rn';
      if (explicit !== correctId) {
        console.log(`[Selector] Correcting brain ID: ${explicit} -> ${correctId} (tier: ${tier})`);
        await AsyncStorage.setItem(BRAIN_KEY, correctId);
        cachedBrain = null;
        cachedBrainId = null;
        resolvedBrainId = correctId as BrainId;
        return resolvedBrainId;
      }
    }
    resolvedBrainId = explicit as BrainId;
    return resolvedBrainId;
  }

  // Derive from inference mode (written by profile UI)
  const inferenceMode = await AsyncStorage.getItem(INFERENCE_KEY);
  switch (inferenceMode) {
    case 'claude': {
      const variant = await AsyncStorage.getItem(CLAUDE_VARIANT_KEY);
      resolvedBrainId = variant === 'claude-opus' ? 'claude-opus' : 'claude-sonnet';
      break;
    }
    case 'ollama':
      resolvedBrainId = 'gemma26b';
      break;
    case 'gemini':
      // Inference mode 'gemini' is a legacy catch-all for cloud brains.
      // Default to E2B (on-device) unless user explicitly chose a cloud brain.
      resolvedBrainId = 'e2b';
      break;
    default:
      resolvedBrainId = 'e2b';
  }
  return resolvedBrainId!;
}

/** Change the brain (invalidates cache) */
export async function setBrainId(id: BrainId): Promise<void> {
  await AsyncStorage.setItem(BRAIN_KEY, id);
  cachedBrain = null;
  cachedBrainId = null;
  resolvedBrainId = null;
}

/** Invalidate cache (call when user changes config like Ollama URL) */
export function invalidateBrainCache(): void {
  cachedBrain = null;
  cachedBrainId = null;
  resolvedBrainId = null;
}

/** Check if any on-device brain is available */
export function isLocalBrainAvailable(): boolean {
  try {
    const { LocalInferenceService } = require('../services/ai/localInference');
    if (LocalInferenceService.isNativeAvailable() && LocalInferenceService.isModelLoaded()) return true;
  } catch {}
  try {
    const { LlamaRNBrain } = require('./llamaRN');
    if (LlamaRNBrain.isReasoningLoaded()) return true;
  } catch {}
  return false;
}

/** @deprecated Use isLocalBrainAvailable instead */
export function isE2BAvailable(): boolean {
  return isLocalBrainAvailable();
}

// -- Internal --

async function createBrain(id: BrainId): Promise<Brain> {
  if (BACKEND_CLOUD_BRAINS.has(id)) {
    const { BackendCloudBrain } = require('./backendCloud');
    return new BackendCloudBrain(id);
  }

  switch (id) {
    case 'e2b': {
      const { E2BBrain } = require('./e2b');
      return new E2BBrain();
    }
    case 'llama-rn': {
      const { LlamaRNBrain } = require('./llamaRN');
      const { getActiveTierConfig } = require('../services/ai/tierSelector');
      const tierConfig = await getActiveTierConfig();
      return new LlamaRNBrain({
        tier: tierConfig.tier as 'standard' | 'lite',
        modelId: tierConfig.modelId,
      });
    }
    case 'gemma26b': {
      const { Gemma26BBrain } = require('./gemma26b');
      const [url, key, model] = await Promise.all([
        AsyncStorage.getItem(OLLAMA_URL_KEY),
        AsyncStorage.getItem(OLLAMA_API_KEY),
        AsyncStorage.getItem(OLLAMA_MODEL_KEY),
      ]);
      return new Gemma26BBrain({
        baseUrl: url || '',
        apiKey: key || undefined,
        model: model || 'gemma4:26b',
      });
    }
    case 'gemini': {
      const { GeminiBrain } = require('./gemini');
      const apiKey = await AsyncStorage.getItem(GEMINI_API_KEY);
      return new GeminiBrain(apiKey || '');
    }
    case 'claude-sonnet':
    case 'claude-opus': {
      const { ClaudeBrain } = require('./claude');
      const apiKey = await AsyncStorage.getItem(CLAUDE_API_KEY);
      const variant = id as 'claude-sonnet' | 'claude-opus';
      return new ClaudeBrain(apiKey || '', variant);
    }
    case 'fastvlm': {
      const { FastVLMBrain } = require('./fastvlm');
      return new FastVLMBrain();
    }
    case 'smolvlm2': {
      const { SmolVLM2Brain } = require('./smolvlm2');
      return new SmolVLM2Brain();
    }
    case 'moondream2': {
      const { Moondream2Brain } = require('./moondream2');
      return new Moondream2Brain();
    }
    default: {
      // Fallback to E2B
      const { E2BBrain } = require('./e2b');
      return new E2BBrain();
    }
  }
}
