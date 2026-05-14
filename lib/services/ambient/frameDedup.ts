/**
 * ambient/frameDedup.ts -- Pre-triage frame deduplication.
 *
 * Two-tier check before running the expensive classifier + triage:
 *   Tier 1: Pixel-level similarity via downsampled base64 comparison (free, instant)
 *   Tier 2: VLM inference comparing both frames (cheap, semantic)
 *
 * If either tier determines the frame is a duplicate, it gets deleted
 * and the pipeline skips all processing.
 */

const FileSystem = require('expo-file-system/legacy');

// ─── State ───

let lastFramePath: string | null = null;

/** Minimum pixel distance to consider frames different (tier 1) */
const PIXEL_DIFF_THRESHOLD = 0.05;

// ─── Public API ───

export interface DedupResult {
  isDuplicate: boolean;
  /** 0 = no last frame, 1 = pixel match, 2 = VLM match */
  tier: 0 | 1 | 2;
  reason: string;
}

/**
 * Two-tier frame dedup check.
 * Compares the incoming frame against the last processed frame.
 */
export async function checkFrameDedup(framePath: string): Promise<DedupResult> {
  if (!lastFramePath) {
    return { isDuplicate: false, tier: 0, reason: 'First frame (no reference)' };
  }

  // Verify last frame still exists
  try {
    const info = await FileSystem.getInfoAsync(lastFramePath);
    if (!info.exists) {
      lastFramePath = null;
      return { isDuplicate: false, tier: 0, reason: 'Reference frame missing' };
    }
  } catch {
    lastFramePath = null;
    return { isDuplicate: false, tier: 0, reason: 'Reference check failed' };
  }

  // Tier 1: Pixel-level comparison via file size heuristic + base64 sample
  try {
    const tier1 = await pixelSimilarityCheck(lastFramePath, framePath);
    if (tier1.similar) {
      return {
        isDuplicate: true,
        tier: 1,
        reason: `Pixel duplicate (diff: ${tier1.distance.toFixed(3)})`,
      };
    }
  } catch (err: any) {
    console.warn('[FrameDedup] Tier 1 failed:', err?.message);
  }

  // Tier 2: VLM semantic comparison
  try {
    const tier2 = await vlmSimilarityCheck(lastFramePath, framePath);
    if (tier2.skip) {
      return {
        isDuplicate: true,
        tier: 2,
        reason: tier2.reason || 'VLM: same scene, no change',
      };
    }
  } catch (err: any) {
    console.warn('[FrameDedup] Tier 2 failed:', err?.message);
  }

  return { isDuplicate: false, tier: 0, reason: 'Frames are different' };
}

/** Update the reference frame after successful processing. */
export function setLastFrame(path: string): void {
  lastFramePath = path;
}

/** Get the current reference frame (for debugging). */
export function getLastFrame(): string | null {
  return lastFramePath;
}

// ─── Tier 1: Pixel Comparison ───

/**
 * Fast pixel-level comparison.
 * Downsample both frames to tiny thumbnails and compare base64 bytes.
 * Uses expo-image-manipulator for resize.
 */
async function pixelSimilarityCheck(
  refPath: string,
  newPath: string,
): Promise<{ similar: boolean; distance: number }> {
  const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');

  // Resize both to 32x32 JPEG (tiny, fast)
  const [refThumb, newThumb] = await Promise.all([
    manipulateAsync(
      refPath,
      [{ resize: { width: 32, height: 32 } }],
      { format: SaveFormat.JPEG, compress: 0.5, base64: true },
    ),
    manipulateAsync(
      newPath,
      [{ resize: { width: 32, height: 32 } }],
      { format: SaveFormat.JPEG, compress: 0.5, base64: true },
    ),
  ]);

  // Compare base64 strings byte-by-byte
  const refB64 = refThumb.base64 || '';
  const newB64 = newThumb.base64 || '';

  if (refB64.length === 0 || newB64.length === 0) {
    return { similar: false, distance: 1.0 };
  }

  // Normalized byte distance
  const len = Math.min(refB64.length, newB64.length);
  let diffCount = 0;
  for (let i = 0; i < len; i++) {
    if (refB64[i] !== newB64[i]) diffCount++;
  }
  const distance = diffCount / len;

  // Clean up thumbnail files
  FileSystem.deleteAsync(refThumb.uri, { idempotent: true }).catch(() => {});
  FileSystem.deleteAsync(newThumb.uri, { idempotent: true }).catch(() => {});

  return { similar: distance < PIXEL_DIFF_THRESHOLD, distance };
}

// ─── Tier 2: VLM Comparison ───

/**
 * Send both frames to the VLM and ask if they represent the same
 * unchanged scene. This catches semantic duplicates that pixel
 * comparison misses (slightly different angle, lighting shift, etc).
 */
async function vlmSimilarityCheck(
  refPath: string,
  newPath: string,
): Promise<{ skip: boolean; reason: string }> {
  const { getBrain } = require('../../brain/selector');
  const brain = await getBrain();

  const prompt = [
    'Two consecutive photos from a wearable camera.',
    'Photo 1 is older, Photo 2 is newer.',
    'Is the scene essentially the same with nothing meaningful changed?',
    'Respond JSON only: {"skip": true/false, "reason": "brief explanation"}',
    'skip=true means nothing new to analyze. skip=false means something changed.',
  ].join('\n');

  const raw = await brain.vision(prompt, [refPath, newPath]);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { skip: false, reason: 'VLM: no JSON response' };

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      skip: Boolean(parsed.skip),
      reason: parsed.reason || (parsed.skip ? 'Same scene' : 'Scene changed'),
    };
  } catch {
    return { skip: false, reason: 'VLM: parse failed' };
  }
}
