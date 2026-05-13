/**
 * ambient/sceneLogWriter.ts -- Writes scene results to nutrition/activity logs.
 *
 * Routes completed scenes to the appropriate database log table.
 * For food scenes: runs the full food pipeline (identify -> nutrients -> store).
 * For activity scenes: auto-assigns MET from ActivityTypeService.
 */

import type { Scene } from './types';

/**
 * Route a closed scene to the appropriate log table.
 * Writes to nutrition_logs for food scenes, activity_logs for everything else.
 */
export async function routeToLogPipeline(scene: Scene): Promise<void> {
  try {
    if (scene.type === 'meal_prep' || scene.type === 'eating') {
      await writeNutritionLog(scene);
    } else if (
      scene.type === 'work' ||
      scene.type === 'exercise' ||
      scene.type === 'social' ||
      scene.type === 'commute'
    ) {
      await writeActivityLog(scene);
    }
  } catch (err: any) {
    console.error('[SceneLogWriter] Failed to route log:', err?.message || err);
  }
}

// ─── Food Scene: Identify + Nutrients + Store ────

async function writeNutritionLog(scene: Scene): Promise<void> {
  const { getDb } = require('../../database');
  const db = getDb();

  const mealType = guessMealType(scene.openedAt);
  const rawItems = scene.food?.ingredients || [];
  const framePhotos = scene.framePaths.filter(Boolean);

  // Run food identification pipeline on the captured frames
  let identifiedFoods: any[] = [];
  let nutrientResults: any[] = [];

  if (framePhotos.length > 0) {
    try {
      const { identifyFoods } = require('../../pipelines/food/identify');
      const identifyResult = await identifyFoods(framePhotos);
      identifiedFoods = identifyResult.foods || [];
      console.log(
        `[SceneLogWriter] Identified ${identifiedFoods.length} foods from ${framePhotos.length} frames`,
      );

      // Run nutrient estimation for each identified food
      if (identifiedFoods.length > 0) {
        const { estimateNutrients } = require('../../pipelines/food/nutrients');
        nutrientResults = await Promise.all(
          identifiedFoods.map(async (food: any) => {
            try {
              const result = await estimateNutrients({
                name: food.name,
                portion_g: food.portion_g || food.amount_g || 100,
                cooking: food.cooking || food.preparation || '',
              });
              return { food: food.name, ...result };
            } catch (err: any) {
              console.warn(
                `[SceneLogWriter] Nutrient estimation failed for ${food.name}:`,
                err?.message,
              );
              return null;
            }
          }),
        );
        nutrientResults = nutrientResults.filter(Boolean);
      }
    } catch (err: any) {
      console.warn('[SceneLogWriter] Food pipeline failed, using raw items:', err?.message);
      // Fall back to raw classifier items
    }
  }

  // Use pipeline results if available, fall back to raw classifier items
  const finalItems = identifiedFoods.length > 0 ? identifiedFoods : rawItems;
  const logName = finalItems.length > 0
    ? finalItems.map((i: any) => i.name || i.n).join(', ')
    : `${mealType} (pendant)`;

  // Aggregate nutrient totals
  const totalNutrients = aggregateNutrients(nutrientResults);

  db.runSync(
    `INSERT INTO nutrition_logs (
      logged_at, meal_type, log_name, items,
      nutrients, source, image_uris, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pendant', ?, datetime('now'), datetime('now'))`,
    [
      new Date(scene.openedAt).toISOString(),
      mealType,
      logName,
      JSON.stringify(finalItems),
      nutrientResults.length > 0 ? JSON.stringify(totalNutrients) : null,
      framePhotos.length > 0 ? JSON.stringify(framePhotos) : null,
    ],
  );
  console.log(
    `[SceneLogWriter] Wrote nutrition_log: ${logName}` +
    (nutrientResults.length > 0 ? ` (${nutrientResults.length} items analyzed)` : ''),
  );
}

// ─── Activity Scene: Auto-MET + Store ────

async function writeActivityLog(scene: Scene): Promise<void> {
  const { getDb } = require('../../database');
  const db = getDb();

  const durationMin = scene.closedAt
    ? Math.round((scene.closedAt - scene.openedAt) / 60000)
    : 0;
  const logName = `${scene.type} (pendant)`;

  // Look up MET from activity type service
  let metValue: number | null = null;
  try {
    const { ActivityTypeService } = require('../activityTypeService');
    const typeDef = await ActivityTypeService.getByKey(scene.type);
    if (typeDef?.defaultMets) {
      metValue = typeDef.defaultMets;
    }
  } catch {
    // ActivityTypeService not available -- use fallback
    metValue = FALLBACK_METS[scene.type] ?? null;
  }

  db.runSync(
    `INSERT INTO activity_logs (
      logged_at, log_name, activity_type, duration_min, mets,
      source, location, image_uris, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pendant', ?, ?, datetime('now'), datetime('now'))`,
    [
      new Date(scene.openedAt).toISOString(),
      logName,
      scene.type,
      durationMin,
      metValue,
      scene.place || null,
      scene.framePaths.length > 0
        ? JSON.stringify(scene.framePaths)
        : null,
    ],
  );
  console.log(
    `[SceneLogWriter] Wrote activity_log: ${logName} (${durationMin}min, ${metValue ?? '?'} MET)`,
  );
}

// ─── Helpers ────

/** Fallback MET values when ActivityTypeService is unavailable */
const FALLBACK_METS: Record<string, number> = {
  work: 1.3,
  exercise: 5.0,
  social: 1.5,
  commute: 1.3,
  rest: 1.0,
  cooking: 2.0,
  errands: 2.5,
};

function guessMealType(
  timestampMs: number,
): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const hour = new Date(timestampMs).getHours();
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 21) return 'dinner';
  return 'snack';
}

/** Sum nutrient values across all analyzed foods */
function aggregateNutrients(results: any[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const r of results) {
    if (!r?.nutrients) continue;
    for (const [key, val] of Object.entries(r.nutrients)) {
      if (typeof val === 'number') {
        totals[key] = (totals[key] || 0) + val;
      }
    }
  }
  return totals;
}
