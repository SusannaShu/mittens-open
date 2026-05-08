import { requireNativeModule } from 'expo-modules-core';

export const ExpoFastvlm = requireNativeModule('ExpoFastvlm');

export async function analyzeImage(imagePath: string, prompt: string): Promise<string> {
  return await ExpoFastvlm.analyzeImage(imagePath, prompt);
}
