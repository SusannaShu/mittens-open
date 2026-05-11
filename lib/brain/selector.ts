/**
 * brain/selector.ts -- AI model selection logic.
 * Stub for open-source version (always selects local model).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

let _currentBrainId: string | null = null;

export async function setBrainId(id: string): Promise<void> {
  _currentBrainId = id;
  await AsyncStorage.setItem('mittens_brain_id', id);
}

export async function getBrainId(): Promise<string> {
  if (_currentBrainId === null) {
    const saved = await AsyncStorage.getItem('mittens_brain_id');
    _currentBrainId = saved || 'e2b';
  }
  return _currentBrainId;
}

export function invalidateBrainCache() {
  _currentBrainId = null;
}

export async function selectModel(_task: string): Promise<string> {
  return await getBrainId();
}

export function getAvailableModels(): string[] {
  return ['e2b', 'e4b'];
}

export async function getBrain(): Promise<any> {
  const id = await getBrainId();
  if (id === 'e2b' || id === 'e4b' || id === 'gemma-local') {
    const { E2BBrain } = require('./e2b');
    return new E2BBrain(id === 'e4b' ? 'gemma-e4b' : 'gemma-e2b');
  }
  if (id === 'gemma26b') {
    const { Gemma26BBrain } = require('./gemma26b');
    const { getOllamaConfig } = require('../providers/providerFactory');
    const cfg = await getOllamaConfig();
    return new Gemma26BBrain(cfg);
  }
  // Default to Llama local (passing fallback config to prevent crash)
  const { LlamaRNBrain } = require('./llamaRN');
  return new LlamaRNBrain({ tier: 'standard', modelId: 'gemma3-1b-q4' });
}
