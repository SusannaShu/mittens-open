/**
 * LlamaRN Brain -- on-device inference via llama.rn for Standard/Lite tiers.
 *
 * Uses Gemma 3 1B QAT Q4 -- a text-only model with clean instruction following.
 * No CoT/thinking mode, no special stop tokens needed.
 *
 * CHARACTERISTICS:
 *   - Cost: $0 (runs on device)
 *   - Latency: text ~1-3s
 *   - Context: 32K tokens (model supports 32K, we limit to 4096 for speed)
 *   - Vision: No (Gemma 3 1B is text-only; images fall through to text)
 *   - Audio: No (text transcription must happen first)
 *   - Network: Not required (except initial model download)
 *
 * KEY FEATURES:
 *   - ensureReady(): auto-downloads model if missing, cleans stale files, loads
 *   - json_schema grammar: forces valid JSON output at the token level
 *   - No thinking mode: Gemma 3 doesn't have CoT, so output is always clean
 *   - QAT: Google's Quantization Aware Training preserves quality at Q4
 */

import { Brain, BrainOptions, ReadyProgress } from './types';
import * as FileSystem from 'expo-file-system/legacy';

const MODELS_DIR = FileSystem.documentDirectory + 'models/';

// Gemma 3 uses <end_of_turn> as its native stop token
const STOP_TOKENS = ['<end_of_turn>', '<eos>'];

const SYSTEM_PROMPT = 'You are a helpful assistant.';

// Lazy-loaded llama.rn context
let _context: any = null;
let _loadedModelFile: string | null = null;

// Prevent concurrent ensureReady calls
let _readyPromise: Promise<void> | null = null;

export interface LlamaRNBrainConfig {
  tier: 'standard' | 'lite';
  modelId: string;  // e.g. 'gemma3-1b-q4'
}

/** Resolve HuggingFace CDN redirects to get the direct download URL */
async function resolveRedirect(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (res.url && res.url !== url) return res.url;
  } catch {}
  return url;
}

/**
 * Delete stale model files from previous configurations (Qwen, mmproj, etc).
 * Keeps the current model's files and the E2B LiteRT file (comfort tier).
 */
async function cleanupStaleModels(currentFileNames: string[]): Promise<number> {
  let cleaned = 0;
  try {
    const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
    if (!dirInfo.exists) return 0;

    const files = await FileSystem.readDirectoryAsync(MODELS_DIR);
    const currentSet = new Set(currentFileNames);

    // Stale patterns: old Qwen files, old vision projectors
    const STALE_PATTERNS = ['qwen', 'mmproj'];

    for (const file of files) {
      if (currentSet.has(file)) continue;
      // Keep E2B LiteRT file (other tiers shouldn't delete comfort tier's model)
      if (file.endsWith('.litertlm')) continue;

      const isStale = STALE_PATTERNS.some(p => file.toLowerCase().includes(p));
      if (isStale) {
        console.log('[LlamaRN] Deleting stale model file:', file);
        await FileSystem.deleteAsync(MODELS_DIR + file, { idempotent: true });
        cleaned++;
      }
    }
  } catch (err) {
    console.log('[LlamaRN] Cleanup error (non-blocking):', err);
  }
  return cleaned;
}

export class LlamaRNBrain implements Brain {
  readonly name: string;
  readonly contextWindow = 4096;
  readonly supportsVision = false;  // Gemma 3 1B is text-only
  readonly supportsAudio = false;
  readonly isLocal = true;

  private config: LlamaRNBrainConfig;

  constructor(config: LlamaRNBrainConfig) {
    this.config = config;
    this.name = 'LlamaRN (' + config.tier + ')';
  }

  /**
   * Ensure the model is downloaded and loaded.
   * Call this before first inference to trigger download with progress.
   * Safe to call multiple times -- deduplicates concurrent calls.
   */
  async ensureReady(onProgress?: (p: ReadyProgress) => void): Promise<void> {
    // If already loaded with the right model, nothing to do
    const { getModel } = require('../services/ai/modelRegistry');
    const model = getModel(this.config.modelId);
    if (!model) throw new Error('Model not found: ' + this.config.modelId);

    const mainFile = model.files[0];
    if (_context && _loadedModelFile === mainFile.name) return;

    // Deduplicate concurrent calls
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
    // Ensure models directory exists
    const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
    }

    // Check which files need downloading
    const missingFiles: any[] = [];
    for (const file of model.files) {
      const info = await FileSystem.getInfoAsync(MODELS_DIR + file.name);
      if (!info.exists) missingFiles.push(file);
    }

    if (missingFiles.length > 0) {
      // Clean up stale model files first
      onProgress?.({ phase: 'cleanup', message: 'Cleaning up old models...' });
      const cleaned = await cleanupStaleModels(model.files.map((f: any) => f.name));
      if (cleaned > 0) console.log('[LlamaRN] Cleaned', cleaned, 'stale files');

      // Download missing files
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
          // Clean up partial file
          try { await FileSystem.deleteAsync(destPath, { idempotent: true }); } catch {}
          throw new Error(`Download failed: ${e?.message || 'Check internet connection'}`);
        }
      }
    }

    // Load model into llama.rn
    onProgress?.({ phase: 'load', message: 'Loading model...' });
    await this.ensureLoaded();
  }

  async text(prompt: string, _opts?: BrainOptions): Promise<string> {
    console.log('[LlamaRN] text() prompt:', prompt.slice(0, 80) + '...');
    const ctx = await this.ensureLoaded();

    const result = await ctx.completion({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      n_predict: _opts?.maxTokens ?? 512,
      temperature: _opts?.temperature ?? 0.1,
      stop: STOP_TOKENS,
    });

    const text = (result?.text || result?.content || '').trim();
    console.log('[LlamaRN] text() result:', text.slice(0, 100));
    return text;
  }

  async json<T = any>(prompt: string, schema: Record<string, any>, fallback: T, _opts?: BrainOptions): Promise<T> {
    console.log('[LlamaRN] json() prompt:', prompt.slice(0, 80) + '...');
    const ctx = await this.ensureLoaded();

    const result = await ctx.completion({
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Respond with JSON only.' },
        { role: 'user', content: prompt },
      ],
      n_predict: _opts?.maxTokens ?? 512,
      temperature: _opts?.temperature ?? 0.1,
      stop: STOP_TOKENS,
      json_schema: JSON.stringify(schema),
    });

    const raw = (result?.text || result?.content || '').trim();
    console.log('[LlamaRN] json() raw:', raw.slice(0, 120));

    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        return { ...fallback, ...JSON.parse(match[0]) };
      }
      return { ...fallback, ...JSON.parse(raw) };
    } catch (err) {
      console.error('[LlamaRN] json() parse failed, using fallback:', raw.slice(0, 100));
      return fallback;
    }
  }

  async vision(prompt: string, _images: string[], _opts?: BrainOptions): Promise<string> {
    // Gemma 3 1B is text-only -- fall through to text
    console.log('[LlamaRN] vision() called but model is text-only, falling back to text()');
    return this.text(prompt + '\n\n[Note: image was provided but this model cannot process images]', _opts);
  }

  async audio(_prompt: string, _audioPath: string, _opts?: BrainOptions): Promise<string> {
    throw new Error('Audio not supported on LlamaRN brain. Use speech-to-text first.');
  }

  async ping(): Promise<boolean> {
    try {
      const { getModel } = require('../services/ai/modelRegistry');
      const model = getModel(this.config.modelId);
      if (!model) return false;
      const mainFile = MODELS_DIR + model.files[0].name;
      const info = await FileSystem.getInfoAsync(mainFile);
      return info.exists;
    } catch {
      return false;
    }
  }

  /** Get or create the llama.rn context (assumes files are downloaded) */
  private async ensureLoaded(): Promise<any> {
    const { getModel } = require('../services/ai/modelRegistry');
    const model = getModel(this.config.modelId);
    if (!model) throw new Error('Model not found: ' + this.config.modelId);

    const mainFile = model.files[0];
    if (!mainFile) throw new Error('No main model file for ' + this.config.modelId);

    // Already loaded
    if (_context && _loadedModelFile === mainFile.name) {
      return _context;
    }

    // If a different model is loaded, release it
    if (_context) {
      try {
        await _context.release();
      } catch {}
      _context = null;
      _loadedModelFile = null;
    }

    // Check file exists
    const filePath = MODELS_DIR + mainFile.name;
    const info = await FileSystem.getInfoAsync(filePath);
    if (!info.exists) {
      throw new Error('Model file not downloaded: ' + mainFile.name);
    }

    console.log('[LlamaRN] Loading model:', mainFile.name);
    const start = Date.now();

    let initLlama: any;
    try {
      const llamaModule = require('llama.rn');
      initLlama = llamaModule?.initLlama;
    } catch {}

    if (!initLlama) {
      throw new Error(
        'llama.rn native module not available. ' +
        'Run: npx expo prebuild --clean && npx expo run:ios'
      );
    }

    _context = await initLlama({
      model: filePath,
      n_ctx: 4096,
      n_gpu_layers: 99,
      ctx_shift: false,
    });

    _loadedModelFile = mainFile.name;
    console.log('[LlamaRN] Model loaded in', Date.now() - start, 'ms');
    return _context;
  }

  /** Release the model from memory */
  static async unload(): Promise<void> {
    if (_context) {
      try {
        await _context.release();
      } catch {}
      _context = null;
      _loadedModelFile = null;
      console.log('[LlamaRN] Model unloaded');
    }
  }

  /** Check if model is loaded */
  static isReasoningLoaded(): boolean {
    return _context !== null;
  }
}
