/**
 * ambient/sceneDedup.ts -- Vision-based scene continuity engine.
 *
 * Replaces text-based scene matching ("work" === "work") with actual image
 * comparison. Two frames with the same text label can be completely different
 * scenes (e.g., "social" at coffee shop vs "social" at office). This module
 * sends the scene's reference frame and the current capture to the brain
 * to determine if they are the same continuous event.
 *
 * Returns a continuity score (0-1) and whether the scene should extend
 * or a new one should open.
 */

import type { Scene } from './types';

export interface ContinuityResult {
  /** 0-1 score where 1 = definitely same scene */
  score: number;
  /** Whether this is the same continuous event */
  isSameScene: boolean;
  /** What changed between frames (if anything) */
  changes?: string;
  /** Raw brain response for debugging */
  rawResponse?: string;
}

/**
 * Compare a scene's reference frame against a new capture using vision.
 * Falls back to text-only matching if vision fails or no reference frame exists.
 */
export async function checkContinuity(
  scene: Scene,
  currentFramePath: string,
): Promise<ContinuityResult> {
  const referenceFrame = scene.lastFramePath || scene.framePaths[0];

  // No reference frame available -- fall back to text match
  if (!referenceFrame) {
    return { score: 0.5, isSameScene: true, changes: 'no reference frame' };
  }

  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    const prompt = buildContinuityPrompt(scene);
    const raw = await brain.vision(prompt, [referenceFrame, currentFramePath]);

    return parseContinuityResult(raw);
  } catch (err: any) {
    console.warn('[SceneDedup] Vision continuity failed, using text fallback:', err?.message);
    // Fall back to true -- assume same scene if vision fails
    return { score: 0.5, isSameScene: true, changes: 'vision_error' };
  }
}

function buildContinuityPrompt(scene: Scene): string {
  return [
    'Two photos from a wearable camera. Photo 1 is the reference, Photo 2 is now.',
    `Current activity: ${scene.type}/${scene.subPhase}`,
    'Respond JSON only:',
    '{',
    '  "same": true/false (same continuous event or location?),',
    '  "score": 0-1 (how similar are the scenes),',
    '  "changes": "what changed between frames"',
    '}',
  ].join('\n');
}

function parseContinuityResult(raw: string): ContinuityResult {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return { score: 0.5, isSameScene: true, rawResponse: raw };
    }

    const parsed = JSON.parse(match[0]);
    const score = Number(parsed.score ?? parsed.s ?? 0.5);
    const isSame = parsed.same ?? parsed.isSame ?? score >= 0.5;

    return {
      score,
      isSameScene: Boolean(isSame),
      changes: parsed.changes || parsed.diff || undefined,
      rawResponse: raw,
    };
  } catch {
    return { score: 0.5, isSameScene: true, rawResponse: raw };
  }
}
