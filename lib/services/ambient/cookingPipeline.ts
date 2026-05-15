/**
 * ambient/cookingPipeline.ts -- Stateful cooking session tracker.
 *
 * Tracks ingredients used during cooking, decrements pantry,
 * sets smart nutrition-optimized timers, and manages the
 * cooking-to-eating transition with plate detection.
 *
 * Key design: when eating is detected after cooking, Mittens
 * asks what's on the plate rather than blindly logging all
 * cooking ingredients. The meal log reflects what's eaten,
 * not everything that was cooked.
 */

import type {
  CookingSession,
  CookingIngredient,
  DetectedFoodItem,
} from './types';
import type { PipelineLogger } from '../../pipelines/logger';
import {
  startCookingTimer,
  cancelAllTimers,
  estimateCookTime,
  cancelTimer,
  getActiveTimers,
} from './cookingTimer';
import {
  detectPlateItems,
  emitPlateConfirmMessage,
  type PlateDetectionResult,
} from './plateDetection';

// --- Singleton Session State ---

let activeSession: CookingSession | null = null;

// --- Public API ---

export function getActiveCookingSession(): CookingSession | null {
  return activeSession;
}

/**
 * Process a frame classified as cooking context.
 * Opens session if none active, tracks ingredients, sets timers.
 */
export async function handleCookingFrame(
  framePath: string,
  detectedItems: DetectedFoodItem[],
  cookingAction: string | undefined,
  logger: PipelineLogger,
): Promise<CookingFrameResult> {
  if (!activeSession) {
    activeSession = openSession();
    createCookingActivity(activeSession);
    console.log(`[CookingPipeline] Opened session #${activeSession.id}`);
  }

  // Track ingredients
  const trackIdx = logger.startPhase('cooking', 'trackIngredients');
  const newIngredients = await detectIngredients(framePath, detectedItems);
  mergeIngredients(activeSession, newIngredients);
  logger.completePhase(
    trackIdx,
    `${newIngredients.length} new, ${activeSession.ingredients.length} total`,
  );

  // Decrement pantry for new ingredients
  if (newIngredients.length > 0) {
    decrementPantry(newIngredients, framePath, logger);
  }

  // Check for cooking actions that need timers
  if (cookingAction) {
    await checkForTimer(cookingAction, framePath, logger);
  }

  // Check if any timed items were removed
  await checkTimerCancellation(framePath, logger);

  return {
    sessionId: activeSession.id,
    totalIngredients: activeSession.ingredients.length,
    activeTimers: getActiveTimers().length,
    summary: buildCookingSummary(newIngredients),
  };
}

/**
 * Handle the cooking-to-eating transition.
 * Called when food context changes from cooking to eating.
 * Does NOT auto-log -- asks the user first.
 */
export async function handleCookingToEating(
  eatingFramePath: string,
  logger: PipelineLogger,
): Promise<PlateDetectionResult> {
  if (!activeSession) {
    return { action: 'no_session', plateItems: [] };
  }

  const session = activeSession;
  session.status = 'plating';
  activeSession = null;

  // Cancel any remaining timers
  cancelAllTimers();

  const plateIdx = logger.startPhase('cooking', 'plateDetection');

  // Detect what's actually on the plate
  const plateItems = await detectPlateItems(eatingFramePath, session.ingredients);
  logger.completePhase(
    plateIdx,
    `${plateItems.length} items on plate (cooked ${session.ingredients.length} ingredients)`,
  );

  // Ask the user
  emitPlateConfirmMessage(plateItems, session);

  return {
    action: 'ask_confirm',
    plateItems,
    cookingIngredients: session.ingredients,
  };
}

/**
 * Check if cooking session should close without eating.
 * (e.g., meal prep, cooking for others)
 */
export function closeCookingSession(): CookingSession | null {
  if (!activeSession) return null;

  const session = activeSession;
  session.status = 'closed';
  activeSession = null;
  cancelAllTimers();

  console.log(`[CookingPipeline] Session closed (${session.ingredients.length} ingredients)`);
  return session;
}

// --- Session Lifecycle ---

function openSession(): CookingSession {
  return {
    id: Date.now(),
    startedAt: new Date().toISOString(),
    ingredients: [],
    timers: [],
    status: 'active',
  };
}

function createCookingActivity(session: CookingSession): void {
  try {
    const { getDb } = require('../../database');
    const db = getDb();

    let placeName: string | null = null;
    try {
      const { getCurrentPlace } = require('../location/locationService');
      placeName = getCurrentPlace() || null;
    } catch { /* location not available */ }

    db.runSync(
      `INSERT INTO activity_logs (
        logged_at, log_name, activity_type, duration_min, mets,
        source, location, created_at, updated_at
      ) VALUES (?, 'Cooking', 'cooking', 0, 2.0, 'pendant', ?, datetime('now'), datetime('now'))`,
      [session.startedAt, placeName],
    );
  } catch (err: any) {
    console.warn('[CookingPipeline] Activity log failed:', err?.message);
  }
}

// --- Ingredient Detection ---

async function detectIngredients(
  framePath: string,
  hintItems: DetectedFoodItem[],
): Promise<CookingIngredient[]> {
  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    const hints = hintItems.map(i => i.name).join(', ');
    const prompt = [
      'A person is cooking. What ingredients are they actively using or preparing?',
      'Include EVERYTHING: oils, spices, condiments, sauces, vegetables, proteins.',
      hints ? `Hint items: ${hints}` : '',
      '',
      'Return JSON only:',
      '{"ingredients": [{"name":"olive oil","qty":2,"unit":"tbsp","conf":0.8}]}',
      '',
      'Only include ingredients being actively used/prepped RIGHT NOW.',
      'Do not include items sitting untouched in the background.',
      'Return {"ingredients":[]} if nothing specific is visible.',
    ].filter(Boolean).join('\n');

    const raw = brain.supportsVision
      ? await brain.vision(prompt, [framePath])
      : await brain.text(prompt);

    return parseIngredients(raw, framePath);
  } catch (err: any) {
    console.warn('[CookingPipeline] Ingredient detection failed:', err?.message);
    return [];
  }
}

function parseIngredients(raw: string, framePath: string): CookingIngredient[] {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.ingredients)) return [];

    return parsed.ingredients
      .map((item: any) => ({
        name: String(item.name || '').toLowerCase().trim(),
        qty: Number(item.qty || 1),
        unit: String(item.unit || 'whole'),
        confidence: Number(item.conf || item.confidence || 0.7),
        framePath,
      }))
      .filter((i: CookingIngredient) => i.name.length > 0);
  } catch {
    return [];
  }
}

function mergeIngredients(session: CookingSession, newItems: CookingIngredient[]): void {
  for (const item of newItems) {
    const existing = session.ingredients.find(
      i => i.name.toLowerCase() === item.name.toLowerCase(),
    );
    if (existing) {
      // Accumulate quantity if same ingredient used again
      existing.qty += item.qty;
      if (item.confidence > existing.confidence) {
        existing.confidence = item.confidence;
      }
    } else {
      session.ingredients.push(item);
    }
  }
}

// --- Pantry Decrement ---

function decrementPantry(
  ingredients: CookingIngredient[],
  framePath: string,
  logger: PipelineLogger,
): void {
  const pantryIdx = logger.startPhase('cooking', 'pantryDecrement');
  try {
    const { applyPantryDeltas } = require('./smartPantry');
    const deltas = ingredients.map(i => ({
      name: i.name,
      qtyChange: -i.qty,
      unit: i.unit,
      confidence: confidenceToLevel(i.confidence),
      reason: 'Used in cooking',
      framePath,
    }));
    const runningLow = applyPantryDeltas(deltas);
    const lowNames = runningLow.map((r: any) => r.name).join(', ');
    logger.completePhase(
      pantryIdx,
      `${deltas.length} items decremented${lowNames ? `. Running low: ${lowNames}` : ''}`,
    );
  } catch (err: any) {
    logger.failPhase(pantryIdx, err?.message);
  }
}

// --- Timer Management ---

async function checkForTimer(
  cookingAction: string,
  _framePath: string,
  logger: PipelineLogger,
): Promise<void> {
  // Parse cooking action for item + method
  const parsed = parseCookingAction(cookingAction);
  if (!parsed) return;

  // Skip if timer already exists for this item
  const existing = getActiveTimers().find(
    t => t.ingredient.toLowerCase() === parsed.ingredient.toLowerCase(),
  );
  if (existing) return;

  const timerIdx = logger.startPhase('cooking', 'smartTimer');
  try {
    const durationSec = await estimateCookTime(parsed.ingredient, parsed.method);
    const timer = startCookingTimer(parsed.ingredient, parsed.method, durationSec);
    if (activeSession) {
      activeSession.timers.push(timer);
    }
    logger.completePhase(
      timerIdx,
      `${parsed.ingredient} (${parsed.method}): ${Math.round(durationSec / 60)} min`,
    );
  } catch (err: any) {
    logger.failPhase(timerIdx, err?.message);
  }
}

async function checkTimerCancellation(
  framePath: string,
  logger: PipelineLogger,
): Promise<void> {
  const timers = getActiveTimers();
  if (timers.length === 0) return;

  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    const timerList = timers.map(t => t.ingredient).join(', ');
    const prompt = [
      `Currently cooking with timers for: ${timerList}`,
      'Has any of these items been REMOVED from heat (taken out of steamer,',
      'pot, oven, etc.)? Respond JSON only:',
      '{"removed": ["ingredient_name"] or []}',
    ].join('\n');

    const raw = brain.supportsVision
      ? await brain.vision(prompt, [framePath])
      : await brain.text(prompt);

    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) return;

    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed.removed)) {
      for (const name of parsed.removed) {
        cancelTimer(String(name));
        console.log(`[CookingPipeline] Auto-cancelled timer for ${name} (removed from heat)`);
      }
    }
  } catch { /* timer check is best-effort */ }
}

function parseCookingAction(action: string): { ingredient: string; method: string } | null {
  // Common patterns: "steaming salmon", "boiling broccoli", "baking chicken"
  const methods = [
    'steaming', 'boiling', 'baking', 'frying', 'grilling',
    'roasting', 'sauteing', 'braising', 'stewing', 'poaching',
    'microwaving', 'toasting', 'broiling', 'simmering',
  ];

  const lower = action.toLowerCase();
  for (const method of methods) {
    if (lower.includes(method)) {
      const ingredient = lower.replace(method, '').trim();
      if (ingredient.length > 0) {
        return { ingredient, method };
      }
    }
  }

  // Try "put X in Y" pattern
  const putMatch = lower.match(/put\s+(.+?)\s+in\s+(.+)/);
  if (putMatch) {
    return { ingredient: putMatch[1].trim(), method: putMatch[2].trim() };
  }

  return null;
}

// --- Helpers ---

function confidenceToLevel(conf: number): 'high' | 'medium' | 'guess' {
  if (conf >= 0.8) return 'high';
  if (conf >= 0.5) return 'medium';
  return 'guess';
}

function buildCookingSummary(newIngredients: CookingIngredient[]): string {
  if (newIngredients.length === 0) return 'Cooking...';
  const names = newIngredients.map(i => i.name).join(', ');
  return `Using: ${names}`;
}

export interface CookingFrameResult {
  sessionId: number;
  totalIngredients: number;
  activeTimers: number;
  summary: string;
}
