/**
 * Moondream 2 Brain -- compact VQA/captioning model (llama.cpp via llama.rn).
 *
 * STUB: Downloads model files and reports readiness, but actual inference
 * requires the llama.rn native module with vision support (mmproj projector).
 * Once integrated, this brain runs entirely on-device with no network.
 *
 * Moondream 2: 1.9B params, strong object recognition and OCR.
 * ~1.5GB download (Q4_K_M + mmproj), ~1.3GB RAM. Needs 4GB+ device.
 * Community iOS builds exist via llama.cpp + Ollama.
 */

import { Brain, BrainOptions, ReadyProgress } from './types';
import { getModel, getDownloadSize, formatBytes } from '../services/ai/modelRegistry';

const MODEL_ID = 'moondream2';

export class Moondream2Brain implements Brain {
  readonly name = 'Moondream 2';
  readonly contextWindow = 8192;
  readonly supportsVision = true;
  readonly supportsAudio = false;
  readonly isLocal = true;

  private _ready = false;

  async text(prompt: string, opts?: BrainOptions): Promise<string> {
    if (!this._ready) throw new Error('Moondream 2 model not loaded. Call ensureReady() first.');
    // TODO: Bridge to llama.rn inference
    throw new Error('Moondream 2 llama.rn vision module not yet integrated. Use a cloud brain for now.');
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
    if (!this._ready) throw new Error('Moondream 2 model not loaded. Call ensureReady() first.');
    // TODO: Bridge to llama.rn vision inference with mmproj projector
    throw new Error('Moondream 2 llama.rn vision module not yet integrated. Use a cloud brain for now.');
  }

  async audio(prompt: string, audioPath: string, opts?: BrainOptions): Promise<string> {
    throw new Error('Moondream 2 does not support audio input.');
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
            message: `Downloading ${file.name.startsWith('mmproj') ? 'Vision projector' : model.name}...`,
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
