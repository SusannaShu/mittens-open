/**
 * OllamaProvider -- OpenAI-compatible inference provider.
 *
 * Works with any endpoint that speaks the OpenAI chat/completions format:
 * - Ollama (self-hosted on MacBook / other device)
 * - BYOK (user's own API key with OpenAI, Together, Groq, etc.)
 *
 * Throws ConnectionError (not generic Error) when endpoint is unreachable,
 * which triggers the queue prompt in the chat UI.
 */

import {
  InferenceProvider,
  FoodIdentification,
  NutrientEstimate,
  EstimationContext,
  ChatContext,
  ChatResponse,
} from './inferenceProvider';
import { estimateNutrients as estimateNutrientsUSDA, flattenNutrients } from '../services/food/nutrientEstimator';

// ──────────── Connection Error ────────────

export class ConnectionError extends Error {
  constructor(url: string, cause?: Error) {
    super(`Cannot reach ${url}${cause ? `: ${cause.message}` : ''}`);
    this.name = 'ConnectionError';
  }
}

// ──────────── Config ────────────

export interface OllamaConfig {
  baseUrl: string;    // e.g. http://192.168.1.100:11434
  apiKey?: string;     // optional for Ollama, required for BYOK
  model?: string;      // e.g. gemma4:27b (defaults to gemma4)
}

// ──────────── Helpers ────────────

/** Extract JSON from a potentially noisy model response */
function extractJSON(raw: string): any | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch { /* invalid JSON */ }
  return null;
}

// ──────────── Provider ────────────

export class OllamaProvider implements InferenceProvider {
  private config: OllamaConfig;

  constructor(config: OllamaConfig) {
    this.config = {
      ...config,
      model: config.model || 'gemma4:e2b',
    };
  }

  /** Core: call the OpenAI-compatible chat/completions endpoint */
  private async callChat(
    messages: Array<{ role: string; content: string | any[] }>,
    options?: { timeout?: number }
  ): Promise<string> {
    const url = `${this.config.baseUrl}/v1/chat/completions`;
    const timeoutMs = options?.timeout ?? 60_000;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const body = JSON.stringify({
      model: this.config.model,
      messages,
      temperature: 0.3,
      max_tokens: 2048,
    });

    // Use AbortController for timeout
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
      // Distinguish connection errors from other failures
      if (
        e.name === 'AbortError' ||
        e.message?.includes('Network request failed') ||
        e.message?.includes('Failed to fetch') ||
        e.message?.includes('ECONNREFUSED') ||
        e.message?.includes('ETIMEDOUT') ||
        e.message?.includes('Cannot reach')
      ) {
        throw new ConnectionError(this.config.baseUrl, e);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Build a text-only message */
  private textMessage(role: string, text: string) {
    return { role, content: text };
  }

  /** Build a vision message with text + base64 image */
  private visionMessage(role: string, text: string, imageBase64: string) {
    return {
      role,
      content: [
        { type: 'text', text },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${imageBase64}`,
          },
        },
      ],
    };
  }

  /** Read a local file path to base64 for vision */
  private async readImageBase64(imagePath: string): Promise<string> {
    try {
      const FileSystem = require('expo-file-system/legacy');
      return await FileSystem.readAsStringAsync(imagePath, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch {
      return '';
    }
  }

  /** Quick health check: can we reach the endpoint? */
  async ping(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.config.baseUrl}/v1/models`, {
        signal: controller.signal,
        headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════════
  // InferenceProvider implementation
  // ═══════════════════════════════════════

  async identifyFoods(images: string[], caption?: string): Promise<FoodIdentification> {
    const prompt = `Identify every food item in this meal. Focus on PRECISION for portions.

PORTION RULES:
- Use plate/bowl/utensils as size references (dinner plate ~25cm)
- Be CONSERVATIVE: estimate LOWER when unsure. Most sides are 30-80g.
- ALWAYS provide both grams AND household measure (1/2 cup, 2 tbsp, 3 pieces, etc.)

For EACH item, rate confidence 0.0-1.0:
0.9+: clearly visible. 0.6-0.8: likely but ambiguous. <0.3: very uncertain
${caption ? `\nUser says: "${caption}"` : ''}

JSON only: {"foods":[{"name":"Carrot sticks","portion_g":45,"household":"3 sticks","cooking":"raw","confidence":0.9}],"mealType":"lunch"}`;

    let messages;
    if (images.length > 0) {
      const b64 = await this.readImageBase64(images[0]);
      if (b64) {
        messages = [this.visionMessage('user', prompt, b64)];
      } else {
        messages = [this.textMessage('user', prompt)];
      }
    } else {
      messages = [this.textMessage('user', prompt)];
    }

    const raw = await this.callChat(messages);
    const parsed = extractJSON(raw);

    if (parsed?.foods) {
      return {
        foods: parsed.foods.map((f: any) => ({
          name: f.name || f.n || '',
          portion_g: f.portion_g || f.g || 0,
          cooking: f.cooking || f.k,
          confidence: f.confidence ?? f.c ?? 0.8,
        })),
        mealType: parsed.mealType,
      };
    }

    return { foods: [] };
  }

  async estimateNutrients(
    food: { name: string; portion_g: number; cooking?: string },
    _context: EstimationContext
  ): Promise<NutrientEstimate> {
    // Use the same USDA-referenced pipeline as Gemma
    const result = await estimateNutrientsUSDA(food.name, food.portion_g, food.cooking || '');
    const { allReferences, usedReference, adjustments, reasoning } = result.meta;

    return {
      nutrients: flattenNutrients(result.nutrients),
      meta: {
        source: allReferences.length > 0 ? 'usda_ref' : 'ai_estimate',
        usedRef: usedReference ? {
          fdcId: usedReference.fdcId,
          name: usedReference.name,
          score: usedReference.score,
        } : undefined,
        allRefs: allReferences.map(r => ({
          fdcId: r.fdcId, name: r.name, score: r.score,
        })),
        adjustments: adjustments.map(a => ({
          nutrient: a.key,
          usdaValue: a.usdaValue,
          adjustedValue: a.adjustedValue,
          reason: a.reason,
        })),
        reasoning,
        justification: usedReference
          ? `Ref: ${usedReference.name}${adjustments.length > 0 ? ` (${adjustments.length} adjustments)` : ''}`
          : reasoning || 'AI estimated',
      },
    };
  }

  async chat(context: ChatContext): Promise<ChatResponse> {
    const messages = [
      this.textMessage('system', 'You are Mittens. Direct, concise, evidence-based, no emojis. Respond in JSON: {"reply":"your response","memoryUpdates":[],"dataNeeded":[]}'),
      this.textMessage('user', context.message),
    ];

    const raw = await this.callChat(messages);
    const parsed = extractJSON(raw);

    if (parsed) {
      return {
        reply: parsed.reply || parsed.r || raw.trim(),
        memoryUpdates: parsed.memoryUpdates || parsed.mu || [],
        dataNeeded: parsed.dataNeeded || parsed.dn || [],
        actions: parsed.actions || [],
      };
    }

    return { reply: raw.trim(), memoryUpdates: [], dataNeeded: [] };
  }

  async generateRaw(prompt: string): Promise<string> {
    return this.callChat([this.textMessage('user', prompt)]);
  }

  async generateWithImage(prompt: string, imagePath: string): Promise<string> {
    const b64 = await this.readImageBase64(imagePath);
    if (b64) {
      return this.callChat([this.visionMessage('user', prompt, b64)]);
    }
    return this.callChat([this.textMessage('user', prompt)]);
  }
}
