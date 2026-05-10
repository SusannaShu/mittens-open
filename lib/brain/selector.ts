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

