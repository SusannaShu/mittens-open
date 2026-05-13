/**
 * ambient/ambientTriage.ts -- Per-capture triage engine.
 *
 * Decides which pipeline phases to run for each pendant frame based on:
 *   1. Scene classification result (eating? work? social?)
 *   2. Whether a matching log exists within the dedup window
 *   3. What changed since the last frame (vision dedup diff)
 *
 * Returns a TriageDecision telling sceneStreamManager how to proceed.
 */

import type { SceneClassification, SceneType } from './types';

// ─── Types ────

export interface TriageDecision {
  pipeline: 'food' | 'activity' | 'skip';
  action: 'create' | 'update' | 'skip';
  existingLogId?: number;
  phases: string[];
  reason: string;
}

interface DedupContext {
  /** Result from vision-based continuity check */
  continuityScore: number;
  isSameScene: boolean;
  changes?: string;
}

/** Window for dedup: if a pendant log exists within this window, prefer update */
const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

// ─── Main Triage ────

/**
 * Triage a classified frame into a pipeline decision.
 */
export function triageCapture(
  classification: SceneClassification,
  dedup: DedupContext | null,
): TriageDecision {
  const { sceneType, confidence } = classification;

  // Low confidence = skip
  if (confidence < 0.3) {
    return { pipeline: 'skip', action: 'skip', phases: [], reason: 'Low confidence' };
  }

  if (sceneType === 'unknown') {
    return { pipeline: 'skip', action: 'skip', phases: [], reason: 'Unknown scene' };
  }

  // Food scenes
  if (sceneType === 'eating' || sceneType === 'meal_prep') {
    return triageFood(classification, dedup);
  }

  // Activity scenes
  return triageActivity(classification, dedup);
}

// ─── Food Triage ────

function triageFood(
  classification: SceneClassification,
  dedup: DedupContext | null,
): TriageDecision {
  const recentLog = findRecentLog('nutrition_logs', DEDUP_WINDOW_MS);

  if (!recentLog) {
    // No recent meal -- create with full pipeline
    return {
      pipeline: 'food',
      action: 'create',
      phases: ['identify', 'nutrients', 'eatingContext'],
      reason: 'New eating scene, no recent meal log',
    };
  }

  // Recent meal exists -- check if we should update it
  if (dedup && dedup.isSameScene) {
    // Same scene: check if new items appeared
    const hasNewItems = classification.items.length > 0 &&
      (dedup.changes?.includes('new') || dedup.continuityScore < 0.8);

    return {
      pipeline: 'food',
      action: 'update',
      existingLogId: recentLog.id,
      phases: hasNewItems ? ['identify', 'nutrients'] : [],
      reason: hasNewItems
        ? `Same meal scene, new items detected (score: ${dedup.continuityScore})`
        : `Same meal scene, extending time (score: ${dedup.continuityScore})`,
    };
  }

  // Vision says different scene but still eating -- new meal
  return {
    pipeline: 'food',
    action: 'create',
    phases: ['identify', 'nutrients', 'eatingContext'],
    reason: 'New eating scene (vision: different from recent meal)',
  };
}

// ─── Activity Triage ────

function triageActivity(
  classification: SceneClassification,
  dedup: DedupContext | null,
): TriageDecision {
  const recentLog = findRecentLog('activity_logs', DEDUP_WINDOW_MS);

  // Determine which AEIOU phases have evidence
  const detectablePhases = getDetectablePhases(classification, dedup);

  if (!recentLog) {
    return {
      pipeline: 'activity',
      action: 'create',
      phases: ['detect', 'lifeDesign', ...detectablePhases],
      reason: `New ${classification.sceneType} scene`,
    };
  }

  // Recent activity exists
  if (dedup && dedup.isSameScene) {
    // Same scene -- only run phases where evidence changed
    return {
      pipeline: 'activity',
      action: 'update',
      existingLogId: recentLog.id,
      phases: detectablePhases,
      reason: detectablePhases.length > 0
        ? `Same scene, new evidence: ${detectablePhases.join(', ')}`
        : `Same scene, extending time`,
    };
  }

  // Different scene -- new activity
  return {
    pipeline: 'activity',
    action: 'create',
    phases: ['detect', 'lifeDesign', ...detectablePhases],
    reason: `New ${classification.sceneType} (vision: different from recent log)`,
  };
}

// ─── Phase Detection ────

/**
 * Which AEIOU phases have detectable evidence in this frame?
 * Only phases with actual evidence should run (gated dispatch).
 */
function getDetectablePhases(
  classification: SceneClassification,
  dedup: DedupContext | null,
): string[] {
  const phases: string[] = [];
  const changes = dedup?.changes?.toLowerCase() || '';

  // Environment: detect if description mentions outdoor/indoor/nature change
  if (classification.description?.match(/outdoor|park|nature|sun|indoor|office/i) ||
      changes.includes('environment') || changes.includes('moved')) {
    phases.push('environment');
  }

  // Social: detect if people are mentioned or person count changed
  if (classification.description?.match(/person|people|friend|colleague|group/i) ||
      changes.includes('person') || changes.includes('people')) {
    phases.push('social');
  }

  // Objects: detect if notable objects are mentioned
  if (classification.description?.match(/laptop|phone|book|tool|instrument/i) ||
      changes.includes('object') || changes.includes('device')) {
    phases.push('objects');
  }

  return phases;
}

// ─── DB Helpers ────

interface RecentLogRow {
  id: number;
  logged_at: string;
}

function findRecentLog(
  table: 'nutrition_logs' | 'activity_logs',
  windowMs: number,
): RecentLogRow | null {
  try {
    const { getDb } = require('../../database');
    const db = getDb();
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    const row = db.getFirstSync(
      `SELECT id, logged_at FROM ${table}
       WHERE source = 'pendant' AND logged_at >= ?
       ORDER BY logged_at DESC LIMIT 1`,
      [cutoff],
    ) as RecentLogRow | null;
    return row;
  } catch {
    return null;
  }
}
