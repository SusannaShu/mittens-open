/**
 * Rate Limiter -- token-bucket rate limiter per brain provider.
 *
 * Prevents 429 errors by throttling API calls to stay within
 * provider rate limits. Each provider gets its own bucket.
 *
 * Provider limits (requests per minute):
 *   - Gemini Flash: 15 RPM (free tier), 1500 RPM (paid)
 *   - Claude:       50 RPM
 *   - Groq:         30 RPM (free tier)
 *   - OpenRouter:   200 RPM (free tier varies by model)
 *
 * Also handles 429 retry with exponential backoff.
 */

interface RateLimitConfig {
  /** Max requests in the window */
  maxRequests: number;
  /** Window duration in ms */
  windowMs: number;
}

const PROVIDER_LIMITS: Record<string, RateLimitConfig> = {
  'gemini-flash':     { maxRequests: 12,  windowMs: 60_000 },
  'gemini':           { maxRequests: 12,  windowMs: 60_000 },
  'claude-sonnet':    { maxRequests: 40,  windowMs: 60_000 },
  'claude-opus':      { maxRequests: 40,  windowMs: 60_000 },
  'groq-free':        { maxRequests: 25,  windowMs: 60_000 },
  'openrouter-free':  { maxRequests: 15,  windowMs: 60_000 },
  // Local brains — no limit
  'e2b':              { maxRequests: 999, windowMs: 1_000 },
  'llama-rn':         { maxRequests: 999, windowMs: 1_000 },
  'fastvlm':          { maxRequests: 999, windowMs: 1_000 },
  'smolvlm2':         { maxRequests: 999, windowMs: 1_000 },
  'moondream2':       { maxRequests: 999, windowMs: 1_000 },
  'gemma26b':         { maxRequests: 999, windowMs: 1_000 },
};

const DEFAULT_LIMIT: RateLimitConfig = { maxRequests: 10, windowMs: 60_000 };

class TokenBucket {
  private timestamps: number[] = [];
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Wait until a request slot is available, then consume it.
   * Returns immediately if under the limit.
   */
  async acquire(): Promise<void> {
    this.pruneExpired();

    if (this.timestamps.length < this.config.maxRequests) {
      this.timestamps.push(Date.now());
      return;
    }

    // Over limit — wait until the oldest request expires
    const oldestTs = this.timestamps[0];
    const waitMs = (oldestTs + this.config.windowMs) - Date.now() + 50; // 50ms buffer

    if (waitMs > 0) {
      console.log(`[RateLimiter] Throttling: waiting ${waitMs}ms (${this.timestamps.length}/${this.config.maxRequests} used)`);
      await sleep(waitMs);
    }

    this.pruneExpired();
    this.timestamps.push(Date.now());
  }

  /** Remove timestamps outside the current window */
  private pruneExpired(): void {
    const cutoff = Date.now() - this.config.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }

  /** Current usage for diagnostics */
  get usage(): { used: number; max: number } {
    this.pruneExpired();
    return { used: this.timestamps.length, max: this.config.maxRequests };
  }
}

// ─── Singleton buckets per provider ───

const buckets = new Map<string, TokenBucket>();

function getBucket(brainId: string): TokenBucket {
  if (!buckets.has(brainId)) {
    const config = PROVIDER_LIMITS[brainId] || DEFAULT_LIMIT;
    buckets.set(brainId, new TokenBucket(config));
  }
  return buckets.get(brainId)!;
}

/**
 * Acquire a rate limit token before making an API call.
 * Blocks if the provider's rate limit would be exceeded.
 */
export async function acquireRateLimit(brainId: string): Promise<void> {
  const bucket = getBucket(brainId);
  await bucket.acquire();
}

/**
 * Get current rate limit usage for diagnostics.
 */
export function getRateLimitUsage(brainId: string): { used: number; max: number } {
  const bucket = getBucket(brainId);
  return bucket.usage;
}

/**
 * Wrap an async function with retry-on-429 logic.
 * Uses exponential backoff: 1s, 2s, 4s, 8s, then fail.
 */
export async function withRetry<T>(
  brainId: string,
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await acquireRateLimit(brainId);
      return await fn();
    } catch (err: any) {
      lastError = err;
      const is429 = err?.message?.includes('429') ||
                     err?.message?.toLowerCase().includes('rate limit') ||
                     err?.message?.toLowerCase().includes('too many requests');

      if (!is429 || attempt >= maxRetries) {
        throw err;
      }

      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000);
      console.log(`[RateLimiter] 429 from ${brainId}, retry ${attempt + 1}/${maxRetries} in ${backoffMs}ms`);
      await sleep(backoffMs);
    }
  }

  throw lastError || new Error('Rate limit retries exhausted');
}

// ─── Helpers ───

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
