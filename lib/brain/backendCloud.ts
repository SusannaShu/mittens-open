/**
 * BackendCloudBrain -- cloud brain through Strapi-managed provider keys.
 *
 * Used for Gemini, Claude, Groq, and OpenRouter selections so the app's
 * pipeline phases all honor the profile brain choice coherently.
 */

import { brainText, brainVision } from '../api';
import { Brain, BrainOptions } from './types';
import { withRetry } from './rateLimiter';

const MODEL_INFO: Record<string, { name: string; contextWindow: number; supportsVision: boolean }> = {
  'gemini-flash': { name: 'Gemini Flash (backend)', contextWindow: 1_000_000, supportsVision: true },
  'claude-sonnet': { name: 'Claude Sonnet (backend)', contextWindow: 200_000, supportsVision: true },
  'claude-opus': { name: 'Claude Opus (backend)', contextWindow: 200_000, supportsVision: true },
  'groq-free': { name: 'Groq Llama 4 Scout (backend)', contextWindow: 131_072, supportsVision: true },
  'openrouter-free': { name: 'OpenRouter Gemma 4 (backend)', contextWindow: 262_144, supportsVision: true },
};

export class BackendCloudBrain implements Brain {
  readonly name: string;
  readonly contextWindow: number;
  readonly supportsVision: boolean;
  readonly supportsAudio = false;
  readonly isLocal = false;

  constructor(private aiModel: string) {
    const info = MODEL_INFO[aiModel] || MODEL_INFO['gemini-flash'];
    this.name = info.name;
    this.contextWindow = info.contextWindow;
    this.supportsVision = info.supportsVision;
  }

  async text(prompt: string, opts?: BrainOptions): Promise<string> {
    return withRetry(this.aiModel, async () => {
      const res = await brainText(prompt, this.aiModel, opts);
      return res.text || '';
    });
  }

  async json<T = any>(prompt: string, _schema: Record<string, any>, fallback: T, opts?: BrainOptions): Promise<T> {
    const raw = await this.text(prompt, opts);
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) return { ...fallback, ...JSON.parse(match[0]) };
      return { ...fallback, ...JSON.parse(raw) };
    } catch {
      return fallback;
    }
  }

  async vision(prompt: string, images: string[], opts?: BrainOptions): Promise<string> {
    const encoded = await Promise.all(images.map(img => this.toBase64(img)));
    return withRetry(this.aiModel, async () => {
      const res = await brainVision(prompt, encoded.filter(Boolean), this.aiModel, opts);
      return res.text || '';
    });
  }

  async audio(_prompt: string, _audioPath: string, _opts?: BrainOptions): Promise<string> {
    throw new Error('Audio input requires an on-device brain.');
  }

  async ping(): Promise<boolean> {
    try {
      const res = await brainText('Say "ok"', this.aiModel, { maxTokens: 5, timeout: 10000 });
      return !!res.text;
    } catch {
      return false;
    }
  }

  private async toBase64(imagePath: string): Promise<string> {
    if (imagePath.startsWith('data:')) {
      return imagePath.replace(/^data:image\/\w+;base64,/, '');
    }
    if (!imagePath.startsWith('file://') && !imagePath.startsWith('/')) {
      return imagePath;
    }

    try {
      const { resizeForUpload } = require('../imageUtils');
      const FileSystem = require('expo-file-system/legacy');
      const resizedUri = await resizeForUpload(imagePath);
      return await FileSystem.readAsStringAsync(resizedUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch {
      try {
        const FileSystem = require('expo-file-system/legacy');
        return await FileSystem.readAsStringAsync(imagePath, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } catch {
        return '';
      }
    }
  }
}
