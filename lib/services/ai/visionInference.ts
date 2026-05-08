/**
 * VisionInferenceService -- on-device image captioning via llama.rn + SmolVLM.
 *
 * Supports two SmolVLM variants (selected by device tier):
 *   Standard tier (4-6GB): SmolVLM 500M Q8 (~560MB download, ~800MB RAM)
 *   Lite tier (3GB):       SmolVLM 256M Q8 (~240MB download, ~400MB RAM)
 *
 * LIFECYCLE:
 *   loadModel() -> describeImage() [x N] -> unloadModel()
 *   On Standard tier, must unload before loading reasoning model.
 *   On Lite tier, can coexist with Gemma 3 1B reasoning model.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { getModel, type LocalModel, type ModelFile } from './modelRegistry';
import { getActiveTier } from './tierSelector';

const MODELS_DIR = FileSystem.documentDirectory + 'models/';

export interface VisionResult {
  caption: string;
  latencyMs: number;
}

// Lazy-loaded llama.rn context
let _llamaContext: any = null;
let _multimodalReady = false;
let _loadedVisionModelId: string | null = null;

/** Get the vision model for the current tier */
async function getVisionModel(): Promise<LocalModel> {
  const tier = await getActiveTier();
  const modelId = tier === 'lite' ? 'smolvlm-256m' : 'smolvlm-500m';
  const model = getModel(modelId);
  if (!model) throw new Error(`Vision model not found: ${modelId}`);
  return model;
}

/** Get file paths for a model */
function getModelFilePaths(model: LocalModel): { model: string; mmproj: string } {
  const mainFile = model.files.find(f => !f.name.startsWith('mmproj'));
  const mmproj = model.files.find(f => f.name.startsWith('mmproj'));
  return {
    model: MODELS_DIR + (mainFile?.name || ''),
    mmproj: MODELS_DIR + (mmproj?.name || ''),
  };
}

export class VisionInferenceService {
  /** Check if llama.rn is available as a module */
  static isAvailable(): boolean {
    try {
      require('llama.rn');
      return true;
    } catch {
      return false;
    }
  }

  /** Check if model files are downloaded (for the current tier's vision model) */
  static async isModelDownloaded(): Promise<boolean> {
    try {
      const model = await getVisionModel();
      for (const file of model.files) {
        const info = await FileSystem.getInfoAsync(MODELS_DIR + file.name);
        if (!info.exists) return false;
        // Validate size (at least 50% of expected)
        const size = (info as any).size || 0;
        if (size > 0 && size < file.sizeBytes * 0.5) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Get paths to model files for the current tier */
  static async getModelPaths(): Promise<{ model: string; mmproj: string }> {
    const model = await getVisionModel();
    return getModelFilePaths(model);
  }

  /** Download vision model files from HuggingFace */
  static async downloadModel(
    onProgress?: (progress: number, phase: 'model' | 'mmproj') => void,
  ): Promise<void> {
    const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
    }

    const model = await getVisionModel();
    const totalFiles = model.files.length;
    let filesCompleted = 0;

    for (const file of model.files) {
      const filePath = MODELS_DIR + file.name;
      const exists = await FileSystem.getInfoAsync(filePath);
      if (exists.exists) {
        filesCompleted++;
        continue;
      }

      const phase = file.name.startsWith('mmproj') ? 'mmproj' as const : 'model' as const;
      const directUrl = await this.resolveRedirect(file.url);
      const dl = FileSystem.createDownloadResumable(
        directUrl,
        filePath,
        { headers: { 'User-Agent': 'Mittens/1.0' } },
        (p) => {
          const fileProgress = p.totalBytesWritten / (p.totalBytesExpectedToWrite || file.sizeBytes);
          const overall = (filesCompleted + fileProgress) / totalFiles;
          onProgress?.(overall, phase);
        },
      );
      try {
        await dl.downloadAsync();
        filesCompleted++;
      } catch (e: any) {
        try { await FileSystem.deleteAsync(filePath, { idempotent: true }); } catch {}
        throw e;
      }
    }
  }

  /** Load SmolVLM via llama.rn + initialize multimodal */
  static async loadModel(): Promise<void> {
    if (_llamaContext && _multimodalReady) return;

    const { initLlama } = require('llama.rn');
    const model = await getVisionModel();
    const paths = getModelFilePaths(model);

    console.log(`[VisionInference] Loading ${model.name}...`);
    const start = Date.now();

    _llamaContext = await initLlama({
      model: paths.model,
      n_ctx: 2048,
      n_gpu_layers: 99,
      ctx_shift: false,
    });

    const mmSuccess = await _llamaContext.initMultimodal({
      path: paths.mmproj,
      use_gpu: true,
    });

    if (!mmSuccess) {
      await this.unloadModel();
      throw new Error(`Failed to initialize ${model.name} multimodal support`);
    }

    _multimodalReady = true;
    _loadedVisionModelId = model.id;
    console.log(`[VisionInference] ${model.name} loaded in ${Date.now() - start}ms`);
  }

  /** Unload SmolVLM and free memory */
  static async unloadModel(): Promise<void> {
    if (_llamaContext) {
      try {
        if (_multimodalReady) {
          await _llamaContext.releaseMultimodal();
        }
        await _llamaContext.release();
      } catch (e: any) {
        console.warn('[VisionInference] Error during unload:', e?.message);
      }
      _llamaContext = null;
      _multimodalReady = false;
      _loadedVisionModelId = null;
      console.log('[VisionInference] Vision model unloaded');
    }
  }

  /** Check if model is currently loaded */
  static isModelLoaded(): boolean {
    return _llamaContext !== null && _multimodalReady;
  }

  /** Core: describe an image and return a text caption */
  static async describeImage(imagePath: string): Promise<VisionResult> {
    if (!_llamaContext || !_multimodalReady) {
      throw new Error('Vision model not loaded. Call loadModel() first.');
    }

    const start = Date.now();

    // Normalize path -- llama.rn expects file:// prefix
    let normalizedPath = imagePath;
    if (normalizedPath.startsWith('/') && !normalizedPath.startsWith('file://')) {
      normalizedPath = 'file://' + normalizedPath;
    }

    const result = await _llamaContext.completion({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Describe this image in detail. Focus on: what food items are visible (if any), their preparation method, approximate portions, the setting, and any other relevant details. Be specific and concise.',
            },
            {
              type: 'image_url',
              image_url: { url: normalizedPath },
            },
          ],
        },
      ],
      n_predict: 200,
      temperature: 0.1,
      stop: ['<end_of_utterance>', '<|im_end|>'],
    });

    const latencyMs = Date.now() - start;
    const caption = (result?.text || '').trim();

    console.log(`[VisionInference] Caption (${latencyMs}ms): "${caption.slice(0, 100)}..."`);

    return { caption, latencyMs };
  }

  /** Batch: describe multiple images */
  static async describeImages(paths: string[]): Promise<VisionResult[]> {
    const results: VisionResult[] = [];
    for (const path of paths) {
      results.push(await this.describeImage(path));
    }
    return results;
  }

  /** Delete downloaded model files for the current tier */
  static async deleteModel(): Promise<void> {
    try {
      const model = await getVisionModel();
      for (const file of model.files) {
        await FileSystem.deleteAsync(MODELS_DIR + file.name, { idempotent: true });
      }
    } catch {}
    await this.unloadModel();
  }

  /** Resolve HuggingFace 302 redirect to direct download URL */
  private static async resolveRedirect(url: string): Promise<string> {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (res.url && res.url !== url) return res.url;
    } catch { /* use original */ }
    return url;
  }
}

