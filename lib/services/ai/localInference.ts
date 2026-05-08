import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

const MODELS_DIR = FileSystem.documentDirectory + 'models/';
// Gemma 4 E2B instruction-tuned, LiteRT-LM bundle (2.58 GB, multimodal: text+vision+audio).
// Public + ungated on HF; CloudFront-backed, supports range requests -> createDownloadResumable
// resumes cleanly on flaky mobile networks.
const GEMMA_MODEL_URL = 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm';
const GEMMA_MODEL_BYTES = 2_583_085_056;

// Lazy-load the native LiteRT-LM module -- available on Android and iOS after prebuild
let _nativeModule: any = null;
let _nativeAttempted = false;

function getNativeModule() {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
  if (_nativeAttempted) return _nativeModule;
  _nativeAttempted = true;

  try {
    const { requireNativeModule } = require('expo');
    _nativeModule = requireNativeModule('LiteRTLM');
  } catch (e: any) {
    console.warn('[LiteRTLM] Native module not available:', e?.message || e);
    _nativeModule = null;
  }
  return _nativeModule;
}

export class LocalInferenceService {
  /** Check if the LiteRT-LM native module is linked (requires custom dev build, not Expo Go). */
  static isNativeAvailable(): boolean {
    return (Platform.OS === 'android' || Platform.OS === 'ios') && getNativeModule() !== null;
  }

  static async isModelDownloaded(modelName: string = 'gemma-local'): Promise<boolean> {
    const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
      return false;
    }
    const fileInfo = await FileSystem.getInfoAsync(MODELS_DIR + modelName + '.litertlm');
    if (!fileInfo.exists) return false;
    // Validate file is at least 95% of expected size (guard against partial downloads)
    const minSize = GEMMA_MODEL_BYTES * 0.95;
    if ((fileInfo as any).size && (fileInfo as any).size < minSize) {
      console.warn(`[Gemma] Model file too small (${(fileInfo as any).size} < ${minSize}), deleting partial download`);
      await FileSystem.deleteAsync(MODELS_DIR + modelName + '.litertlm', { idempotent: true });
      return false;
    }
    return true;
  }

  static getModelPath(modelName: string = 'gemma-local'): string {
    return MODELS_DIR + modelName + '.litertlm';
  }

  /** Validate model file integrity. Deletes corrupt/partial files. Returns true if valid. */
  static async validateAndCleanModel(modelName: string = 'gemma-local'): Promise<boolean> {
    const path = MODELS_DIR + modelName + '.litertlm';
    const fileInfo = await FileSystem.getInfoAsync(path);
    if (!fileInfo.exists) return false;

    const fileSize = (fileInfo as any).size || 0;
    const minSize = GEMMA_MODEL_BYTES * 0.95;

    // Check 1: File size
    if (fileSize > 0 && fileSize < minSize) {
      console.warn(`[Gemma] Corrupt model: ${(fileSize / 1e6).toFixed(1)}MB (expected ~${(GEMMA_MODEL_BYTES / 1e9).toFixed(2)}GB). Deleting.`);
      await FileSystem.deleteAsync(path, { idempotent: true });
      return false;
    }

    return true;
  }

  static async downloadModel(modelName: string = 'gemma-local', onProgress?: (progress: number) => void): Promise<string> {
    const path = MODELS_DIR + modelName + '.litertlm';
    const exists = await this.isModelDownloaded(modelName);
    if (exists) return path;

    // HuggingFace returns a 302 redirect to a signed S3/CloudFront URL.
    // expo-file-system may not follow redirects reliably, so resolve it first.
    let directUrl = GEMMA_MODEL_URL;
    try {
      const headRes = await fetch(GEMMA_MODEL_URL, { method: 'HEAD', redirect: 'follow' });
      if (headRes.url && headRes.url !== GEMMA_MODEL_URL) {
        directUrl = headRes.url;
      }
    } catch {
      // Use original URL if redirect resolution fails
    }

    const downloadResumable = FileSystem.createDownloadResumable(
      directUrl,
      path,
      { headers: { 'User-Agent': 'Mittens/1.0' } },
      (downloadProgress) => {
        const expected = downloadProgress.totalBytesExpectedToWrite || GEMMA_MODEL_BYTES;
        const progress = downloadProgress.totalBytesWritten / expected;
        if (onProgress) onProgress(progress);
      }
    );

    try {
      const result = await downloadResumable.downloadAsync();
      return result?.uri || path;
    } catch (e: any) {
      // Clean up partial file
      try { await FileSystem.deleteAsync(path, { idempotent: true }); } catch {}
      throw e;
    }
  }

  /** Load the model into the native LiteRT-LM engine. Must be called before generateLocalResponse. */
  static async loadModel(modelName: string = 'gemma-local', backend: 'cpu' | 'gpu' | 'mixed' = 'cpu'): Promise<void> {
    // Validate model file before loading
    const isValid = await this.validateAndCleanModel(modelName);
    if (!isValid) {
      throw new Error('Model file missing or corrupt. Please re-download.');
    }

    const native = getNativeModule();
    if (!native) {
      throw new Error('LiteRT-LM native module not available (requires custom dev build)');
    }
    const path = this.getModelPath(modelName);
    try {
      await native.loadModel(path, backend);
    } catch (e: any) {
      const msg = e?.message || String(e);
      // Don't delete the model file -- engine creation failures are usually
      // backend config or memory issues, not file corruption.
      console.error(`[Gemma] Native loadModel failed: ${msg}`);
      throw new Error(msg);
    }
  }

  /** Check if the native engine has a model loaded and ready. */
  static isModelLoaded(): boolean {
    const native = getNativeModule();
    if (!native) return false;
    return native.isModelLoaded();
  }

  /** Get the time it took to load the model (ms), for benchmarking. */
  static getLoadTimeMs(): number {
    const native = getNativeModule();
    if (!native) return 0;
    return native.getLoadTimeMs();
  }

  /** Release the model from memory. */
  static unloadModel(): void {
    const native = getNativeModule();
    if (!native) return;
    native.unloadModel();
  }

  /** Helper to unwrap JSON-encoded responses from the native C-API on iOS */
  private static unwrapNativeResponse(raw: string): string {
    if (!raw.trim().startsWith('{')) return raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.content && Array.isArray(parsed.content)) {
        return parsed.content.map((c: any) => c.text || '').join('');
      } else if (parsed.parts && Array.isArray(parsed.parts)) {
        return parsed.parts.map((p: any) => p.text || '').join('');
      } else if (typeof parsed.text === 'string') {
        return parsed.text;
      }
    } catch { /* not valid JSON, return raw */ }
    return raw;
  }

  /** Generate a response from a text-only prompt using on-device Gemma. */
  static async generateLocalResponse(prompt: string, _modelName: string = 'gemma-local'): Promise<string> {
    const native = getNativeModule();
    if (!native) {
      throw new Error('LiteRT-LM native module not available (requires custom dev build)');
    }

    if (!native.isModelLoaded()) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    const raw = await native.generateText(prompt);
    return this.unwrapNativeResponse(raw);
  }

  /** Generate a response from a text prompt + image using on-device Gemma vision. */
  static async generateWithImage(prompt: string, imagePath: string, _modelName: string = 'gemma-local'): Promise<string> {
    const native = getNativeModule();
    if (!native) {
      throw new Error('LiteRT-LM native module not available (requires custom dev build)');
    }

    if (!native.isModelLoaded()) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    const raw = await native.generateWithImage(prompt, imagePath);
    return this.unwrapNativeResponse(raw);
  }

  /** Generate a response from a text prompt + multiple images using Gemma vision. */
  static async generateWithImages(prompt: string, imagePaths: string[]): Promise<string> {
    const native = getNativeModule();
    if (!native) {
      throw new Error('LiteRT-LM native module not available (requires custom dev build)');
    }

    if (!native.isModelLoaded()) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    // Use multi-image native function if available, otherwise fall back
    if (native.generateWithImages) {
      const raw = await native.generateWithImages(prompt, imagePaths);
      return this.unwrapNativeResponse(raw);
    }
    // Fallback: use single image (first photo only)
    const raw = await native.generateWithImage(prompt, imagePaths[0]);
    return this.unwrapNativeResponse(raw);
  }

  /** Generate a response from a text prompt + audio file using on-device Gemma E2B/E4B native audio. */
  static async generateWithAudio(prompt: string, audioPath: string): Promise<string> {
    const native = getNativeModule();
    if (!native) {
      throw new Error('LiteRT-LM native module not available (requires custom dev build)');
    }

    if (!native.isModelLoaded()) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    if (!native.generateWithAudio) {
      throw new Error('Audio input not supported in this build. Rebuild with audio-enabled LiteRT-LM.');
    }

    const raw = await native.generateWithAudio(prompt, audioPath);
    return this.unwrapNativeResponse(raw);
  }
}
