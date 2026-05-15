/**
 * ambient/sceneLogWriter.ts -- Log creation from dual classifier output.
 *
 * Creates nutrition_logs and/or activity_logs based on the FrameClassification.
 * A single frame can produce BOTH a nutrition log AND an activity log.
 *
 * Nutrition dedup is VLM-based: the brain sees the new frame + recent log
 * history and decides skip / add to existing / new log.
 *
 * Activity logic lives in activityLogWriter.ts.
 */

import type { FrameClassification } from './types';
import type { PipelineLogger } from '../../pipelines/logger';
import { guessMealType, aggregateNutrients, mergeItems } from './logWriterHelpers';
import { dedupNutrition } from './nutritionDedup';
import { handleActivity } from './activityLogWriter';

// --- Main Dispatch ---

export interface LogResult {
  nutritionLogId: number | null;
  activityLogId: number | null;
  /** Natural language summary of what the pipeline did */
  nutritionSummary: string | null;
  /** Identified food items for MealPipelineCard */
  pipelineFoods: any[] | null;
  /** Meal metadata for chat message persistence */
  logName: string | null;
  mealType: string | null;
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
  let nutritionSummary: string | null = null;
  let pipelineFoods: any[] | null = null;
  let logName: string | null = null;
  let mealType: string | null = null;

  // Nutrition pipeline (with VLM dedup)
  if (classification.nutrition.detected) {
    const result = await handleNutrition(classification, framePath, logger);
    nutritionLogId = result.logId;
    nutritionSummary = result.summary;
    pipelineFoods = result.pipelineFoods;
    logName = result.logName;
    mealType = result.mealType;
  }

  // Activity pipeline (delegated to activityLogWriter)
  if (classification.activity.detected) {
    activityLogId = await handleActivity(classification, framePath, logger);
  }

  return { nutritionLogId, activityLogId, nutritionSummary, pipelineFoods, logName, mealType };
}

// --- Nutrition Pipeline ---

interface NutritionResult {
  logId: number | null;
  summary: string;
  pipelineFoods: any[] | null;
  logName: string | null;
  mealType: string | null;
}

async function handleNutrition(
  classification: FrameClassification,
  framePath: string,
  logger: PipelineLogger,
): Promise<NutritionResult> {
  // Phase: VLM Dedup
  const dedupIdx = logger.startPhase('food', 'dedup');
  const dedupResult = await dedupNutrition(framePath, classification.nutrition.items);
  logger.completePhase(dedupIdx, `${dedupResult.action}: ${dedupResult.reason}`);

  if (dedupResult.action === 'skip') {
    return {
      logId: null,
      summary: `Skipped -- ${dedupResult.reason}`,
      pipelineFoods: null,
      logName: null,
      mealType: null,
    };
  }

  const { getDb } = require('../../database');
  const db = getDb();

  if (dedupResult.action === 'add' && dedupResult.targetLogId) {
    return updateNutritionLog(dedupResult.targetLogId, classification, framePath, db, logger);
  }

  return createNutritionLog(classification, framePath, db, logger);
}

// --- Create Nutrition Log ---

async function createNutritionLog(
  classification: FrameClassification,
  framePath: string,
  db: any,
  logger: PipelineLogger,
): Promise<NutritionResult> {
  const mealType = guessMealType(Date.now());
  const summaryParts: string[] = [];
  let identifiedFoods: any[] = [];
  let nutrientTotals: Record<string, number> = {};

  // Phase: identify foods via vision
  if (classification.nutrition.items.length > 0 && framePath) {
    const idx = logger.startPhase('food', 'identify');
    try {
      const { identifyFoods } = require('../../pipelines/food/identify');
      const result = await identifyFoods([framePath]);
      identifiedFoods = result.foods || [];
      const names = identifiedFoods.map((f: any) => f.name).join(', ');
      logger.completePhase(idx, `${identifiedFoods.length} foods: ${names}`);
      summaryParts.push(`Identified ${identifiedFoods.length} item${identifiedFoods.length !== 1 ? 's' : ''}: ${names}`);
    } catch (err: any) {
      logger.failPhase(idx, err?.message);
      summaryParts.push('Food identification failed');
    }
  }

  // Phase: nutrients
  if (identifiedFoods.length > 0) {
    const nutrResult = await runNutrientEstimation(identifiedFoods, logger);
    nutrientTotals = nutrResult.totals;
    if (nutrResult.calStr) summaryParts.push(nutrResult.calStr);
  }

  // Phase: pantry delta
  await runPantryDelta(framePath, logger);

  // Build log entry
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

  const summary = buildNutritionSummary('new', logName, mealType, summaryParts);
  const pipelineFoods = buildPipelineFoods(finalItems);

  return { logId, summary, pipelineFoods, logName, mealType };
}

// --- Update Nutrition Log ---

async function updateNutritionLog(
  logId: number,
  classification: FrameClassification,
  framePath: string,
  db: any,
  logger: PipelineLogger,
): Promise<NutritionResult> {
  const existing = db.getFirstSync(
    'SELECT items, image_uris, nutrients, meal_type, log_name FROM nutrition_logs WHERE id = ?',
    [logId],
  ) as any;

  const summaryParts: string[] = [];

  // Append frame
  const existingImages = existing?.image_uris ? JSON.parse(existing.image_uris) : [];
  existingImages.push(framePath);

  let updatedItems = existing?.items ? JSON.parse(existing.items) : [];
  let updatedNutrients = existing?.nutrients ? JSON.parse(existing.nutrients) : {};

  // Re-run identify to find new items
  if (classification.nutrition.items.length > 0 && framePath) {
    const idx = logger.startPhase('food', 'identify');
    try {
      const { identifyFoods } = require('../../pipelines/food/identify');
      const result = await identifyFoods([framePath]);
      const newFoods = result.foods || [];
      const beforeCount = updatedItems.length;
      updatedItems = mergeItems(updatedItems, newFoods);
      const addedCount = updatedItems.length - beforeCount;
      logger.completePhase(idx, `Merged: ${newFoods.length} detected, ${addedCount} new`);
      if (addedCount > 0) {
        const addedNames = newFoods
          .filter((nf: any) => !existing?.items?.includes(nf.name))
          .map((nf: any) => nf.name)
          .join(', ');
        summaryParts.push(`Added ${addedCount} new item${addedCount !== 1 ? 's' : ''}: ${addedNames}`);
      }
    } catch (err: any) {
      logger.failPhase(idx, err?.message);
    }
  }

  // Re-run nutrients with full item list
  if (updatedItems.length > 0) {
    const nutrResult = await runNutrientEstimation(updatedItems, logger);
    updatedNutrients = nutrResult.totals;
  }

  await runPantryDelta(framePath, logger);

  const logName = updatedItems.length > 0
    ? updatedItems.map((i: any) => i.name || i.n).join(', ')
    : existing?.log_name;

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

  const mealType = existing?.meal_type || guessMealType(Date.now());
  const summary = buildNutritionSummary('add', logName, mealType, summaryParts);
  const pipelineFoods = buildPipelineFoods(updatedItems);

  return { logId, summary, pipelineFoods, logName, mealType };
}

// --- Shared Helpers ---

async function runNutrientEstimation(
  foods: any[],
  logger: PipelineLogger,
): Promise<{ totals: Record<string, number>; calStr: string }> {
  const idx = logger.startPhase('food', 'nutrients');
  try {
    const { estimateNutrients } = require('../../pipelines/food/nutrients');
    const results = await Promise.all(
      foods.map(async (food: any) => {
        try {
          return await estimateNutrients({
            name: food.name,
            portion_g: food.portion_g || 100,
            cooking: food.cooking || '',
          });
        } catch { return null; }
      }),
    );
    const totals = aggregateNutrients(results.filter(Boolean));
    const calStr = totals.calories ? `${Math.round(totals.calories)} cal` : '';
    logger.completePhase(idx, `${results.filter(Boolean).length} items analyzed${calStr ? `, ${calStr}` : ''}`);
    return { totals, calStr };
  } catch (err: any) {
    logger.failPhase(idx, err?.message);
    return { totals: {}, calStr: '' };
  }
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

function buildPipelineFoods(items: any[]): any[] {
  return items.map((item: any) => ({
    name: item.name || item.n,
    portion_g: item.portion_g || item.g || 100,
    household_portion: item.household_portion || item.hp,
    cooking: item.cooking || item.k,
    confidence: item.confidence || item.c || 0.8,
    status: 'complete' as const,
  }));
}

/**
 * Build a natural language summary of what the nutrition pipeline did.
 * Spoken by Mittens and displayed as the chat message text.
 */
function buildNutritionSummary(
  action: 'new' | 'add',
  logName: string | null,
  mealType: string | null,
  phaseSummaries: string[],
): string {
  const parts: string[] = [];

  if (action === 'new') {
    parts.push(`Logging ${logName || 'food'} as ${mealType || 'snack'}.`);
  } else {
    parts.push(`Adding to your current ${mealType || 'meal'}: ${logName || 'food'}.`);
  }

  for (const phase of phaseSummaries) {
    parts.push(phase + '.');
  }

  return parts.join(' ');
}
