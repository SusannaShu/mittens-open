/**
 * ambient/sceneLogWriter.ts -- Writes scene results to nutrition/activity logs.
 *
 * Implements Log-On-Detect:
 * 1. createLogOnDetect: Immediately creates a row in the DB (default 30m)
 * 2. updateLogIncremental: Updates the row as new AEIOU/frames arrive
 * 3. finalizeLog: Adjusts duration on close and runs heavy pipelines (nutrition)
 */

import type { Scene } from './types';

// ─── Phase 1: Open ──────────────────────────────────────

export function createLogOnDetect(scene: Scene): number | null {
  try {
    const { getDb } = require('../../database');
    const db = getDb();
    const logName = `${scene.type} (pendant)`;
    const nowStr = new Date(scene.openedAt).toISOString();

    if (scene.type === 'meal_prep' || scene.type === 'eating') {
      const mealType = guessMealType(scene.openedAt);
      const result = db.runSync(
        `INSERT INTO nutrition_logs (
          logged_at, meal_type, log_name, items,
          source, created_at, updated_at
        ) VALUES (?, ?, ?, '[]', 'pendant', datetime('now'), datetime('now'))`,
        [nowStr, mealType, logName]
      );
      const id = (result as any).lastInsertRowId;
      console.log(`[SceneLogWriter] Created nutrition_log #${id}`);
      return id;
    } else {
      // Default initial duration: 30m
      const result = db.runSync(
        `INSERT INTO activity_logs (
          logged_at, log_name, activity_type, duration_min,
          source, location, created_at, updated_at
        ) VALUES (?, ?, ?, 30, 'pendant', ?, datetime('now'), datetime('now'))`,
        [nowStr, logName, scene.type, scene.place || null]
      );
      const id = (result as any).lastInsertRowId;
      console.log(`[SceneLogWriter] Created activity_log #${id}`);
      return id;
    }
  } catch (err: any) {
    console.error('[SceneLogWriter] Failed to create log:', err?.message);
    return null;
  }
}

// ─── Phase 2: Update ────────────────────────────────────

export function updateLogIncremental(logId: number, scene: Scene): void {
  try {
    const { getDb } = require('../../database');
    const db = getDb();
    
    const framePhotos = scene.framePaths.filter(Boolean);
    const timeline = (scene as any).aeiou_timeline || [];

    if (scene.type === 'meal_prep' || scene.type === 'eating') {
      db.runSync(
        `UPDATE nutrition_logs SET
          image_uris = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [
          framePhotos.length > 0 ? JSON.stringify(framePhotos) : null,
          logId
        ]
      );
    } else {
      db.runSync(
        `UPDATE activity_logs SET
          image_uris = ?, meta = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [
          framePhotos.length > 0 ? JSON.stringify(framePhotos) : null,
          timeline.length > 0 ? JSON.stringify({ aeiou_timeline: timeline }) : null,
          logId
        ]
      );
    }
  } catch (err: any) {
    console.error(`[SceneLogWriter] Failed to update log #${logId}:`, err?.message);
  }
}

// ─── Phase 3: Finalize ──────────────────────────────────

export async function finalizeLog(scene: Scene): Promise<void> {
  if (!scene.logId) return;

  try {
    if (scene.type === 'meal_prep' || scene.type === 'eating') {
      await finalizeNutritionLog(scene.logId, scene);
    } else {
      await finalizeActivityLog(scene.logId, scene);
    }
  } catch (err: any) {
    console.error(`[SceneLogWriter] Failed to finalize log #${scene.logId}:`, err?.message);
  }
}

async function finalizeNutritionLog(logId: number, scene: Scene): Promise<void> {
  const { getDb } = require('../../database');
  const db = getDb();

  const rawItems = scene.food?.ingredients || [];
  const framePhotos = scene.framePaths.filter(Boolean);

  let identifiedFoods: any[] = [];
  let nutrientResults: any[] = [];

  if (framePhotos.length > 0) {
    try {
      const { identifyFoods } = require('../../pipelines/food/identify');
      const identifyResult = await identifyFoods(framePhotos);
      identifiedFoods = identifyResult.foods || [];
      console.log(`[SceneLogWriter] Identified ${identifiedFoods.length} foods`);

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
            } catch (e: any) { return null; }
          })
        );
        nutrientResults = nutrientResults.filter(Boolean);
      }
    } catch (err: any) {
      console.warn('[SceneLogWriter] Food pipeline failed:', err?.message);
    }
  }

  const finalItems = identifiedFoods.length > 0 ? identifiedFoods : rawItems;
  const mealType = guessMealType(scene.openedAt);
  const logName = finalItems.length > 0
    ? finalItems.map((i: any) => i.name || i.n).join(', ')
    : `${mealType} (pendant)`;
  const totalNutrients = aggregateNutrients(nutrientResults);

  db.runSync(
    `UPDATE nutrition_logs SET
      log_name = ?, items = ?, nutrients = ?, image_uris = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      logName,
      JSON.stringify(finalItems),
      nutrientResults.length > 0 ? JSON.stringify(totalNutrients) : null,
      framePhotos.length > 0 ? JSON.stringify(framePhotos) : null,
      logId
    ]
  );
  console.log(`[SceneLogWriter] Finalized nutrition_log #${logId}`);
}

async function finalizeActivityLog(logId: number, scene: Scene): Promise<void> {
  const { getDb } = require('../../database');
  const db = getDb();

  const durationMin = scene.closedAt
    ? Math.max(1, Math.round((scene.closedAt - scene.openedAt) / 60000))
    : 30;

  let metValue: number | null = null;
  let blendedLifeCat: Record<string, number> = {};
  
  try {
    const { ActivityTypeService } = require('../activityTypeService');
    
    // 1. Get MET for primary scene type
    const typeDef = await ActivityTypeService.getByKey(scene.type);
    if (typeDef?.defaultMets) {
      metValue = typeDef.defaultMets;
    }

    // 2. Blend life categories based on frame counts per sceneType
    if (scene.sceneTypeCounts) {
      let totalFrames = 0;
      for (const [typeKey, count] of Object.entries(scene.sceneTypeCounts)) {
        totalFrames += count as number;
        const tDef = await ActivityTypeService.getByKey(typeKey);
        if (tDef?.defaultLifeCategories) {
          for (const [cat, weight] of Object.entries(tDef.defaultLifeCategories)) {
            blendedLifeCat[cat] = (blendedLifeCat[cat] || 0) + ((weight as number) * (count as number));
          }
        }
      }
      
      // Normalize to sum to 1.0
      if (totalFrames > 0) {
        let totalWeight = 0;
        for (const cat in blendedLifeCat) {
          blendedLifeCat[cat] = blendedLifeCat[cat] / totalFrames;
          totalWeight += blendedLifeCat[cat];
        }
        if (totalWeight > 0) {
          for (const cat in blendedLifeCat) {
            blendedLifeCat[cat] = parseFloat((blendedLifeCat[cat] / totalWeight).toFixed(2));
          }
        }
      }
    }
  } catch {
    metValue = FALLBACK_METS[scene.type] ?? null;
  }

  const timeline = (scene as any).aeiou_timeline || [];

  db.runSync(
    `UPDATE activity_logs SET
      duration_min = ?, mets = ?, image_uris = ?, meta = ?, life_categories = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      durationMin,
      metValue,
      scene.framePaths.length > 0 ? JSON.stringify(scene.framePaths.filter(Boolean)) : null,
      timeline.length > 0 ? JSON.stringify({ aeiou_timeline: timeline }) : null,
      Object.keys(blendedLifeCat).length > 0 ? JSON.stringify(blendedLifeCat) : null,
      logId
    ]
  );
  console.log(`[SceneLogWriter] Finalized activity_log #${logId} (${durationMin}m, ${metValue} MET)`);
}

// ─── Helpers ────────────────────────────────────────────

const FALLBACK_METS: Record<string, number> = {
  work: 1.3,
  exercise: 5.0,
  social: 1.5,
  commute: 1.3,
  rest: 1.0,
  cooking: 2.0,
  errands: 2.5,
};

function guessMealType(timestampMs: number): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const hour = new Date(timestampMs).getHours();
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 21) return 'dinner';
  return 'snack';
}

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
