/**
 * ambient/sceneLogWriter.ts -- Log creation from scene triage output.
 *
 * Creates nutrition_logs and/or activity_logs based on the SceneTriage.
 * A single frame can produce BOTH a nutrition log AND an activity log.
 *
 * Nutrition pipeline routes by foodContext signal:
 *   eating  -> VLM dedup -> identify -> nutrients -> chat card
 *   grocery -> grocery pipeline (item tracking, receipt, pantry)
 *   cooking -> cooking pipeline (ingredients, timers, plate detection)
 *   pantry  -> pantry scan
 *
 * Activity logic lives in activityLogWriter.ts.
 */

import type { SceneTriage } from './types';
import type { PipelineLogger } from '../../pipelines/logger';
import { guessMealType } from './logWriterHelpers';
import { dedupNutrition } from './nutritionDedup';
import { handleActivity } from './activityLogWriter';
import {
  handleGroceryFrame,
  checkGroceryExit,
  getActiveGrocerySession,
} from './groceryPipeline';
import {
  handleCookingFrame,
  handleCookingToEating,
  getActiveCookingSession,
  closeCookingSession,
} from './cookingPipeline';
import {
  createNutritionLog,
  updateNutritionLog,
  type NutritionResult,
} from './eatingLogWriter';
import { handlePantryFrame } from './pantryScanPrompt';

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
 * Create or update logs based on scene triage output.
 * Both nutrition and activity can fire for the same frame.
 */
export async function executeLogDecision(
  triage: SceneTriage,
  framePath: string,
  logger: PipelineLogger,
): Promise<LogResult> {
  let nutritionLogId: number | null = null;
  let activityLogId: number | null = null;
  let nutritionSummary: string | null = null;
  let pipelineFoods: any[] | null = null;
  let logName: string | null = null;
  let mealType: string | null = null;

  // Nutrition pipeline (routed by foodContext signal)
  if (triage.signals.foodContext != null) {
    const result = await handleNutrition(triage, framePath, logger);
    nutritionLogId = result.logId;
    nutritionSummary = result.summary;
    pipelineFoods = result.pipelineFoods;
    logName = result.logName;
    mealType = result.mealType;
  } else {
    // No food detected -- check if grocery session should close
    if (getActiveGrocerySession()) {
      await checkGroceryExit(logger);
    }
  }

  // Activity pipeline (delegated to activityLogWriter)
  if (triage.signals.movement) {
    activityLogId = await handleActivity(triage, framePath, logger);
  }

  return { nutritionLogId, activityLogId, nutritionSummary, pipelineFoods, logName, mealType };
}

// --- Nutrition Pipeline ---

async function handleNutrition(
  triage: SceneTriage,
  framePath: string,
  logger: PipelineLogger,
): Promise<NutritionResult> {
  // foodContext already determined by triage -- no separate VLM call needed
  const foodCtx = triage.signals.foodContext!;
  const ctxIdx = logger.startPhase('food', 'context');
  logger.completePhase(ctxIdx, `${foodCtx} (from triage)`);

  switch (foodCtx) {
    case 'grocery':
      return handleGroceryContext(triage, framePath, logger);

    case 'cooking':
      return handleCookingContext(triage, framePath, undefined, logger);

    case 'pantry':
      return handlePantryContext(triage, framePath, logger);

    case 'eating':
    default:
      return handleEatingContext(triage, framePath, logger);
  }
}

// --- Eating Context ---

async function handleEatingContext(
  triage: SceneTriage,
  framePath: string,
  logger: PipelineLogger,
): Promise<NutritionResult> {
  // If a cooking session was active, transition it
  const cookingSession = getActiveCookingSession();
  if (cookingSession) {
    const plateResult = await handleCookingToEating(framePath, logger);
    if (plateResult.action === 'ask_confirm' && plateResult.plateItems.length > 0) {
      return {
        logId: null,
        summary: `Meal ready! Detected on plate: ${plateResult.plateItems.map(i => i.name).join(', ')}. Awaiting confirmation.`,
        pipelineFoods: plateResult.plateItems.map(i => ({
          name: i.name,
          portion_g: i.portion_g,
          confidence: i.confidence,
          status: 'pending' as const,
        })),
        logName: plateResult.plateItems.map(i => i.name).join(', '),
        mealType: guessMealType(Date.now()),
      };
    }
  }

  // If a grocery session was active, close it
  if (getActiveGrocerySession()) {
    await checkGroceryExit(logger);
  }

  // Standard eating flow: VLM Dedup -> Identify -> Nutrients
  const dedupIdx = logger.startPhase('food', 'dedup');
  const dedupResult = await dedupNutrition(framePath, triage.foodItems);
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
    return updateNutritionLog(dedupResult.targetLogId, triage, framePath, db, logger);
  }

  return createNutritionLog(triage, framePath, db, logger);
}

// --- Grocery Context ---

async function handleGroceryContext(
  triage: SceneTriage,
  framePath: string,
  logger: PipelineLogger,
): Promise<NutritionResult> {
  const result = await handleGroceryFrame(
    framePath, triage.foodItems, logger,
  );

  return {
    logId: null,
    summary: result.summary,
    pipelineFoods: null,
    logName: null,
    mealType: null,
  };
}

// --- Cooking Context ---

async function handleCookingContext(
  triage: SceneTriage,
  framePath: string,
  cookingAction: string | undefined,
  logger: PipelineLogger,
): Promise<NutritionResult> {
  const result = await handleCookingFrame(
    framePath, triage.foodItems, cookingAction, logger,
  );

  return {
    logId: null,
    summary: result.summary,
    pipelineFoods: null,
    logName: null,
    mealType: null,
  };
}

// --- Pantry Context ---

async function handlePantryContext(
  triage: SceneTriage,
  framePath: string,
  logger: PipelineLogger,
): Promise<NutritionResult> {
  const result = await handlePantryFrame(
    framePath, triage.foodItems, logger,
  );

  return {
    logId: null,
    summary: result.summary,
    pipelineFoods: null,
    logName: null,
    mealType: null,
  };
}
