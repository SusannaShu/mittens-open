/**
 * Gemma 26B Brain -- self-hosted Ollama inference via OpenAI-compatible API.
 *
 * CHARACTERISTICS:
 *   - Cost: $0 (runs on user's Mac/server)
 *   - Latency: 3-8s per call depending on hardware + prompt size
 *   - Context: 8K tokens (32K with RoPE scaling, but slower)
 *   - Vision: Yes (Gemma 4 is multimodal)
 *   - Network: Local WiFi (same network as phone)
 *
 * MIGRATED FROM:
 *   lib/providers/ollamaProvider.ts (OllamaProvider.callChat)
 *   Keeps the same OpenAI-compatible /v1/chat/completions format.
 *   ConnectionError class stays for queue-prompt UX.
 *
 * NOTES:
 *   - User configures baseUrl in Profile → Self-Hosted (e.g. http://192.168.x.x:11434)
 *   - Model name comes from user settings (default: gemma4:26b)
 *   - Can also work with any OpenAI-compatible endpoint (Together, Groq, etc.)
 *   - For BYOK mode, apiKey is set in user settings
 */

import { Brain, BrainOptions } from './types';

export class ConnectionError extends Error {
  constructor(url: string, cause?: Error) {
    super(`Cannot reach ${url}${cause ? `: ${cause.message}` : ''}`);
    this.name = 'ConnectionError';
  }
}

interface Gemma26BConfig {
  baseUrl: string;
  apiKey?: string;
  model?: string;
}

export class Gemma26BBrain implements Brain {
  readonly name = 'Gemma 26B (self-hosted)';
  readonly contextWindow = 8192;
  readonly supportsVision = true;
  readonly supportsAudio = false;
  readonly isLocal = true; // no cloud API cost, but needs network to reach Mac

  private config: Gemma26BConfig;

  constructor(config: Gemma26BConfig) {
    const cleanModel = (config.model || '').trim().replace(/\s*:\s*/g, ':');
    this.config = {
      ...config,
      model: cleanModel || 'gemma4:e2b',
    };
  }

  async text(prompt: string, opts?: BrainOptions): Promise<string> {
    return this.callChat(
      [{ role: 'user', content: prompt }],
      opts,
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
    // Read images as base64 for OpenAI vision format
    const content: any[] = [{ type: 'text', text: prompt }];

    for (const imagePath of images) {
      const b64 = await this.readImageBase64(imagePath);
      if (b64) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${b64}` },
        });
      }
    }

    return this.callChat(
      [{ role: 'user', content }],
      opts,
    );
  }

  async audio(_prompt: string, _audioPath: string, _opts?: BrainOptions): Promise<string> {
    throw new Error('Audio input not supported by Gemma 26B (self-hosted). Use E2B brain for audio.');
  }

  async ping(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const headers: Record<string, string> = {};
      if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      const res = await fetch(`${this.config.baseUrl}/v1/models`, {
        signal: controller.signal,
        headers,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  // -- Internal --

  private async callChat(
    messages: Array<{ role: string; content: string | any[] }>,
    opts?: BrainOptions,
  ): Promise<string> {
    const url = `${this.config.baseUrl}/v1/chat/completions`;
    const timeoutMs = opts?.timeout ?? 60_000;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;

    const body = JSON.stringify({
      model: this.config.model,
      messages,
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens ?? 2048,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`API ${res.status}: ${text.substring(0, 200)}`);
      }

      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (e: any) {
      if (
        e.name === 'AbortError' ||
        e.message?.includes('Network request failed') ||
        e.message?.includes('Failed to fetch') ||
        e.message?.includes('ECONNREFUSED')
      ) {
        throw new ConnectionError(this.config.baseUrl, e);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private async readImageBase64(imagePath: string): Promise<string> {
    try {
      if (imagePath.startsWith('data:')) {
        return imagePath.replace(/^data:image\/\w+;base64,/, '');
      }
      const FileSystem = require('expo-file-system/legacy');
      return await FileSystem.readAsStringAsync(imagePath, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch {
      return '';
    }
  }
}
