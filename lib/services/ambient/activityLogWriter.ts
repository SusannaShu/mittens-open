/**
 * ambient/activityLogWriter.ts -- Activity log creation & update.
 *
 * Extracted from sceneLogWriter.ts to keep files under 400 lines.
 * Handles pendant-triggered activity logging with MET lookup,
 * life design inference, and time-based dedup.
 */

import type { FrameClassification } from './types';
import type { PipelineLogger } from '../../pipelines/logger';

// --- MET Lookup (approximate, for free-form activity types) ---

const MET_TABLE: Record<string, number> = {
  working: 1.3, resting: 1.0, reading: 1.3,
  cooking: 2.0, cleaning: 2.5, errands: 2.5,
  walking: 3.5, hiking: 6.0, cycling: 7.5,
  running: 8.0, gym: 5.0, swimming: 7.0,
  yoga: 2.5, dancing: 4.0, climbing: 8.0,
  socializing: 1.5, commuting: 1.3, driving: 1.3,
};

/** Dedup window for activity logs */
const ACTIVITY_DEDUP_WINDOW_MS = 30 * 60 * 1000;

// --- Main Dispatch ---

export async function handleActivity(
  classification: FrameClassification,
  framePath: string,
  logger: PipelineLogger,
): Promise<number | null> {
  const { getDb } = require('../../database');
  const db = getDb();

  // Check for active trail
  let trailLogId: number | null = null;
  try {
    const { getActiveTrailLogId } = require('./trailActivityBridge');
    trailLogId = getActiveTrailLogId();
  } catch { /* trailActivityBridge not loaded */ }

  if (trailLogId != null) {
    return updateActivityLog(trailLogId, classification, framePath, db, logger);
  }

  const recentLog = findRecentActivityLog(db);
  if (recentLog) {
    return updateActivityLog(recentLog.id, classification, framePath, db, logger);
  }
  return createActivityLog(classification, framePath, db, logger);
}

// --- Create ---

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

  let placeName: string | null = null;
  try {
    const { getCurrentPlace } = require('../location/locationService');
    placeName = getCurrentPlace() || null;
  } catch { /* location not available */ }

  let aeiouJson = null;
  let isOutdoors = 0;
  let isNature = 0;

  const aeiouIdx = logger.startPhase('activity', 'aeiou');
  try {
    const { detectAeiou } = require('./aeiouDetector');
    const sceneDesc = classification.description || classification.activity.description || '';
    const obs = await detectAeiou(framePath, sceneDesc);
    if (obs) {
      aeiouJson = { ...obs, _raw: [obs] };
      isOutdoors = obs.isOutdoors ? 1 : 0;
      isNature = obs.isNature ? 1 : 0;
      logger.completePhase(aeiouIdx, 'Detected AEIOU');
    } else {
      logger.completePhase(aeiouIdx, 'No AEIOU detected');
    }
  } catch (err: any) {
    logger.failPhase(aeiouIdx, err?.message);
  }

  const result = db.runSync(
    `INSERT INTO activity_logs (
      logged_at, log_name, activity_type, duration_min, mets,
      life_categories, aeiou, source, location, image_uris,
      outdoors, is_nature,
      created_at, updated_at
    ) VALUES (?, ?, ?, 0, ?, ?, ?, 'pendant', ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      new Date().toISOString(),
      logName, actType, metValue,
      lifeDesignWeights ? JSON.stringify(lifeDesignWeights) : null,
      aeiouJson ? JSON.stringify(aeiouJson) : null,
      placeName,
      framePath ? JSON.stringify([framePath]) : null,
      isOutdoors,
      isNature,
    ],
  );

  const logId = result?.lastInsertRowId ?? null;
  console.log(`[ActivityLogWriter] Created log #${logId}: ${logName} (${metValue} MET)`);
  return logId;
}

// --- Update ---

async function updateActivityLog(
  logId: number,
  classification: FrameClassification,
  framePath: string,
  db: any,
  logger: PipelineLogger,
): Promise<number | null> {
  const existing = db.getFirstSync(
    'SELECT logged_at, image_uris, life_categories, aeiou, outdoors, is_nature FROM activity_logs WHERE id = ?',
    [logId],
  ) as any;

  const loggedAt = new Date(existing?.logged_at || Date.now());
  const durationMin = Math.round((Date.now() - loggedAt.getTime()) / 60000);

  const existingImages = existing?.image_uris ? JSON.parse(existing.image_uris) : [];
  existingImages.push(framePath);

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

  // AEIOU detection: single VLM phase per capture, aggregate on log
  let aeiouJson = existing?.aeiou ? JSON.parse(existing.aeiou) : null;
  let isOutdoors = existing?.outdoors || 0;
  let isNature = existing?.is_nature || 0;

  const aeiouIdx = logger.startPhase('activity', 'aeiou');
  try {
    const { detectAeiou, summarizeAeiou } = require('./aeiouDetector');
    const sceneDesc = classification.description || classification.activity.description || '';
    const obs = await detectAeiou(framePath, sceneDesc);
    if (obs) {
      // Accumulate raw observations and re-summarize
      const rawObs = aeiouJson?._raw || [];
      rawObs.push(obs);

      if (rawObs.length === 1) {
        // First observation: use directly
        aeiouJson = { ...obs, _raw: rawObs };
      } else {
        // Multiple observations: summarize
        const summary = await summarizeAeiou(rawObs);
        aeiouJson = { ...summary, _raw: rawObs };
      }
      isOutdoors = aeiouJson.isOutdoors || rawObs.some((o: any) => o.isOutdoors) ? 1 : isOutdoors;
      isNature = aeiouJson.isNature || rawObs.some((o: any) => o.isNature) ? 1 : isNature;
      logger.completePhase(aeiouIdx, `${rawObs.length} observations`);
    } else {
      logger.completePhase(aeiouIdx, 'No AEIOU detected');
    }
  } catch (err: any) {
    logger.failPhase(aeiouIdx, err?.message);
  }

  db.runSync(
    `UPDATE activity_logs SET
      duration_min = ?, image_uris = ?,
      life_categories = ?, aeiou = ?, outdoors = ?, is_nature = ?, updated_at = datetime('now')
    WHERE id = ?`,
    [
      durationMin,
      JSON.stringify(existingImages),
      lifeCategories ? JSON.stringify(lifeCategories) : null,
      aeiouJson ? JSON.stringify(aeiouJson) : null,
      isOutdoors,
      isNature,
      logId,
    ],
  );

  console.log(`[ActivityLogWriter] Updated log #${logId} (${durationMin}min, ${existingImages.length} frames)`);
  return logId;
}

// --- Helpers ---

function lookupMET(activityType: string): number {
  const key = activityType.toLowerCase().trim();
  return MET_TABLE[key] ?? 1.3;
}

function findRecentActivityLog(db: any): { id: number } | null {
  try {
    const cutoff = new Date(Date.now() - ACTIVITY_DEDUP_WINDOW_MS).toISOString();
    return db.getFirstSync(
      `SELECT id FROM activity_logs
       WHERE source IN ('pendant', 'trail') AND logged_at >= ?
       ORDER BY logged_at DESC LIMIT 1`,
      [cutoff],
    ) as { id: number } | null;
  } catch { return null; }
}
