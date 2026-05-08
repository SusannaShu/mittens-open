/**
 * TypeScript binding for the LiteRT-LM native module.
 *
 * Maps to native Expo Modules on both platforms:
 *   Android: modules/litert-lm/android/src/main/java/expo/modules/litertlm/LiteRTLMModule.kt
 *   iOS:     modules/litert-lm/ios/LiteRTLMModule.swift
 *
 * Uses lazy initialization to avoid crashing when the native module
 * isn't available (e.g. in Expo Go without a custom dev build).
 */

import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

export interface LiteRTLMModuleType {
  loadModel(modelPath: string, backend: string): Promise<void>;
  generateText(prompt: string): Promise<string>;
  generateWithImage(prompt: string, imagePath: string): Promise<string>;
  generateWithAudio(prompt: string, audioPath: string): Promise<string>;
  isModelLoaded(): boolean;
  unloadModel(): void;
  getLoadTimeMs(): number;
}

let _module: LiteRTLMModuleType | null = null;
let _attempted = false;

export function getLiteRTLMModule(): LiteRTLMModuleType | null {
  if (_attempted) return _module;
  _attempted = true;

  // Only supported on Android and iOS (not web)
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;

  try {
    _module = requireNativeModule<LiteRTLMModuleType>('LiteRTLM');
  } catch (e: any) {
    console.warn('[LiteRTLM] Native module failed to load:', e?.message || e);
    _module = null;
  }
  return _module;
}
