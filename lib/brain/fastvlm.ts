/**
 * FastVLM Brain -- Apple's on-device VLM (CoreML).
 *
 * STUB: Downloads model files and reports readiness, but actual inference
 * requires the native Swift CoreML module (from apple/ml-fastvlm).
 * Once integrated, this brain runs entirely on-device with no network.
 *
 * FastVLM 0.5B: 85x faster TTFT than LLaVA-OneVision-0.5B.
 * Uses FastViTHD encoder (fewer tokens, faster encoding).
 * Official iOS demo app: github.com/apple/ml-fastvlm/tree/main/app
 */

import { Brain, BrainOptions, ReadyProgress } from './types';
import { getModel, getDownloadSize, formatBytes } from '../services/ai/modelRegistry';

const MODEL_ID = 'fastvlm-0.5b';

export class FastVLMBrain implements Brain {
  readonly name = 'FastVLM 0.5B';
  readonly contextWindow = 4096;
  readonly supportsVision = true;
  readonly supportsAudio = false;
  readonly isLocal = true;

  private _ready = false;

  async text(prompt: string, opts?: BrainOptions): Promise<string> {
    if (!this._ready) throw new Error('FastVLM model not loaded. Call ensureReady() first.');
    const { ExpoFastvlm } = require('../../modules/expo-fastvlm/src');
    return await ExpoFastvlm.analyzeImage('', prompt);
  }

  async json<T = any>(prompt: string, schema: Record<string, any>, fallback: T, opts?: BrainOptions): Promise<T> {
    try {
      const raw = await this.text(prompt, opts);
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  async vision(prompt: string, images: string[], opts?: BrainOptions): Promise<string> {
    if (!this._ready) throw new Error('FastVLM model not loaded. Call ensureReady() first.');
    const { ExpoFastvlm } = require('../../modules/expo-fastvlm/src');
    
    // For now, just pass the first image.
    const imagePath = images.length > 0 ? images[0] : '';
    return await ExpoFastvlm.analyzeImage(imagePath, prompt);
  }

  async audio(prompt: string, audioPath: string, opts?: BrainOptions): Promise<string> {
    throw new Error('FastVLM does not support audio input.');
  }

  async ping(): Promise<boolean> {
    return this._ready;
  }

  async ensureReady(onProgress?: (p: ReadyProgress) => void): Promise<void> {
    const model = getModel(MODEL_ID);
    if (!model) throw new Error(`Model ${MODEL_ID} not found in registry`);

    const FileSystem = require('expo-file-system/legacy');
    const MODELS_DIR = FileSystem.documentDirectory + 'models/';

    // Check if all files exist
    let allExist = true;
    for (const file of model.files) {
      const info = await FileSystem.getInfoAsync(MODELS_DIR + file.name);
      if (!info.exists) { allExist = false; break; }
    }

    if (allExist) {
      this._ready = true;
      return;
    }

    // Download missing files
    onProgress?.({ phase: 'download', message: `Downloading ${model.name} (${formatBytes(getDownloadSize(model))})...`, progress: 0 });

    const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
    if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });

    let filesCompleted = 0;
    for (const file of model.files) {
      const filePath = MODELS_DIR + file.name;
      const exists = await FileSystem.getInfoAsync(filePath);
      if (exists.exists) { filesCompleted++; continue; }

      const dl = FileSystem.createDownloadResumable(
        file.url, filePath,
        { headers: { 'User-Agent': 'Mittens/1.0' } },
        (p: any) => {
          const fileProgress = Math.min(1, p.totalBytesWritten / (p.totalBytesExpectedToWrite || file.sizeBytes));
          onProgress?.({
            phase: 'download',
            message: `Downloading ${model.name}...`,
            progress: (filesCompleted + fileProgress) / model.files.length,
          });
        },
      );
      await dl.downloadAsync();
      filesCompleted++;
    }

    onProgress?.({ phase: 'load', message: 'Model files ready' });
    this._ready = true;
  }
}
