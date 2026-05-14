/**
 * ambient/sceneLogWriter.ts -- Per-capture log creation and updates.
 *
 * Creates or updates nutrition_logs and activity_logs based on triage decisions.
 * Handles dedup (update existing log vs create new), food pipeline dispatch
 * (identify + nutrients), auto-MET from activity type, and life design weights.
 *
 * Called per-frame by sceneStreamManager, NOT deferred to scene close.
 */

import type { Scene, SceneClassification } from './types';
import type { TriageDecision } from './ambientTriage';
import type { PipelineLogger } from '../../pipelines/logger';
import { runAEIOUPhases, guessMealType, aggregateNutrients, mergeItems } from './logWriterHelpers';

// ─── MET Lookup Table ────

const MET_TABLE: Record<string, number> = {
  // Exercise sub-types
  yoga: 2.5, dance: 4.0, walk: 3.5, hike: 6.0, bike: 7.5,
  run: 8.0, gym: 5.0, swim: 7.0, climb: 8.0,
  // Scene types
  work: 1.3, social: 1.5, commute: 1.3, rest: 1.0,
  exercise: 5.0, meal_prep: 2.0, eating: 1.3, errands: 2.5,
};

// ─── Main Dispatch ────

/**
 * Execute the triage decision: create or update the appropriate log.
 */
export async function executeLogDecision(
  decision: TriageDecision,
  classification: SceneClassification,
  framePath: string,
  scene: Scene | null,
  logger: PipelineLogger,
): Promise<{ logId: number | null }> {
  if (decision.action === 'skip') {
    return { logId: null };
  }

  if (decision.pipeline === 'food') {
    if (decision.action === 'create') {
      return createMealLog(classification, framePath, scene, decision.phases, logger);
    }
    return updateMealLog(decision.existingLogId!, classification, framePath, scene, decision.phases, logger);
  }

  if (decision.pipeline === 'activity') {
    if (decision.action === 'create') {
      return createActivityLog(classification, framePath, scene, decision.phases, logger);
    }
    return updateActivityLog(decision.existingLogId!, classification, framePath, scene, decision.phases, logger);
  }

  return { logId: null };
}

// ─── Meal Log: Create ────

async function createMealLog(
  classification: SceneClassification,
  framePath: string,
  scene: Scene | null,
  phases: string[],
  logger: PipelineLogger,
): Promise<{ logId: number | null }> {
  const { getDb } = require('../../database');
  const db = getDb();

  const mealType = guessMealType(Date.now());
  let identifiedFoods: any[] = [];
  let nutrientTotals: Record<string, number> = {};
  let eatingCtx: any = null;

  // Phase: identify foods
  if (phases.includes('identify') && framePath) {
    const idx = logger.startPhase('food', 'identify');
    try {
      const { identifyFoods } = require('../../pipelines/food/identify');
      const result = await identifyFoods([framePath]);
      identifiedFoods = result.foods || [];
      logger.completePhase(idx, `${identifiedFoods.length} foods: ${identifiedFoods.map((f: any) => f.name).join(', ')}`);
      logger.logPhaseIO?.(idx, `vision([${framePath}])`, JSON.stringify(result).slice(0, 200));
    } catch (err: any) {
      logger.failPhase(idx, err?.message);
    }
  }

  // Phase: nutrients
  if (phases.includes('nutrients') && identifiedFoods.length > 0) {
    const idx = logger.startPhase('food', 'nutrients');
    try {
      const { estimateNutrients } = require('../../pipelines/food/nutrients');
      const results = await Promise.all(
        identifiedFoods.map(async (food: any) => {
          try {
            return await estimateNutrients({
              name: food.name,
              portion_g: food.portion_g || 100,
              cooking: food.cooking || '',
            });
          } catch { return null; }
        }),
      );
      nutrientTotals = aggregateNutrients(results.filter(Boolean));
      logger.completePhase(idx, `${results.filter(Boolean).length} items analyzed`);
    } catch (err: any) {
      logger.failPhase(idx, err?.message);
    }
  }

  // Phase: eating context (only when detected)
  if (phases.includes('eatingContext') && framePath) {
    const idx = logger.startPhase('food', 'eatingContext');
    try {
      const { inferEatingContext } = require('../../pipelines/food/eatingContext');
      eatingCtx = await inferEatingContext({ photos: [framePath] });
      logger.completePhase(idx, `pace: ${eatingCtx.pace}, social: ${eatingCtx.social}`);
    } catch (err: any) {
      logger.failPhase(idx, err?.message);
    }
  }

  // Phase: pantryDelta
  if (phases.includes('pantryDelta') && framePath && scene) {
    const idx = logger.startPhase('food', 'pantryDelta');
    try {
      const { extractPantryDeltas } = require('../../pipelines/food/pantryDelta');
      const result = await extractPantryDeltas({ photos: [framePath] });
      const deltas = result.deltas || [];
      deltas.forEach((d: any) => {
        d.framePath = framePath;
        scene.pantryDeltas.push(d);
      });
      logger.completePhase(idx, `Extracted ${deltas.length} pantry deltas`);
    } catch (err: any) {
      logger.failPhase(idx, err?.message);
    }
  }

  // Use identified foods or fall back to classifier items
  const finalItems = identifiedFoods.length > 0 ? identifiedFoods : classification.items;
  const logName = finalItems.length > 0
    ? finalItems.map((i: any) => i.name || i.n).join(', ')
    : `${mealType} (pendant)`;

  const result = db.runSync(
    `INSERT INTO nutrition_logs (
      logged_at, meal_type, log_name, items, nutrients,
      eating_context, source, image_uris,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pendant', ?, datetime('now'), datetime('now'))`,
    [
      new Date().toISOString(),
      mealType, logName,
      JSON.stringify(finalItems),
      Object.keys(nutrientTotals).length > 0 ? JSON.stringify(nutrientTotals) : null,
      eatingCtx ? JSON.stringify(eatingCtx) : null,
      JSON.stringify([framePath]),
    ],
  );

  const logId = result?.lastInsertRowId ?? null;
  console.log(`[LogWriter] Created meal log #${logId}: ${logName}`);
  return { logId };
}

// ─── Meal Log: Update ────

async function updateMealLog(
  logId: number,
  classification: SceneClassification,
  framePath: string,
  scene: Scene | null,
  phases: string[],
  logger: PipelineLogger,
): Promise<{ logId: number | null }> {
  const { getDb } = require('../../database');
  const db = getDb();

  // Always update end time and append frame
  const existing = db.getFirstSync(
    'SELECT items, image_uris, nutrients FROM nutrition_logs WHERE id = ?',
    [logId],
  ) as any;

  // Append frame to image list
  const existingImages = existing?.image_uris ? JSON.parse(existing.image_uris) : [];
  existingImages.push(framePath);

  let updatedItems = existing?.items ? JSON.parse(existing.items) : [];
  let updatedNutrients = existing?.nutrients ? JSON.parse(existing.nutrients) : {};

  // Re-run identify if new items detected
  if (phases.includes('identify') && framePath) {
    const idx = logger.startPhase('food', 'identify');
    try {
      const { identifyFoods } = require('../../pipelines/food/identify');
      const result = await identifyFoods([framePath]);
      const newFoods = result.foods || [];
      updatedItems = mergeItems(updatedItems, newFoods);
      logger.completePhase(idx, `Merged: ${newFoods.length} new -> ${updatedItems.length} total`);
    } catch (err: any) {
      logger.failPhase(idx, err?.message);
    }
  }

  // Re-run nutrients if items changed
  if (phases.includes('nutrients') && updatedItems.length > 0) {
    const idx = logger.startPhase('food', 'nutrients');
    try {
      const { estimateNutrients } = require('../../pipelines/food/nutrients');
      const results = await Promise.all(
        updatedItems.map(async (food: any) => {
          try {
            return await estimateNutrients({
              name: food.name,
              portion_g: food.portion_g || 100,
              cooking: food.cooking || '',
            });
          } catch { return null; }
        }),
      );
      updatedNutrients = aggregateNutrients(results.filter(Boolean));
      logger.completePhase(idx, `Re-analyzed ${results.filter(Boolean).length} items`);
    } catch (err: any) {
      logger.failPhase(idx, err?.message);
    }
  }

  // Phase: pantryDelta
  if (phases.includes('pantryDelta') && framePath && scene) {
    const idx = logger.startPhase('food', 'pantryDelta');
    try {
      const { extractPantryDeltas } = require('../../pipelines/food/pantryDelta');
      const result = await extractPantryDeltas({ photos: [framePath] });
      const deltas = result.deltas || [];
      deltas.forEach((d: any) => {
        d.framePath = framePath;
        scene.pantryDeltas.push(d);
      });
      logger.completePhase(idx, `Extracted ${deltas.length} pantry deltas`);
    } catch (err: any) {
      logger.failPhase(idx, err?.message);
    }
  }

  const logName = updatedItems.length > 0
    ? updatedItems.map((i: any) => i.name || i.n).join(', ')
    : undefined;

  db.runSync(
    `UPDATE nutrition_logs SET
      items = ?, nutrients = ?, image_uris = ?,
      ${logName ? 'log_name = ?,' : ''} updated_at = datetime('now')
    WHERE id = ?`,
    [
      JSON.stringify(updatedItems),
      Object.keys(updatedNutrients).length > 0 ? JSON.stringify(updatedNutrients) : null,
      JSON.stringify(existingImages),
      ...(logName ? [logName] : []),
      logId,
    ],
  );

  console.log(`[LogWriter] Updated meal log #${logId}`);
  return { logId };
}

// ─── Activity Log: Create ────

async function createActivityLog(
  classification: SceneClassification,
  framePath: string,
  scene: Scene | null,
  phases: string[],
  logger: PipelineLogger,
): Promise<{ logId: number | null }> {
  const { getDb } = require('../../database');
  const db = getDb();

  const logName = `${classification.sceneType} (pendant)`;
  let metValue = MET_TABLE[classification.sceneType] ?? 1.3;
  let lifeDesignWeights: Record<string, number> | null = null;
  let aeiou: Record<string, string> = {};

  // Phase: detect (MET from activity type)
  if (phases.includes('detect')) {
    const idx = logger.startPhase('activity', 'detect');
    try {
      const { ActivityTypeService } = require('../activityTypeService');
      const typeDef = await ActivityTypeService.getByKey(classification.sceneType);
      if (typeDef?.defaultMets) metValue = typeDef.defaultMets;
      logger.completePhase(idx, `${classification.sceneType}: ${metValue} MET`);
    } catch (err: any) {
      logger.completePhase(idx, `Fallback MET: ${metValue}`);
    }
  }

  // Phase: lifeDesign
  if (phases.includes('lifeDesign')) {
    const idx = logger.startPhase('activity', 'lifeDesign');
    try {
      const { inferLifeDesign } = require('../../pipelines/activity/lifeDesign');
      const result = await inferLifeDesign(
        { photos: framePath ? [framePath] : [] },
        { activityType: classification.sceneType, logName },
      );
      lifeDesignWeights = result.lifeCategories;
      if (result.aeiou?.users) aeiou.users = result.aeiou.users;
      logger.completePhase(idx,
        `W:${result.lifeCategories?.work ?? '?'} H:${result.lifeCategories?.health ?? '?'} P:${result.lifeCategories?.play ?? '?'} L:${result.lifeCategories?.love ?? '?'}`);
    } catch (err: any) {
      logger.failPhase(idx, err?.message);
    }
  }

  // AEIOU phases: only run when detected
  await runAEIOUPhases(phases, framePath, classification, aeiou, logger);

  // Phase: pantryDelta (for grocery_shopping)
  if (phases.includes('pantryDelta') && framePath && scene) {
    const idx = logger.startPhase('activity', 'pantryDelta');
    try {
      const { extractPantryDeltas } = require('../../pipelines/food/pantryDelta');
      const result = await extractPantryDeltas({ photos: [framePath] });
      const deltas = result.deltas || [];
      deltas.forEach((d: any) => {
        d.framePath = framePath;
        scene.pantryDeltas.push(d);
      });
      logger.completePhase(idx, `Extracted ${deltas.length} pantry deltas`);
    } catch (err: any) {
      logger.failPhase(idx, err?.message);
    }
  }

  // People from Face Recognition pipeline
  let meta: any = {};
  if (scene?.detectedPeopleDetails && scene.detectedPeopleDetails.length > 0) {
    meta.detectedPeopleDetails = scene.detectedPeopleDetails;
    aeiou.users = Array.from(new Set(scene.detectedPeopleDetails.map(p => p.name))).join(', ');
  }

  const result = db.runSync(
    `INSERT INTO activity_logs (
      logged_at, log_name, activity_type, duration_min, mets,
      life_categories, aeiou, meta, source, location, image_uris,
      created_at, updated_at
    ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'pendant', ?, ?, datetime('now'), datetime('now'))`,
    [
      new Date().toISOString(),
      logName,
      classification.sceneType,
      metValue,
      lifeDesignWeights ? JSON.stringify(lifeDesignWeights) : null,
      Object.keys(aeiou).length > 0 ? JSON.stringify(aeiou) : null,
      Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
      scene?.place || null,
      framePath ? JSON.stringify([framePath]) : null,
    ],
  );

  const logId = result?.lastInsertRowId ?? null;
  console.log(`[LogWriter] Created activity log #${logId}: ${logName} (${metValue} MET)`);
  return { logId };
}

// ─── Activity Log: Update ────

async function updateActivityLog(
  logId: number,
  classification: SceneClassification,
  framePath: string,
  scene: Scene | null,
  phases: string[],
  logger: PipelineLogger,
): Promise<{ logId: number | null }> {
  const { getDb } = require('../../database');
  const db = getDb();

  const existing = db.getFirstSync(
    'SELECT logged_at, image_uris, aeiou, life_categories, meta FROM activity_logs WHERE id = ?',
    [logId],
  ) as any;

  // Update duration based on elapsed time
  const loggedAt = new Date(existing?.logged_at || Date.now());
  const durationMin = Math.round((Date.now() - loggedAt.getTime()) / 60000);

  // Append frame
  const existingImages = existing?.image_uris ? JSON.parse(existing.image_uris) : [];
  existingImages.push(framePath);

  // Merge AEIOU from new phase evidence
  let aeiou = existing?.aeiou ? JSON.parse(existing.aeiou) : {};
  await runAEIOUPhases(phases, framePath, classification, aeiou, logger);

  // Phase: pantryDelta (for grocery_shopping)
  if (phases.includes('pantryDelta') && framePath && scene) {
    const idx = logger.startPhase('activity', 'pantryDelta');
    try {
      const { extractPantryDeltas } = require('../../pipelines/food/pantryDelta');
      const result = await extractPantryDeltas({ photos: [framePath] });
      const deltas = result.deltas || [];
      deltas.forEach((d: any) => {
        d.framePath = framePath;
        scene.pantryDeltas.push(d);
      });
      logger.completePhase(idx, `Extracted ${deltas.length} pantry deltas`);
    } catch (err: any) {
      logger.failPhase(idx, err?.message);
    }
  }

  // Weighted average life design (keep running average)
  let lifeCategories = existing?.life_categories ? JSON.parse(existing.life_categories) : null;
  if (phases.includes('lifeDesign') && lifeCategories) {
    const idx = logger.startPhase('activity', 'lifeDesign');
    try {
      const { inferLifeDesign } = require('../../pipelines/activity/lifeDesign');
      const result = await inferLifeDesign(
        { photos: framePath ? [framePath] : [] },
        { activityType: classification.sceneType },
      );
      if (result.lifeCategories) {
        // Weighted average: (existing * frameCount + new) / (frameCount + 1)
        const frameN = existingImages.length;
        for (const k of Object.keys(result.lifeCategories)) {
          const prev = lifeCategories[k] ?? 0;
          lifeCategories[k] = Math.round(((prev * (frameN - 1) + result.lifeCategories[k]) / frameN) * 100) / 100;
        }
      }
      logger.completePhase(idx, `Weighted avg over ${existingImages.length} frames`);
    } catch (err: any) {
      logger.failPhase(idx, err?.message);
    }
  }

  // People from Face Recognition pipeline
  let meta = existing?.meta ? JSON.parse(existing.meta) : {};
  if (scene?.detectedPeopleDetails && scene.detectedPeopleDetails.length > 0) {
    meta.detectedPeopleDetails = scene.detectedPeopleDetails;
    aeiou.users = Array.from(new Set(scene.detectedPeopleDetails.map(p => p.name))).join(', ');
  }

  db.runSync(
    `UPDATE activity_logs SET
      duration_min = ?, image_uris = ?, aeiou = ?,
      life_categories = ?, meta = ?, updated_at = datetime('now')
    WHERE id = ?`,
    [
      durationMin,
      JSON.stringify(existingImages),
      Object.keys(aeiou).length > 0 ? JSON.stringify(aeiou) : null,
      lifeCategories ? JSON.stringify(lifeCategories) : null,
      Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
      logId,
    ],
  );

  console.log(`[LogWriter] Updated activity log #${logId} (${durationMin}min, ${existingImages.length} frames)`);
  return { logId };
}

