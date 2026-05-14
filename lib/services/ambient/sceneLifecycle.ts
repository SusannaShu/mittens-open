/**
 * ambient/sceneLifecycle.ts -- Scene lifecycle helpers extracted from manager.
 *
 * Contains after-frame triggers, face recognition, timeout checks,
 * and close-and-route logic used by SceneStreamManager.
 */

import type { Scene, SceneClassification } from './types';
import { closeScene, isTimedOut, persistScene } from './scene';
import type { PipelineLogger } from '../../pipelines/logger';

/**
 * Delegate after-frame trigger checks to sceneTriggers module.
 */
export function checkAfterFrameTriggers(
  scene: Scene,
  classification: SceneClassification,
  logger: PipelineLogger,
): void {
  const { checkAfterFrameTriggers: check } = require('./sceneTriggers');
  check(scene, classification, logger);
}

/**
 * Delegate face recognition to the sceneFaceRecognition module.
 */
export async function checkFaceRecognition(
  framePath: string,
  scene: Scene,
  logger: PipelineLogger,
): Promise<void> {
  const { checkFaceRecognition: check } = require('./sceneFaceRecognition');
  await check(framePath, scene, logger);
}

/**
 * Check all open scenes for timeout and close expired ones.
 * Returns array of closed scene IDs.
 */
export function checkTimeouts(
  openScenes: Scene[],
  nonMatchCounts: Map<string, number>,
  _timestamp: number,
  logger: PipelineLogger,
  closeAndRouteFn: (scene: Scene, reason: string, logger: PipelineLogger) => void,
): void {
  const now = Date.now();
  const toClose: Scene[] = [];

  for (const scene of openScenes) {
    if (isTimedOut(scene, now)) {
      toClose.push(scene);
    }
  }

  for (const scene of toClose) {
    closeAndRouteFn(scene, 'timeout', logger);
  }
}

/**
 * Close a scene and handle cleanup: persist, apply pantry deltas.
 * Note: log creation is now per-capture (not deferred to close).
 */
export function closeAndRoute(
  scene: Scene,
  reason: 'scene_change' | 'timeout' | 'geofence_exit' | 'user',
  openScenes: Scene[],
  nonMatchCounts: Map<string, number>,
  logger: PipelineLogger,
): Scene[] {
  const closeIdx = logger.startPhase('scene', 'close');
  closeScene(scene, reason);

  // Remove from open scenes (return new array)
  const updatedScenes = openScenes.filter((s) => s.id !== scene.id);
  nonMatchCounts.delete(scene.id);

  logger.completePhase(
    closeIdx,
    `Closed: ${reason}, ${scene.frameCount} frames`,
  );

  console.log(
    `[SceneStream] Closed scene ${scene.id}: ${scene.type} ` +
    `(${reason}, ${scene.frameCount} frames)`,
  );

  // Persist scene log
  persistScene(scene, logger.finalize());

  // Apply pantry deltas if any
  if (scene.pantryDeltas.length > 0) {
    try {
      const { applyPantryDeltas } = require('./smartPantry');
      const runningLow = applyPantryDeltas(scene.pantryDeltas);
      if (runningLow.length > 0) {
        try {
          const { nudgeLowPantry } = require('./nudgeComposer');
          nudgeLowPantry(runningLow[0].name);
        } catch { /* nudgeComposer not loaded */ }
      }
    } catch { /* smartPantry not loaded */ }
  }

  return updatedScenes;
}
