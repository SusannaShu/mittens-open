/**
 * E2B Brain -- on-device inference via LiteRT-LM native module.
 *
 * CHARACTERISTICS:
 *   - Cost: $0 (runs on device)
 *   - Latency: text ~2.1s, vision ~23.8s (Pixel 7a benchmarks)
 *   - Context: ~150 tokens effective (model is tiny, prompts must be minimal)
 *   - Vision: Yes (via LiteRT multimodal)
 *   - Network: Not required
 *
 * MIGRATED FROM:
 *   lib/services/ai/localInference.ts (LocalInferenceService)
 *   The actual native module call stays in localInference.ts;
 *   this file is the Brain-interface wrapper.
 *
 * NOTES:
 *   - Prompts MUST use compact format (short keys: n, g, c, hp, k)
 *   - Pipeline phases check brain.contextWindow and adapt accordingly
 *   - Image must be resized via resizeForVision() before passing to vision()
 */

import { Brain, BrainOptions } from './types';

export class E2BBrain implements Brain {
  readonly name = 'E2B (on-device)';
  readonly contextWindow = 8192;
  readonly supportsVision = true;
  readonly supportsAudio = true;
  readonly isLocal = true;

  async text(prompt: string, _opts?: BrainOptions): Promise<string> {
    console.log('[E2B] text() prompt:', prompt.slice(0, 80) + '...');
    const { LocalInferenceService } = require('../services/ai/localInference');
    const result = await LocalInferenceService.generateLocalResponse(prompt);
    console.log('[E2B] text() result:', result?.slice(0, 100));
    return result;
  }

  async json<T = any>(prompt: string, _schema: Record<string, any>, fallback: T, opts?: BrainOptions): Promise<T> {
    const raw = await this.text(prompt + '\n\nRespond with JSON only, no explanation.', opts);
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) return { ...fallback, ...JSON.parse(match[0]) };
      return { ...fallback, ...JSON.parse(raw) };
    } catch {
      return fallback;
    }
  }

  async vision(prompt: string, images: string[], _opts?: BrainOptions): Promise<string> {
    console.log('[E2B] vision() images:', images.length, 'prompt:', prompt.slice(0, 80) + '...');

    const imagePath = images[0];
    if (!imagePath) {
      console.log('[E2B] No image provided, falling back to text()');
      return this.text(prompt);
    }

    // E2B is only used on Full tier (8GB+) -- use direct native vision
    // Low-RAM devices use LlamaRNBrain (Gemma 3 1B) instead
    const { LocalInferenceService } = require('../services/ai/localInference');
    const { resizeForVision } = require('../imageUtils');
    const FileSystem = require('expo-file-system/legacy');

    console.log('[E2B] Resizing image:', imagePath.slice(-40));
    const resized = await resizeForVision(imagePath);

    let fileSizeBytes = 0;
    try {
      const info = await FileSystem.getInfoAsync(resized);
      fileSizeBytes = info?.size || 0;
    } catch { /* non-blocking */ }
    console.log('[E2B] Resized image:', resized.slice(-40), '| size:', fileSizeBytes, 'bytes');

    console.log('[E2B] Calling generateWithImage, prompt:', prompt.length, 'chars');
    const result = await LocalInferenceService.generateWithImage(prompt, resized);
    console.log('[E2B] vision() result:', result?.slice(0, 100));
    return result;
  }

  async audio(prompt: string, audioPath: string, _opts?: BrainOptions): Promise<string> {
    console.log('[E2B] audio() path:', audioPath.slice(-40), 'prompt:', prompt.slice(0, 80) + '...');
    const { LocalInferenceService } = require('../services/ai/localInference');
    const result = await LocalInferenceService.generateWithAudio(prompt, audioPath);
    console.log('[E2B] audio() result:', result?.slice(0, 100));
    return result;
  }

  async ping(): Promise<boolean> {
    try {
      const { LocalInferenceService } = require('../services/ai/localInference');
      return LocalInferenceService.isNativeAvailable() && LocalInferenceService.isModelLoaded();
    } catch {
      return false;
    }
  }
}
