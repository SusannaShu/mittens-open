/**
 * ambient/sceneTriggers.ts -- After-frame triggers for the scene pipeline.
 *
 * Checks sedentary timers, cook timers, and ambiguous food items
 * after each frame is processed. Extracted from sceneStreamManager.ts.
 */

import type { Scene, SceneClassification } from './types';
import type { PipelineLogger } from '../../pipelines/logger';

/**
 * Run all after-frame trigger checks for a scene.
 */
export function checkAfterFrameTriggers(
  scene: Scene,
  classification: SceneClassification,
  _logger: PipelineLogger,
): void {
  // Sedentary check for work scenes
  if (scene.type === 'work') {
    checkSedentary(scene);
  }

  // Cook timer detection for meal scenes
  if (scene.type === 'meal_prep' && scene.food?.method) {
    checkCookTimer(scene);
  }

  // Ask about ambiguous food items
  if (
    (scene.type === 'meal_prep' || scene.type === 'eating') &&
    classification.items.length > 0
  ) {
    checkAmbiguousItems(classification);
  }
}

function checkSedentary(scene: Scene): void {
  try {
    const { getDb } = require('../../database');
    const db = getDb();
    const profile = db.getFirstSync(
      'SELECT work_interval_mins FROM nutrition_profile WHERE id = 1',
    ) as any;

    const intervalMs = (profile?.work_interval_mins || 45) * 60 * 1000;
    const elapsed = Date.now() - scene.openedAt;

    if (elapsed >= intervalMs) {
      try {
        const { nudgeSedentary } = require('./nudgeComposer');
        nudgeSedentary(Math.round(elapsed / 60000));
      } catch { /* nudgeComposer not loaded */ }
    }
  } catch {}
}

function checkCookTimer(scene: Scene): void {
  if (scene.food?.cookFinishAt && Date.now() >= scene.food.cookFinishAt) {
    try {
      const { nudgeCookDone } = require('./nudgeComposer');
      nudgeCookDone(scene.food.method || 'cooking');
    } catch { /* nudgeComposer not loaded */ }
  }
}

/**
 * Check for ambiguous food items and ask the user for clarification.
 * Fires mittensAsk when an item's confidence is below 0.7.
 */
function checkAmbiguousItems(
  classification: SceneClassification,
): void {
  const ambiguous = classification.items.filter((i) => i.confidence < 0.7);
  if (ambiguous.length === 0) return;

  // Only ask about the first ambiguous item (don't spam)
  const item = ambiguous[0];
  const question = `Is that ${item.name}?`;

  // Fire and forget -- mittensAsk is async with timeout
  try {
    const { mittensAsk } = require('./mittensAsk');
    const { learnFromResponse } = require('./memoryUpsert');

    mittensAsk(question).then((answer: string | null) => {
      if (answer) {
        learnFromResponse(question, answer);
        console.log(`[SceneTriggers] Learned from ask: "${answer}"`);
      }
    }).catch(() => {});
  } catch { /* modules not loaded */ }
}
