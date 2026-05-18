/**
 * ambient/frameDedup.ts -- Quality gate for pendant frames.
 *
 * Two-tier check before running the expensive dual classifier:
 *   Tier 1: Pixel-level similarity via downsampled base64 comparison (free, instant)
 *   Tier 2: VLM quality gate -- is the frame legible AND different from last?
 *
 * Reference frame tracking:
 *   - lastFramePath is ONLY updated when a frame is legible AND non-duplicate
 *   - Illegible/black frames are rejected without corrupting the reference
 *   - Previous frame description is fed to VLM for semantic comparison
 */

const FileSystem = require('expo-file-system/legacy');

// --- State ---

let lastFramePath: string | null = null;
let lastFrameDescription: string | null = null;

/** Minimum pixel distance to consider frames different (tier 1) */
const PIXEL_DIFF_THRESHOLD = 0.05;

// --- Public API ---

export interface QualityGateResult {
  /** Should this frame be skipped (duplicate, blurry, black)? */
  skip: boolean;
  /** 0 = no last frame, 1 = pixel match, 2 = VLM quality gate */
  tier: 0 | 1 | 2;
  reason: string;
}

export interface QualityGateOptions {
  /** When true, skip legibility rejection (allow dark/blurry frames through for sleep detection) */
  nearBedtime?: boolean;
}

/**
 * Two-tier quality gate.
 * Tier 1: pixel comparison (free).
 * Tier 2: VLM check for legibility + scene change.
 *
 * Near bedtime, legibility checks are disabled so dark/screen frames
 * can pass through for sleep context analysis.
 */
export async function checkQualityGate(
  framePath: string,
  opts: QualityGateOptions = {},
): Promise<QualityGateResult> {
  // Tier 1: Pixel-level pre-filter (free, instant)
  if (lastFramePath) {
    try {
      const info = await FileSystem.getInfoAsync(lastFramePath);
      if (!info.exists) {
        lastFramePath = null;
        lastFrameDescription = null;
      }
    } catch {
      lastFramePath = null;
      lastFrameDescription = null;
    }

    if (lastFramePath) {
      try {
        const tier1 = await pixelSimilarityCheck(lastFramePath, framePath);
        if (tier1.similar) {
          // Do NOT update lastFramePath -- keep current reference
          return {
            skip: true,
            tier: 1,
            reason: `Pixel duplicate (diff: ${tier1.distance.toFixed(3)})`,
          };
        }
      } catch (err: any) {
        console.warn('[QualityGate] Tier 1 failed:', err?.message);
      }
    }
  }

  // Tier 2: VLM quality gate (legible + same_as_before in one call)
  if (lastFramePath) {
    try {
      const tier2 = await vlmQualityGate(lastFramePath, framePath, lastFrameDescription, opts.nearBedtime);
      if (tier2.skip) {
        // Do NOT update lastFramePath -- illegible or duplicate frames
        // must not corrupt the reference
        return { skip: true, tier: 2, reason: tier2.reason };
      }
    } catch (err: any) {
      console.warn('[QualityGate] Tier 2 failed:', err?.message);
    }
  } else if (!opts.nearBedtime) {
    // No reference frame -- check legibility (blurry/black)
    // Skip this near bedtime so dark frames pass through for sleep detection
    try {
      const tier2 = await vlmLegibilityCheck(framePath);
      if (tier2.skip) {
        // Do NOT update lastFramePath -- keep waiting for first legible frame
        return { skip: true, tier: 2, reason: tier2.reason };
      }
    } catch (err: any) {
      console.warn('[QualityGate] Legibility check failed:', err?.message);
    }
  }

  return { skip: false, tier: 0, reason: 'Frame passed quality gate' };
}

/**
 * Update the reference frame after successful processing.
 * ONLY call this when the frame is legible AND has new content.
 */
export function setLastFrame(path: string, description?: string): void {
  lastFramePath = path;
  lastFrameDescription = description || null;
}

/** Get the current reference frame (for debugging). */
export function getLastFrame(): string | null {
  return lastFramePath;
}

/** Get the current reference frame description (for debugging). */
export function getLastFrameDescription(): string | null {
  return lastFrameDescription;
}

// --- Tier 1: Pixel Comparison ---

async function pixelSimilarityCheck(
  refPath: string,
  newPath: string,
): Promise<{ similar: boolean; distance: number }> {
  const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');

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

  const refB64 = refThumb.base64 || '';
  const newB64 = newThumb.base64 || '';

  if (refB64.length === 0 || newB64.length === 0) {
    return { similar: false, distance: 1.0 };
  }

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

// --- Tier 2: VLM Quality Gate ---

/**
 * Combined legibility + dedup check when we have a reference frame.
 * One VLM call answers: is it legible AND is it different from last?
 * Includes the previous frame's description for semantic context.
 */
async function vlmQualityGate(
  refPath: string,
  newPath: string,
  prevDescription: string | null,
  nearBedtime = false,
): Promise<{ skip: boolean; reason: string }> {
  const { getBrain } = require('../../brain/selector');
  const brain = await getBrain();

  const descContext = prevDescription
    ? `\nThe previous frame was described as: "${prevDescription}"\n`
    : '';

  const prompt = [
    'Two consecutive photos from a wearable camera.',
    'Photo 1 is the previous frame. Photo 2 is the new frame.',
    descContext,
    'Respond JSON only:',
    '{',
    '  "legible": true/false (is Photo 2 clear enough to analyze? false if blurry, black, or unrecognizable),',
    '  "same_as_before": true/false (has ANYTHING meaningful changed between the two photos?),',
    '  "reason": "brief explanation"',
    '}',
    '',
    'IMPORTANT: Did the scene change at all?',
    'If everything is the same but the angle or lighting is different, set same_as_before=true.',
    'If ANY of the following changed, set same_as_before=false:',
    '- Activity (e.g. sitting at desk -> walking to kitchen)',
    '- Environment (e.g. indoors -> outdoors, different room)',
    '- Interaction (e.g. alone -> with someone)',
    '- Object (e.g. new item appeared, food/drink state changed)',
    '- User state (e.g. working -> resting, eating -> cooking)',
  ].join('\n');

  const raw = await brain.vision(prompt, [refPath, newPath]);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { skip: false, reason: 'VLM: no JSON response' };

    const parsed = JSON.parse(jsonMatch[0]);

    // Near bedtime: let dark/blurry frames through for sleep context detection
    if (!parsed.legible && !nearBedtime) {
      // Do NOT update reference frame for illegible frames
      return { skip: true, reason: `Not legible: ${parsed.reason || 'blurry/black'}` };
    }
    if (parsed.same_as_before || parsed.sameAsBefore) {
      return { skip: true, reason: `Same scene: ${parsed.reason || 'no change'}` };
    }

    return { skip: false, reason: parsed.reason || 'Frame is different and legible' };
  } catch {
    return { skip: false, reason: 'VLM: parse failed' };
  }
}

/**
 * Legibility-only check when we have no reference frame.
 * Catches black/blurry frames on the very first capture.
 */
async function vlmLegibilityCheck(
  framePath: string,
): Promise<{ skip: boolean; reason: string }> {
  const { getBrain } = require('../../brain/selector');
  const brain = await getBrain();

  const prompt = [
    'Photo from a wearable camera.',
    'Respond JSON only:',
    '{',
    '  "legible": true/false (is this photo clear enough to analyze? false if blurry, black, covered, or unrecognizable),',
    '  "reason": "brief explanation"',
    '}',
  ].join('\n');

  const raw = await brain.vision(prompt, [framePath]);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { skip: false, reason: 'VLM: no JSON response' };

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.legible) {
      return { skip: true, reason: `Not legible: ${parsed.reason || 'blurry/black'}` };
    }
    return { skip: false, reason: 'Frame is legible' };
  } catch {
    return { skip: false, reason: 'VLM: parse failed' };
  }
}
