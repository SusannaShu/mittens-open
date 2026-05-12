/**
 * ambient/sceneLogWriter.ts -- Writes scene results to nutrition/activity logs.
 *
 * Extracted from sceneStreamManager.ts to keep files under 400 lines.
 * Routes completed scenes to the appropriate database log table.
 */

import type { Scene } from './types';

/**
 * Route a closed scene to the appropriate log table.
 * Writes to nutrition_logs for food scenes, activity_logs for everything else.
 */
export function routeToLogPipeline(scene: Scene): void {
  try {
    if (scene.type === 'meal_prep' || scene.type === 'eating') {
      writeNutritionLog(scene);
    } else if (
      scene.type === 'work' ||
      scene.type === 'exercise' ||
      scene.type === 'social' ||
      scene.type === 'commute'
    ) {
      writeActivityLog(scene);
    }
  } catch (err: any) {
    console.error('[SceneLogWriter] Failed to route log:', err?.message || err);
  }
}

function writeNutritionLog(scene: Scene): void {
  const { getDb } = require('../../database');
  const db = getDb();

  const mealType = guessMealType(scene.openedAt);
  const items = scene.food?.ingredients || [];
  const logName = items.length > 0
    ? items.map((i) => i.name).join(', ')
    : `${mealType} (pendant)`;

  db.runSync(
    `INSERT INTO nutrition_logs (
      logged_at, meal_type, log_name, items,
      source, image_uris, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pendant', ?, datetime('now'), datetime('now'))`,
    [
      new Date(scene.openedAt).toISOString(),
      mealType,
      logName,
      JSON.stringify(items),
      scene.framePaths.length > 0
        ? JSON.stringify(scene.framePaths)
        : null,
    ],
  );
  console.log(`[SceneLogWriter] Wrote nutrition_log: ${logName}`);
}

function writeActivityLog(scene: Scene): void {
  const { getDb } = require('../../database');
  const db = getDb();

  const durationMin = scene.closedAt
    ? Math.round((scene.closedAt - scene.openedAt) / 60000)
    : 0;
  const logName = `${scene.type} (pendant)`;

  db.runSync(
    `INSERT INTO activity_logs (
      logged_at, log_name, activity_type, duration_min,
      source, location, image_uris, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pendant', ?, ?, datetime('now'), datetime('now'))`,
    [
      new Date(scene.openedAt).toISOString(),
      logName,
      scene.type,
      durationMin,
      scene.place || null,
      scene.framePaths.length > 0
        ? JSON.stringify(scene.framePaths)
        : null,
    ],
  );
  console.log(`[SceneLogWriter] Wrote activity_log: ${logName} (${durationMin}min)`);
}

function guessMealType(
  timestampMs: number,
): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const hour = new Date(timestampMs).getHours();
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 21) return 'dinner';
  return 'snack';
}
