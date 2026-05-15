/**
 * ambient/nutritionDedup.ts -- VLM-based nutrition log dedup.
 *
 * Instead of fuzzy string matching, feeds the new frame + recent log history
 * to the brain and asks it to decide: skip, add to existing log, or new log.
 *
 * This is the "eating dedup phase" of the pipeline.
 */

import type { DetectedFoodItem } from './types';

// --- Types ---

export type DedupAction = 'skip' | 'add' | 'new';

export interface DedupDecision {
  action: DedupAction;
  /** Log ID to update (only when action === 'add') */
  targetLogId?: number;
  /** Reason for the decision (from VLM) */
  reason: string;
}

export interface RecentNutritionLog {
  id: number;
  logged_at: string;
  log_name: string;
  items: any[];
  image_uris: string[];
}

/** Dedup window: only look at logs within this window */
const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

// --- Public API ---

/**
 * Ask the brain whether detected food items are already logged,
 * should be added to an existing meal, or represent a new meal.
 *
 * Sends the new frame photo + recent log summaries to the VLM.
 */
export async function dedupNutrition(
  framePath: string,
  detectedItems: DetectedFoodItem[],
): Promise<DedupDecision> {
  const recentLogs = getRecentNutritionLogs();

  // No recent logs -> definitely new
  if (recentLogs.length === 0) {
    return { action: 'new', reason: 'No recent nutrition logs in the past 30 minutes.' };
  }

  // Ask brain to decide
  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    const prompt = buildDedupPrompt(detectedItems, recentLogs);
    const raw = brain.supportsVision
      ? await brain.vision(prompt, [framePath])
      : await brain.text(prompt);

    return parseDedupResponse(raw, recentLogs);
  } catch (err: any) {
    console.warn('[NutritionDedup] Brain dedup failed, defaulting to new:', err?.message);
    return { action: 'new', reason: `Dedup failed: ${err?.message}` };
  }
}

// --- Query Recent Logs ---

function getRecentNutritionLogs(): RecentNutritionLog[] {
  try {
    const { getDb } = require('../../database');
    const db = getDb();
    const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();

    const rows = db.getAllSync(
      `SELECT id, logged_at, log_name, items, image_uris
       FROM nutrition_logs
       WHERE source IN ('pendant', 'voice')
         AND logged_at >= ?
         AND deleted_at IS NULL
       ORDER BY logged_at DESC`,
      [cutoff],
    ) as any[];

    return (rows || []).map((r: any) => ({
      id: r.id,
      logged_at: r.logged_at,
      log_name: r.log_name || '',
      items: safeParseJSON(r.items, []),
      image_uris: safeParseJSON(r.image_uris, []),
    }));
  } catch {
    return [];
  }
}

// --- Prompt ---

function buildDedupPrompt(
  detectedItems: DetectedFoodItem[],
  recentLogs: RecentNutritionLog[],
): string {
  const itemList = detectedItems
    .map(i => `- ${i.name}${i.qty ? ` x${i.qty}` : ''}${i.unit ? ` (${i.unit})` : ''}`)
    .join('\n');

  const logSummaries = recentLogs
    .map(log => {
      const time = new Date(log.logged_at).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
      const items = log.items
        .map((i: any) => i.name || i.n || 'unknown')
        .join(', ');
      return `- Log #${log.id} at ${time}: ${log.log_name || items}`;
    })
    .join('\n');

  return [
    'A wearable camera just captured this photo. Food/drink was detected:',
    itemList,
    '',
    'Recent nutrition logs from the past 30 minutes:',
    logSummaries,
    '',
    'Decide if the detected food in the NEW photo is:',
    '1. "skip" -- the SAME food that was already logged (e.g., same coffee mug still on desk,',
    '   same plate that has not changed). Only skip if you are confident nothing new is happening.',
    '2. "add" -- a DIFFERENT item being eaten as part of the same meal/snack',
    '   (e.g., adding a banana after already logging an orange in the same sitting).',
    '   Provide the targetLogId to add to.',
    '3. "new" -- a completely new eating occasion (different meal, different time context).',
    '',
    'Return ONLY JSON:',
    '{ "action": "skip"|"add"|"new", "targetLogId": number|null, "reason": "brief explanation" }',
  ].join('\n');
}

// --- Parse ---

function parseDedupResponse(raw: string, recentLogs: RecentNutritionLog[]): DedupDecision {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return { action: 'new', reason: 'Could not parse dedup response.' };

    const parsed = JSON.parse(jsonMatch[0]);
    const action: DedupAction = ['skip', 'add', 'new'].includes(parsed.action)
      ? parsed.action
      : 'new';

    // Validate targetLogId exists in recent logs
    let targetLogId = parsed.targetLogId ?? null;
    if (action === 'add' && targetLogId != null) {
      const exists = recentLogs.some(l => l.id === targetLogId);
      if (!exists) {
        // Brain hallucinated a log ID -- fall back to most recent log
        targetLogId = recentLogs[0]?.id ?? null;
      }
    }

    return {
      action,
      targetLogId: action === 'add' ? targetLogId : undefined,
      reason: parsed.reason || '',
    };
  } catch {
    return { action: 'new', reason: 'Dedup parse failed.' };
  }
}

// --- Util ---

function safeParseJSON(str: string | null | undefined, fallback: any): any {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}
