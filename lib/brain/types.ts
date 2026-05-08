/**
 * Brain Interface -- minimal contract for AI inference engines.
 *
 * A Brain is a DUMB text-in/text-out wrapper. It knows nothing about food,
 * activities, nutrition, or Mittens' personality. Pipelines build prompts
 * and parse responses; brains just shuttle tokens.
 *
 * IMPLEMENTATIONS:
 *   e2b.ts       -- LiteRT on-device (Gemma 4 E2B). Free, instant, ~150 tok context.
 *   gemma26b.ts  -- Ollama self-hosted (Gemma 4 26B). Free, 3-8s/call, 8K context.
 *   gemini.ts    -- Google Gemini Flash API. Paid, fast, 1M context.
 *   claude.ts    -- Anthropic Claude API. Paid, best reasoning, 200K context.
 *
 * MIGRATED FROM:
 *   - LocalInferenceService (lib/services/ai/localInference.ts) → e2b.ts
 *   - OllamaProvider.callChat() (lib/providers/ollamaProvider.ts) → gemma26b.ts
 *   - geminiVision._callGemini() (Strapi backend) → gemini.ts
 *   - geminiVision._callClaudeJSON() (Strapi backend) → claude.ts
 *   - providerFactory.ts inference half → selector.ts
 */

export interface BrainOptions {
  /** Temperature for generation (0.0 = deterministic, 1.0 = creative) */
  temperature?: number;
  /** Max tokens to generate */
  maxTokens?: number;
  /** Timeout in ms (default varies by brain) */
  timeout?: number;
}

export interface Brain {
  /** Human-readable name for logging */
  readonly name: string;

  /** Max context window in tokens (used by pipelines to adapt prompt size) */
  readonly contextWindow: number;

  /** Whether this brain supports vision (image input) */
  readonly supportsVision: boolean;

  /** Whether this brain supports audio (audio file input) */
  readonly supportsAudio: boolean;

  /** Whether this brain runs locally (no network needed) */
  readonly isLocal: boolean;

  /**
   * Text-only generation.
   * Pipeline builds the prompt string; brain returns raw response text.
   */
  text(prompt: string, opts?: BrainOptions): Promise<string>;

  /**
   * JSON-constrained generation.
   * Forces the model to output valid JSON matching the provided schema.
   * Uses grammar-based constrained decoding (GBNF) when available.
   * Falls back to text() + JSON extraction for brains without grammar support.
   */
  json<T = any>(prompt: string, schema: Record<string, any>, fallback: T, opts?: BrainOptions): Promise<T>;

  /**
   * Vision generation (text + images).
   * Images can be file:// paths (local) or base64 strings (cloud).
   * Returns raw response text.
   */
  vision(prompt: string, images: string[], opts?: BrainOptions): Promise<string>;

  /**
   * Audio generation (text + audio file).
   * Audio should be a file:// path to a PCM/WAV file.
   * Returns raw response text.
   */
  audio(prompt: string, audioPath: string, opts?: BrainOptions): Promise<string>;

  /**
   * Quick health check: can we reach this brain?
   * For local brains: is the model loaded?
   * For cloud brains: can we reach the API?
   */
  ping(): Promise<boolean>;

  /**
   * Ensure the brain is ready for inference.
   * For local brains: downloads missing model files, cleans stale ones, loads model.
   * Cloud brains don't need this (they're always ready if network is up).
   * Callers should check for this method and call it before first inference.
   */
  ensureReady?(onProgress?: (p: ReadyProgress) => void): Promise<void>;
}

export interface ReadyProgress {
  phase: 'cleanup' | 'download' | 'load';
  message: string;
  /** 0-1 progress for download phase */
  progress?: number;
}

/** Brain selection is based on user settings in profile */
export type BrainId =
  | 'e2b'
  | 'llama-rn'
  | 'fastvlm'
  | 'smolvlm2'
  | 'moondream2'
  | 'gemma26b'
  | 'gemini'
  | 'gemini-flash'
  | 'claude-sonnet'
  | 'claude-opus'
  | 'groq-free'
  | 'openrouter-free';

