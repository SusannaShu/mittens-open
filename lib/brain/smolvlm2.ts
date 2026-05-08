/**
 * SmolVLM2 Brain -- HuggingFace's ultra-compact VLM via llama.rn
 *
 * Runs entirely on-device with no network.
 * SmolVLM2 256M: The smallest multimodal VLM available.
 * Vision + text in ~400MB total download. Runs on iPhone SE 3.
 */

import { Brain, BrainOptions, ReadyProgress } from './types';
import * as FileSystem from 'expo-file-system/legacy';

const MODEL_ID = 'smolvlm2-256m';
const MODELS_DIR = FileSystem.documentDirectory + 'models/';
const STOP_TOKENS = ['<|im_end|>', '<|endoftext|>'];

// Lazy-loaded llama.rn context
let _context: any = null;
let _loadedModelFile: string | null = null;
let _readyPromise: Promise<void> | null = null;

async function resolveRedirect(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (res.url && res.url !== url) return res.url;
  } catch {}
  return url;
}

export class SmolVLM2Brain implements Brain {
  readonly name = 'SmolVLM2 256M';
  readonly contextWindow = 4096;
  readonly supportsVision = true;
  readonly supportsAudio = false;
  readonly isLocal = true;

  async ensureReady(onProgress?: (p: ReadyProgress) => void): Promise<void> {
    const { getModel } = require('../services/ai/modelRegistry');
    const model = getModel(MODEL_ID);
    if (!model) throw new Error(`Model ${MODEL_ID} not found in registry`);

    if (_context && _loadedModelFile === model.files[0].name) return;

    if (_readyPromise) {
      await _readyPromise;
      return;
    }

    _readyPromise = this._doEnsureReady(model, onProgress);
    try {
      await _readyPromise;
    } finally {
      _readyPromise = null;
    }
  }

  private async _doEnsureReady(model: any, onProgress?: (p: ReadyProgress) => void): Promise<void> {
    const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
    }

    const missingFiles: any[] = [];
    for (const file of model.files) {
      const info = await FileSystem.getInfoAsync(MODELS_DIR + file.name);
      if (!info.exists) missingFiles.push(file);
    }

    if (missingFiles.length > 0) {
      const totalBytes = missingFiles.reduce((sum: number, f: any) => sum + f.sizeBytes, 0);
      let downloadedBytes = 0;

      for (const file of missingFiles) {
        const destPath = MODELS_DIR + file.name;
        onProgress?.({
          phase: 'download',
          message: `Downloading ${model.name}...`,
          progress: totalBytes > 0 ? downloadedBytes / totalBytes : 0,
        });

        const directUrl = await resolveRedirect(file.url);
        const dl = FileSystem.createDownloadResumable(
          directUrl,
          destPath,
          { headers: { 'User-Agent': 'Mittens/1.0' } },
          (p: any) => {
            const current = downloadedBytes + p.totalBytesWritten;
            onProgress?.({
              phase: 'download',
              message: `Downloading ${model.name}...`,
              progress: Math.min(1, totalBytes > 0 ? current / totalBytes : 0),
            });
          },
        );

        try {
          await dl.downloadAsync();
          downloadedBytes += file.sizeBytes;
        } catch (e: any) {
          try { await FileSystem.deleteAsync(destPath, { idempotent: true }); } catch {}
          throw new Error(`Download failed: ${e?.message || 'Check internet connection'}`);
        }
      }
    }

    onProgress?.({ phase: 'load', message: 'Loading model...' });
    await this.ensureLoaded();
  }

  private async ensureLoaded(): Promise<any> {
    const { getModel } = require('../services/ai/modelRegistry');
    const model = getModel(MODEL_ID);
    if (!model) throw new Error('Model not found: ' + MODEL_ID);

    const mainFile = model.files.find((f: any) => !f.name.includes('mmproj'));
    const mmprojFile = model.files.find((f: any) => f.name.includes('mmproj'));
    if (!mainFile) throw new Error('No main model file for ' + MODEL_ID);

    if (_context && _loadedModelFile === mainFile.name) {
      return _context;
    }

    if (_context) {
      try { await _context.release(); } catch {}
      _context = null;
      _loadedModelFile = null;
    }

    const filePath = MODELS_DIR + mainFile.name;
    const mmprojPath = mmprojFile ? MODELS_DIR + mmprojFile.name : null;

    console.log('[SmolVLM2] Loading model:', mainFile.name);
    let initLlama: any;
    try {
      const llamaModule = require('llama.rn');
      initLlama = llamaModule?.initLlama;
    } catch {}

    if (!initLlama) {
      throw new Error('llama.rn native module not available.');
    }

    _context = await initLlama({
      model: filePath,
      n_ctx: 4096,
      n_gpu_layers: 99,
      ctx_shift: false,
    });

    if (mmprojPath) {
      console.log('[SmolVLM2] Initializing multimodal support with:', mmprojFile!.name);
      const ok = await _context.initMultimodal({
        path: mmprojPath,
        use_gpu: true,
      });
      if (!ok) {
        console.warn('[SmolVLM2] initMultimodal returned false (but may still work)');
      }
    }

    _loadedModelFile = mainFile.name;
    return _context;
  }

  async text(prompt: string, opts?: BrainOptions): Promise<string> {
    return this.vision(prompt, [], opts);
  }

  async json<T = any>(prompt: string, schema: Record<string, any>, fallback: T, opts?: BrainOptions): Promise<T> {
    const ctx = await this.ensureLoaded();
    const result = await ctx.completion({
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Respond with JSON only.' },
        { role: 'user', content: prompt },
      ],
      n_predict: opts?.maxTokens ?? 512,
      temperature: opts?.temperature ?? 0.1,
      stop: STOP_TOKENS,
      json_schema: JSON.stringify(schema),
    });

    const raw = (result?.text || result?.content || '').trim();
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) return { ...fallback, ...JSON.parse(match[0]) };
      return { ...fallback, ...JSON.parse(raw) };
    } catch {
      return fallback;
    }
  }

  async vision(prompt: string, images: string[], opts?: BrainOptions): Promise<string> {
    const ctx = await this.ensureLoaded();
    
    // Convert image URLs/paths to absolute file paths if necessary
    const media_paths = images.map(img => {
      if (img.startsWith('file://')) return img.replace('file://', '');
      return img;
    });

    const result = await ctx.completion({
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt },
      ],
      n_predict: opts?.maxTokens ?? 512,
      temperature: opts?.temperature ?? 0.1,
      stop: STOP_TOKENS,
      media_paths: media_paths.length > 0 ? media_paths : undefined,
    });

    return (result?.text || result?.content || '').trim();
  }

  async audio(prompt: string, audioPath: string, opts?: BrainOptions): Promise<string> {
    throw new Error('SmolVLM2 does not support audio input.');
  }

  async ping(): Promise<boolean> {
    try {
      const { getModel } = require('../services/ai/modelRegistry');
      const model = getModel(MODEL_ID);
      if (!model) return false;
      const mainFile = MODELS_DIR + model.files[0].name;
      const info = await FileSystem.getInfoAsync(mainFile);
      return info.exists;
    } catch {
      return false;
    }
  }
}
