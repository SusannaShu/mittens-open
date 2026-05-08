/**
 * Claude Brain -- Anthropic Claude API.
 *
 * CHARACTERISTICS:
 *   - Cost: Paid (higher than Gemini Flash, best reasoning)
 *   - Latency: 2-5s per call
 *   - Context: 200K tokens
 *   - Vision: Yes
 *   - Network: Required (cloud API)
 *
 * MIGRATED FROM:
 *   Strapi backend: gemini-vision.js (_callClaudeJSON)
 *
 * NOTES:
 *   - Supports both Sonnet and Opus via model parameter
 *   - Best for complex reasoning tasks (chat/respond, failure analysis)
 *   - Overkill for simple classification -- pipelines should prefer
 *     cheaper brains for triage/classify phases when possible
 *
 * TODO:
 *   - API key management (same approach as Gemini)
 *   - Model selection (sonnet vs opus) from user settings
 */

import { Brain, BrainOptions } from './types';
import { withRetry } from './rateLimiter';

const CLAUDE_MODELS = {
  'claude-sonnet': 'claude-sonnet-4-20250514',
  'claude-opus': 'claude-opus-4-20250514',
} as const;

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

export class ClaudeBrain implements Brain {
  readonly name: string;
  readonly contextWindow = 200_000;
  readonly supportsVision = true;
  readonly supportsAudio = false;
  readonly isLocal = false;

  private apiKey: string;
  private model: string;

  private variant: 'claude-sonnet' | 'claude-opus';

  constructor(apiKey: string, variant: 'claude-sonnet' | 'claude-opus' = 'claude-sonnet') {
    this.apiKey = apiKey;
    this.model = CLAUDE_MODELS[variant];
    this.variant = variant;
    this.name = `Claude ${variant === 'claude-opus' ? 'Opus' : 'Sonnet'} (cloud)`;
  }

  async text(prompt: string, opts?: BrainOptions): Promise<string> {
    return withRetry(this.variant, async () =>
      this.callClaude(
        [{ role: 'user', content: prompt }],
        opts,
      )
    );
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

  async vision(prompt: string, images: string[], opts?: BrainOptions): Promise<string> {
    const content: any[] = [];

    for (const img of images) {
      const b64 = await this.toBase64(img);
      if (b64) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
        });
      }
    }

    content.push({ type: 'text', text: prompt });

    return withRetry(this.variant, async () =>
      this.callClaude(
        [{ role: 'user', content }],
        opts,
      )
    );
  }

  async audio(_prompt: string, _audioPath: string, _opts?: BrainOptions): Promise<string> {
    throw new Error('Audio input not yet supported by Claude brain. Use E2B brain for audio.');
  }

  async ping(): Promise<boolean> {
    // Claude doesn't have a lightweight health endpoint;
    // just check if the API key is set
    return !!this.apiKey;
  }

  // -- Internal --

  private async callClaude(
    messages: Array<{ role: string; content: string | any[] }>,
    opts?: BrainOptions,
  ): Promise<string> {
    const timeoutMs = opts?.timeout ?? 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: opts?.maxTokens ?? 2048,
          temperature: opts?.temperature ?? 0.3,
          messages,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Claude API ${res.status}: ${text.substring(0, 200)}`);
      }

      const data = await res.json();
      const textBlocks = (data.content || []).filter((c: any) => c.type === 'text');
      return textBlocks.map((c: any) => c.text).join('') || '';
    } finally {
      clearTimeout(timer);
    }
  }

  private async toBase64(imagePath: string): Promise<string> {
    if (imagePath.startsWith('data:')) {
      return imagePath.replace(/^data:image\/\w+;base64,/, '');
    }
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
