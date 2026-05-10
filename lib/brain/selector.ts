/**
 * brain/selector.ts -- AI model selection logic.
 * Stub for open-source version (always selects local model).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

let _currentBrainId: string = 'gemma-local';

export async function setBrainId(id: string): Promise<void> {
  _currentBrainId = id;
  await AsyncStorage.setItem('mittens_brain_id', id);
}

export function getBrainId(): string {
  return _currentBrainId;
}

export function selectModel(_task: string): string {
  return _currentBrainId;
}

export function getAvailableModels(): string[] {
  return ['gemma-local', 'gemma26b', 'e2b', 'groq-free'];
}

export async function getBrain(): Promise<any> {
  const id = getBrainId();
  if (id === 'e2b') {
    const { E2BBrain } = require('./e2b');
    return new E2BBrain();
  }
  if (id === 'gemma26b') {
    const { Gemma26BBrain } = require('./gemma26b');
    return new Gemma26BBrain();
  }
  // Default to Llama local
  const { LlamaRNBrain } = require('./llamaRN');
  return new LlamaRNBrain();
}

