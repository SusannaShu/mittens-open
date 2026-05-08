/**
 * Gemini Brain -- Google Gemini Flash API (direct, no Strapi proxy).
 *
 * CHARACTERISTICS:
 *   - Cost: Paid per token (Flash is cheapest tier)
 *   - Latency: 1-3s per call
 *   - Context: 1M tokens (but pipelines keep prompts small anyway)
 *   - Vision: Yes (best-in-class for food recognition)
 *   - Network: Required (cloud API)
 *
 * MIGRATED FROM:
 *   Strapi backend: gemini-vision.js (_callGemini)
 *   Now called DIRECTLY from the phone -- no Strapi round-trip.
 *   This is the key cost-saving move: phased small prompts instead of
 *   one massive smartExtract prompt proxied through Strapi.
 *
 * NOTES:
 *   - API key stored in app config (not Strapi env)
 *   - Uses responseMimeType: 'application/json' for structured output
 *   - For phased pipeline, each call is ~100-200 tokens instead of ~5000
 *
 * TODO:
 *   - API key management: user enters their own key, or we proxy through
 *     a lightweight auth endpoint that adds the key server-side
 *   - Rate limiting on client side
 *   - Token counting for cost display
 */

import { Brain, BrainOptions } from './types';
import { withRetry } from './rateLimiter';

const GEMINI_MODEL = 'gemini-2.5-flash';
const BRAIN_ID = 'gemini';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

export class GeminiBrain implements Brain {
  readonly name = 'Gemini Flash (cloud)';
  readonly contextWindow = 1_000_000;
  readonly supportsVision = true;
  readonly supportsAudio = false;
  readonly isLocal = false;

  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async text(prompt: string, opts?: BrainOptions): Promise<string> {
    return withRetry(BRAIN_ID, async () => {
      const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: opts?.temperature ?? 0.2,
          responseMimeType: 'application/json',
        },
      };
      return this.callGemini(requestBody, opts?.timeout);
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
    const parts: any[] = [{ text: prompt }];

    for (const img of images) {
      const b64 = await this.toBase64(img);
      if (b64) {
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
      }
    }

    return withRetry(BRAIN_ID, async () => {
      const requestBody = {
        contents: [{ parts }],
        generationConfig: {
          temperature: opts?.temperature ?? 0.2,
          responseMimeType: 'application/json',
        },
      };
      return this.callGemini(requestBody, opts?.timeout);
    });
  }

  async audio(_prompt: string, _audioPath: string, _opts?: BrainOptions): Promise<string> {
    throw new Error('Audio input not yet supported by Gemini brain. Use E2B brain for audio.');
  }

  async ping(): Promise<boolean> {
    try {
      const url = `${GEMINI_BASE_URL}/v1beta/models?key=${this.apiKey}`;
      const res = await fetch(url);
      return res.ok;
    } catch {
      return false;
    }
  }

  // -- Internal --

  private async callGemini(requestBody: any, timeoutMs = 30_000): Promise<string> {
    const url = `${GEMINI_BASE_URL}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${this.apiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Gemini API ${res.status}: ${text.substring(0, 200)}`);
      }

      const data = await res.json();
      const parts = ((data.candidates || [{}])[0].content || {}).parts;
      if (!parts || !parts.length) throw new Error('Empty response from Gemini');
      return parts[0].text || '';
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
