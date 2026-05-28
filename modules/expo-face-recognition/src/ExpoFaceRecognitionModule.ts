/**
 * TypeScript binding for the ExpoFaceRecognition native module.
 *
 * Provides face detection and embedding extraction on iOS via
 * Apple Vision + CoreML. Uses lazy initialization to avoid
 * crashing if the native module is unavailable.
 */

import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

/** A single detected face with its embedding vector */
export interface DetectedFace {
  /** 128-dim (MobileFaceNet) or 128-dim (perceptual hash) float vector */
  embedding: number[];
  /** Normalized bounding box (0..1) in Vision coordinates */
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Detection confidence 0..1 */
  confidence: number;
}

export interface ExpoFaceRecognitionModuleType {
  isAvailable(): boolean;
  loadModel(modelPath: string): Promise<void>;
  isModelLoaded(): boolean;
  detectFaces(imagePath: string): Promise<DetectedFace[]>;
  countFaces(imagePath: string): Promise<number>;
  generateSceneEmbedding(imagePath: string): Promise<number[]>;
  unloadModel(): void;
}

let _module: ExpoFaceRecognitionModuleType | null = null;
let _attempted = false;

export function getFaceRecognitionModule(): ExpoFaceRecognitionModuleType | null {
  if (_attempted) return _module;
  _attempted = true;

  // Only supported on iOS
  if (Platform.OS !== 'ios') return null;

  try {
    _module = requireNativeModule<ExpoFaceRecognitionModuleType>('ExpoFaceRecognition');
  } catch (e: any) {
    console.warn('[FaceRecognition] Native module failed to load:', e?.message || e);
    _module = null;
  }
  return _module;
}
