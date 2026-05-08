/**
 * Provider Factory -- returns the correct InferenceProvider and DataProvider
 * based on the user's settings.
 *
 * THREE independent settings:
 *   agentEnabled:  boolean                                    -- E2B on-device agent (triage, voice, quick chat)
 *   inferenceMode: 'gemini' | 'claude' | 'ollama'             -- which Brain (reasoning engine) to use
 *   dataMode:      'cloud' | 'local'                          -- where to store data
 *
 * The agent and brain are DECOUPLED. When the agent is ON, E2B handles
 * triage + voice locally and forwards heavy tasks to the selected brain.
 * When OFF, everything goes straight to the brain.
 *
 * Legacy 'gemma' inference mode is mapped to agent ON + gemini brain.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { InferenceProvider } from './inferenceProvider';
import { DataProvider } from './dataProvider';
import type { OllamaConfig } from './ollamaProvider';

const MODE_KEY = 'mittens_mode';        // legacy, maps to dataMode
const DATA_MODE_KEY = 'mittens_data_mode';
const INFERENCE_KEY = 'mittens_inference_mode';
const AGENT_KEY = 'mittens_agent_enabled';
const OLLAMA_URL_KEY = 'mittens_ollama_url';
const OLLAMA_KEY_KEY = 'mittens_ollama_key';
const OLLAMA_MODEL_KEY = 'mittens_ollama_model';

export type MittensMode = 'cloud' | 'local';         // legacy alias for dataMode
export type DataMode = 'cloud' | 'local';
export type InferenceMode = 'gemini' | 'gemma' | 'claude' | 'ollama'; // 'gemma' kept for migration

let cachedDataMode: DataMode | null = null;
let cachedInferenceMode: InferenceMode | null = null;
let cachedAgentEnabled: boolean | null = null;
let cachedInferenceProvider: InferenceProvider | null = null;
let cachedDataProvider: DataProvider | null = null;
let dbInitialized = false;

// ─── Data Mode (where data is stored) ───

export async function getDataMode(): Promise<DataMode> {
  if (cachedDataMode) return cachedDataMode;
  const stored = await AsyncStorage.getItem(DATA_MODE_KEY);
  if (stored === 'local') {
    cachedDataMode = 'local';
  } else {
    // Default to cloud
    cachedDataMode = 'cloud';
  }
  return cachedDataMode;
}

export async function setDataMode(mode: DataMode): Promise<void> {
  await AsyncStorage.setItem(DATA_MODE_KEY, mode);
  cachedDataMode = mode;
  // Also update legacy key for backward compat
  await AsyncStorage.setItem(MODE_KEY, mode);
  cachedDataProvider = null;
}

// ─── Inference Mode (which AI engine) ───

export async function getInferenceMode(): Promise<InferenceMode> {
  if (cachedInferenceMode) return cachedInferenceMode;
  const stored = await AsyncStorage.getItem(INFERENCE_KEY);
  // Legacy migration: 'gemma' → agent ON + gemini brain
  if (stored === 'gemma') {
    cachedInferenceMode = 'gemini';
    await setAgentEnabled(true);
  } else if (stored === 'claude') cachedInferenceMode = 'claude';
  else if (stored === 'ollama') cachedInferenceMode = 'ollama';
  else cachedInferenceMode = 'gemini';
  return cachedInferenceMode;
}

export async function setInferenceMode(mode: InferenceMode): Promise<void> {
  // Intercept legacy 'gemma' -- turn on agent instead and default to gemini
  if (mode === 'gemma') {
    await setAgentEnabled(true);
    mode = 'gemini';
  }
  await AsyncStorage.setItem(INFERENCE_KEY, mode);
  cachedInferenceMode = mode;
  cachedInferenceProvider = null;
}

// ─── On-Device Agent (E2B triage + voice) ───

export async function getAgentEnabled(): Promise<boolean> {
  if (cachedAgentEnabled !== null) return cachedAgentEnabled;
  const stored = await AsyncStorage.getItem(AGENT_KEY);
  // Default to ON for new users (null = never set)
  cachedAgentEnabled = stored === null ? true : stored === 'true';
  return cachedAgentEnabled;
}

export async function setAgentEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(AGENT_KEY, enabled ? 'true' : 'false');
  cachedAgentEnabled = enabled;
}

// ─── Ollama / BYOK config ───

export async function getOllamaConfig(): Promise<OllamaConfig> {
  const [url, key, model] = await Promise.all([
    AsyncStorage.getItem(OLLAMA_URL_KEY),
    AsyncStorage.getItem(OLLAMA_KEY_KEY),
    AsyncStorage.getItem(OLLAMA_MODEL_KEY),
  ]);
  return {
    baseUrl: url || '',
    apiKey: key || undefined,
    model: model || 'gemma4:26b',
  };
}

export async function setOllamaConfig(
  baseUrl: string,
  apiKey?: string,
  model?: string
): Promise<void> {
  await AsyncStorage.setItem(OLLAMA_URL_KEY, baseUrl);
  if (apiKey) await AsyncStorage.setItem(OLLAMA_KEY_KEY, apiKey);
  else await AsyncStorage.removeItem(OLLAMA_KEY_KEY);
  if (model) await AsyncStorage.setItem(OLLAMA_MODEL_KEY, model);
  else await AsyncStorage.removeItem(OLLAMA_MODEL_KEY);
  // Invalidate cached provider so next call picks up new config
  cachedInferenceProvider = null;
}

// ─── Legacy compat: getMode/setMode map to dataMode ───

export async function getMode(): Promise<MittensMode> {
  return getDataMode();
}

export async function setMode(mode: MittensMode): Promise<void> {
  return setDataMode(mode);
}

// ─── Provider getters ───

export async function getInferenceProvider(): Promise<InferenceProvider> {
  if (cachedInferenceProvider) return cachedInferenceProvider;

  const mode = await getInferenceMode();
  if (mode === 'ollama') {
    const { OllamaProvider } = require('./ollamaProvider');
    const config = await getOllamaConfig();
    cachedInferenceProvider = new OllamaProvider(config);
  } else {
    // gemini, claude, and legacy gemma all use cloud provider
    const { GeminiCloudProvider } = require('./geminiCloudProvider');
    cachedInferenceProvider = new GeminiCloudProvider();
  }
  return cachedInferenceProvider;
}

/** Get the on-device agent provider (E2B). Returns null if agent not available. */
export function getAgentProvider(): InferenceProvider | null {
  const { LocalInferenceService } = require('../services/ai/localInference');
  if (!LocalInferenceService.isNativeAvailable() || !LocalInferenceService.isModelLoaded()) {
    return null;
  }
  const { GemmaLocalProvider } = require('./gemmaLocalProvider');
  return new GemmaLocalProvider();
}

export async function getDataProvider(): Promise<DataProvider> {
  if (cachedDataProvider) return cachedDataProvider;

  const mode = await getDataMode();
  if (mode === 'local') {
    if (!dbInitialized) {
      const { initializeDatabase } = require('../database');
      await initializeDatabase();
      dbInitialized = true;
    }
    const { LocalDataProvider } = require('./localDataProvider');
    cachedDataProvider = new LocalDataProvider();
  } else {
    const { CloudDataProvider } = require('./cloudDataProvider');
    cachedDataProvider = new CloudDataProvider();
  }
  return cachedDataProvider;
}

/** Check if currently in local data mode (sync getter, uses cache). */
export function isLocalMode(): boolean {
  return cachedDataMode === 'local';
}

/** Convenience: force-get the local provider (for test harness) */
export function getLocalProvider(): any {
  const { GemmaLocalProvider } = require('./gemmaLocalProvider');
  return new GemmaLocalProvider();
}

/** Convenience: force-get the cloud provider */
export function getCloudProvider(): any {
  const { GeminiCloudProvider } = require('./geminiCloudProvider');
  return new GeminiCloudProvider();
}

/** Convenience: force-get the local data provider (for sync engine) */
export async function getLocalDataProvider(): Promise<any> {
  if (!dbInitialized) {
    const { initializeDatabase } = require('../database');
    await initializeDatabase();
    dbInitialized = true;
  }
  const { LocalDataProvider } = require('./localDataProvider');
  return new LocalDataProvider();
}
