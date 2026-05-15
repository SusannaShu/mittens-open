/**
 * ambient/sceneLogWriter.ts -- Log creation from dual classifier output.
 *
 * Creates nutrition_logs and/or activity_logs based on the FrameClassification.
 * A single frame can produce BOTH a nutrition log AND an activity log.
 * Handles dedup (update existing log within window vs create new).
 */

import type { FrameClassification } from './types';
import type { PipelineLogger } from '../../pipelines/logger';
import { guessMealType, aggregateNutrients, mergeItems } from './logWriterHelpers';

// --- MET Lookup (approximate, for free-form activity types) ---

const MET_TABLE: Record<string, number> = {
  working: 1.3, resting: 1.0, reading: 1.3,
  cooking: 2.0, cleaning: 2.5, errands: 2.5,
  walking: 3.5, hiking: 6.0, cycling: 7.5,
  running: 8.0, gym: 5.0, swimming: 7.0,
  yoga: 2.5, dancing: 4.0, climbing: 8.0,
  socializing: 1.5, commuting: 1.3, driving: 1.3,
};

/** Dedup window: prefer updating an existing log within this window */
const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

// --- Main Dispatch ---

interface LogResult {
  nutritionLogId: number | null;
  activityLogId: number | null;
}

/**
 * Create or update logs based on dual classifier output.
 * Both nutrition and activity can fire for the same frame.
 */
export async function executeLogDecision(
  classification: FrameClassification,
  framePath: string,
  logger: PipelineLogger,
): Promise<LogResult> {
  let nutritionLogId: number | null = null;
  let activityLogId: number | null = null;

  // Nutrition pipeline
  if (classification.nutrition.detected) {
    nutritionLogId = await handleNutrition(classification, framePath, logger);
  }

  // Activity pipeline
  if (classification.activity.detected) {
    activityLogId = await handleActivity(classification, framePath, logger);
  }

  return { nutritionLogId, activityLogId };
}

// --- Nutrition Pipeline ---

async function handleNutrition(
  classification: FrameClassification,
  framePath: string,
  logger: PipelineLogger,
): Promise<number | null> {
  const { getDb } = require('../../database');
  const db = getDb();

  // Check for recent nutrition log to update
  const recentLog = findRecentLog(db, 'nutrition_logs');

  if (recentLog) {
    return updateNutritionLog(recentLog.id, classification, framePath, db, logger);
  }
  return createNutritionLog(classification, framePath, db, logger);
}

async function createNutritionLog(
  classification: FrameClassification,
  framePath: string,
  db: any,
  logger: PipelineLogger,
): Promise<number | null> {
  const mealType = guessMealType(Date.now());
  let identifiedFoods: any[] = [];
  let nutrientTotals: Record<string, number> = {};

  // Phase: identify foods via vision
  if (classification.nutrition.items.length > 0 && framePath) {
    const idx = logger.startPhase('food', 'identify');
    try {
      const { identifyFoods } = require('../../pipelines/food/identify');
      const result = await identifyFoods([framePath]);
      identifiedFoods = result.foods || [];
      logger.completePhase(idx, `${identifiedFoods.length} foods: ${identifiedFoods.map((f: any) => f.name).join(', ')}`);
    } catch (err: any) {
      logger.failPhase(idx, err?.message);
    }
  }

  // Phase: nutrients
  if (identifiedFoods.length > 0) {
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

  // Phase: pantry delta (if at home)
  await runPantryDelta(framePath, logger);

  // Use identified foods or fall back to classifier items
  const finalItems = identifiedFoods.length > 0 ? identifiedFoods : classification.nutrition.items;
  const logName = finalItems.length > 0
    ? finalItems.map((i: any) => i.name || i.n).join(', ')
    : `${mealType} (pendant)`;

  const result = db.runSync(
    `INSERT INTO nutrition_logs (
      logged_at, meal_type, log_name, items, nutrients,
      source, image_uris, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pendant', ?, datetime('now'), datetime('now'))`,
    [
      new Date().toISOString(),
      mealType, logName,
      JSON.stringify(finalItems),
      Object.keys(nutrientTotals).length > 0 ? JSON.stringify(nutrientTotals) : null,
      JSON.stringify([framePath]),
    ],
  );

  const logId = result?.lastInsertRowId ?? null;
  console.log(`[LogWriter] Created nutrition log #${logId}: ${logName}`);
  return logId;
}

async function updateNutritionLog(
  logId: number,
  classification: FrameClassification,
  framePath: string,
  db: any,
  logger: PipelineLogger,
): Promise<number | null> {
  const existing = db.getFirstSync(
    'SELECT items, image_uris, nutrients FROM nutrition_logs WHERE id = ?',
    [logId],
  ) as any;

  // Append frame
  const existingImages = existing?.image_uris ? JSON.parse(existing.image_uris) : [];
  existingImages.push(framePath);

  let updatedItems = existing?.items ? JSON.parse(existing.items) : [];
  let updatedNutrients = existing?.nutrients ? JSON.parse(existing.nutrients) : {};

  // Re-run identify if new items detected
  if (classification.nutrition.items.length > 0 && framePath) {
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
  if (updatedItems.length > 0) {
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

  await runPantryDelta(framePath, logger);

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

  console.log(`[LogWriter] Updated nutrition log #${logId}`);
  return logId;
}

// --- Activity Pipeline ---

async function handleActivity(
  classification: FrameClassification,
  framePath: string,
  logger: PipelineLogger,
): Promise<number | null> {
  const { getDb } = require('../../database');
  const db = getDb();

  // Check for active trail (movement session with linked activity log)
  let trailLogId: number | null = null;
  try {
    const { getActiveTrailLogId } = require('./trailActivityBridge');
    trailLogId = getActiveTrailLogId();
  } catch { /* trailActivityBridge not loaded */ }

  // If trail is active, update it instead of creating a new log
  if (trailLogId != null) {
    return updateActivityLog(trailLogId, classification, framePath, db, logger);
  }

  // Check for recent activity log to update
  const recentLog = findRecentLog(db, 'activity_logs');
  if (recentLog) {
    return updateActivityLog(recentLog.id, classification, framePath, db, logger);
  }
  return createActivityLog(classification, framePath, db, logger);
}

async function createActivityLog(
  classification: FrameClassification,
  framePath: string,
  db: any,
  logger: PipelineLogger,
): Promise<number | null> {
  const actType = classification.activity.type || 'unknown';
  const logName = `${actType} (pendant)`;
  const metValue = lookupMET(actType);
  let lifeDesignWeights: Record<string, number> | null = null;

  // Phase: lifeDesign
  const ldIdx = logger.startPhase('activity', 'lifeDesign');
  try {
    const { inferLifeDesign } = require('../../pipelines/activity/lifeDesign');
    const result = await inferLifeDesign(
      { photos: framePath ? [framePath] : [] },
      { activityType: actType, logName },
    );
    lifeDesignWeights = result.lifeCategories;
    logger.completePhase(ldIdx,
      `W:${result.lifeCategories?.work ?? '?'} H:${result.lifeCategories?.health ?? '?'} P:${result.lifeCategories?.play ?? '?'} L:${result.lifeCategories?.love ?? '?'}`);
  } catch (err: any) {
    logger.failPhase(ldIdx, err?.message);
  }

  // Resolve place name
  let placeName: string | null = null;
  try {
    const { getCurrentPlace } = require('../location/locationService');
    placeName = getCurrentPlace() || null;
  } catch { /* location not available */ }

  const result = db.runSync(
    `INSERT INTO activity_logs (
      logged_at, log_name, activity_type, duration_min, mets,
      life_categories, source, location, image_uris,
      created_at, updated_at
    ) VALUES (?, ?, ?, 0, ?, ?, 'pendant', ?, ?, datetime('now'), datetime('now'))`,
    [
      new Date().toISOString(),
      logName, actType, metValue,
      lifeDesignWeights ? JSON.stringify(lifeDesignWeights) : null,
      placeName,
      framePath ? JSON.stringify([framePath]) : null,
    ],
  );

  const logId = result?.lastInsertRowId ?? null;
  console.log(`[LogWriter] Created activity log #${logId}: ${logName} (${metValue} MET)`);
  return logId;
}

async function updateActivityLog(
  logId: number,
  classification: FrameClassification,
  framePath: string,
  db: any,
  logger: PipelineLogger,
): Promise<number | null> {
  const existing = db.getFirstSync(
    'SELECT logged_at, image_uris, life_categories FROM activity_logs WHERE id = ?',
    [logId],
  ) as any;

  // Update duration based on elapsed time
  const loggedAt = new Date(existing?.logged_at || Date.now());
  const durationMin = Math.round((Date.now() - loggedAt.getTime()) / 60000);

  // Append frame
  const existingImages = existing?.image_uris ? JSON.parse(existing.image_uris) : [];
  existingImages.push(framePath);

  // Weighted average life design
  let lifeCategories = existing?.life_categories ? JSON.parse(existing.life_categories) : null;
  if (lifeCategories) {
    const ldIdx = logger.startPhase('activity', 'lifeDesign');
    try {
      const { inferLifeDesign } = require('../../pipelines/activity/lifeDesign');
      const result = await inferLifeDesign(
        { photos: framePath ? [framePath] : [] },
        { activityType: classification.activity.type || 'unknown' },
      );
      if (result.lifeCategories) {
        const frameN = existingImages.length;
        for (const k of Object.keys(result.lifeCategories)) {
          const prev = lifeCategories[k] ?? 0;
          lifeCategories[k] = Math.round(((prev * (frameN - 1) + result.lifeCategories[k]) / frameN) * 100) / 100;
        }
      }
      logger.completePhase(ldIdx, `Weighted avg over ${existingImages.length} frames`);
    } catch (err: any) {
      logger.failPhase(ldIdx, err?.message);
    }
  }

  db.runSync(
    `UPDATE activity_logs SET
      duration_min = ?, image_uris = ?,
      life_categories = ?, updated_at = datetime('now')
    WHERE id = ?`,
    [
      durationMin,
      JSON.stringify(existingImages),
      lifeCategories ? JSON.stringify(lifeCategories) : null,
      logId,
    ],
  );

  console.log(`[LogWriter] Updated activity log #${logId} (${durationMin}min, ${existingImages.length} frames)`);
  return logId;
}

// --- Helpers ---

function lookupMET(activityType: string): number {
  const key = activityType.toLowerCase().trim();
  return MET_TABLE[key] ?? 1.3;
}

async function runPantryDelta(framePath: string, logger: PipelineLogger): Promise<void> {
  if (!framePath) return;
  const idx = logger.startPhase('food', 'pantryDelta');
  try {
    const { extractPantryDeltas } = require('../../pipelines/food/pantryDelta');
    const result = await extractPantryDeltas({ photos: [framePath] });
    const deltas = result.deltas || [];
    if (deltas.length > 0) {
      const { applyPantryDeltas } = require('./smartPantry');
      applyPantryDeltas(deltas.map((d: any) => ({ ...d, framePath })));
    }
    logger.completePhase(idx, `${deltas.length} pantry deltas`);
  } catch (err: any) {
    logger.failPhase(idx, err?.message);
  }
}

interface RecentLogRow { id: number; logged_at: string; }

function findRecentLog(db: any, table: 'nutrition_logs' | 'activity_logs'): RecentLogRow | null {
  try {
    const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const row = db.getFirstSync(
      `SELECT id, logged_at FROM ${table}
       WHERE source IN ('pendant', 'trail') AND logged_at >= ?
       ORDER BY logged_at DESC LIMIT 1`,
      [cutoff],
    ) as RecentLogRow | null;
    return row;
  } catch {
    return null;
  }
}
