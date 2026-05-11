/**
 * ambient/sceneStreamManager.ts -- The ambient intelligence brain.
 *
 * Tracks all open scenes. On each new pendant frame:
 *   1. Classify frame via sceneClassifier
 *   2. Check against all open scenes -- does it match any?
 *   3. If match -> scene.extend() -> check after-frame triggers
 *   4. If no match -> close stale scenes, open new scene
 *   5. On scene close -> route to existing pipelines (food/activity)
 *
 * Event-driven: no polling. Logic triggers only on new evidence.
 * Multiple scenes can be open simultaneously at the same place.
 */

import type {
  Scene,
  SceneClassification,
  ClassifierContext,
  ScenePipelineResult,
} from './types';
import {
  openScene,
  extendScene,
  closeScene,
  matchesScene,
  isTimedOut,
  persistScene,
} from './scene';
import { classifyFrame } from './sceneClassifier';
import { PipelineLogger, summarizeResult } from '../../pipelines/logger';

// ═══════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════

let instance: SceneStreamManager | null = null;

export function getSceneStreamManager(): SceneStreamManager {
  if (!instance) {
    instance = new SceneStreamManager();
  }
  return instance;
}

// ═══════════════════════════════════════
// MANAGER
// ═══════════════════════════════════════

/** Minimum confidence to open a new scene */
const MIN_CONFIDENCE = 0.3;

/** Consecutive non-matching frames before closing a scene */
const NON_MATCH_CLOSE_THRESHOLD = 2;

class SceneStreamManager {
  /** Currently open scenes */
  private openScenes: Scene[] = [];
  /** Non-match counters per scene ID */
  private nonMatchCounts: Map<string, number> = new Map();
  /** Lock to prevent concurrent frame processing */
  private processing = false;
  /** Queue frames that arrive during processing */
  private pendingFrames: Array<{ framePath: string; timestamp: number }> = [];

  /**
   * Main entry point: a new pendant frame arrived.
   * Called from usePendantBridge.ts on each motion frame.
   */
  async onPendantFrame(framePath: string, timestamp: number): Promise<void> {
    // Queue if already processing
    if (this.processing) {
      this.pendingFrames.push({ framePath, timestamp });
      console.log('[SceneStream] Frame queued (processing in progress)');
      return;
    }

    this.processing = true;
    try {
      await this.processFrame(framePath, timestamp);

      // Drain any queued frames
      while (this.pendingFrames.length > 0) {
        const next = this.pendingFrames.shift()!;
        await this.processFrame(next.framePath, next.timestamp);
      }
    } finally {
      this.processing = false;
    }
  }

  /** Get all currently open scenes (for UI / debug) */
  getOpenScenes(): ReadonlyArray<Scene> {
    return this.openScenes;
  }

  // ─── Core Processing ──────────────────

  private async processFrame(
    framePath: string,
    timestamp: number,
  ): Promise<void> {
    const logger = new PipelineLogger();

    // 1. Build context from phone state
    const context = this.buildContext();

    // 2. Classify the frame
    const classifyIdx = logger.startPhase('scene', 'classify');
    const classification = await classifyFrame(framePath, context);
    logger.completePhase(
      classifyIdx,
      `${classification.sceneType}/${classification.subPhase} (conf: ${classification.confidence})`,
    );

    console.log(
      `[SceneStream] Frame classified: ${classification.sceneType}` +
      `/${classification.subPhase} conf=${classification.confidence}` +
      ` items=${classification.items.length}`,
    );

    // 3. Skip low-confidence unknown frames
    if (
      classification.sceneType === 'unknown' &&
      classification.confidence < MIN_CONFIDENCE
    ) {
      logger.skipPhase('scene', 'match', 'Low confidence unknown');
      return;
    }

    // 4. Try to match against open scenes
    const matched = this.findMatchingScene(classification);

    if (matched) {
      // Extend existing scene
      const extendIdx = logger.startPhase('scene', 'extend');
      extendScene(matched, classification, framePath);
      this.nonMatchCounts.set(matched.id, 0);
      logger.completePhase(
        extendIdx,
        `Extended ${matched.type}, frame #${matched.frameCount}`,
      );

      // Check after-frame triggers
      this.checkAfterFrameTriggers(matched, logger);
    } else {
      // No match -- close stale scenes and open new one
      this.handleNonMatches(classification, logger);

      if (classification.confidence >= MIN_CONFIDENCE) {
        const openIdx = logger.startPhase('scene', 'open');
        const newScene = this.openNewScene(classification, framePath);
        logger.completePhase(
          openIdx,
          `Opened ${newScene.type}/${newScene.subPhase} at ${newScene.place || 'unknown place'}`,
        );
      }
    }

    // 5. Timeout check on all open scenes
    this.checkTimeouts(timestamp, logger);

    logger.finalize();
  }

  // ─── Context Building ─────────────────

  private buildContext(): ClassifierContext {
    const context: ClassifierContext = {};

    try {
      const { getCurrentPlace, getLastMotionType } =
        require('../location/locationService');
      context.place = getCurrentPlace() || undefined;
      context.motionType = getLastMotionType() || undefined;
    } catch {
      // Location service may not be initialized
    }

    // Provide active scene types so brain can detect transitions
    if (this.openScenes.length > 0) {
      context.currentScenes = this.openScenes.map((s) => ({
        type: s.type,
        subPhase: s.subPhase,
      }));
    }

    return context;
  }

  // ─── Scene Matching ───────────────────

  private findMatchingScene(
    classification: SceneClassification,
  ): Scene | null {
    for (const scene of this.openScenes) {
      if (matchesScene(scene, classification)) {
        return scene;
      }
    }
    return null;
  }

  private handleNonMatches(
    classification: SceneClassification,
    logger: PipelineLogger,
  ): void {
    // Increment non-match counts for all open scenes
    for (const scene of this.openScenes) {
      if (!matchesScene(scene, classification)) {
        const count = (this.nonMatchCounts.get(scene.id) || 0) + 1;
        this.nonMatchCounts.set(scene.id, count);

        if (count >= NON_MATCH_CLOSE_THRESHOLD) {
          this.closeAndRoute(scene, 'scene_change', logger);
        }
      }
    }
  }

  private openNewScene(
    classification: SceneClassification,
    framePath: string,
  ): Scene {
    let place: string | undefined;
    try {
      const { getCurrentPlace } = require('../location/locationService');
      place = getCurrentPlace() || undefined;
    } catch {}

    const scene = openScene(classification, place);
    scene.framePaths.push(framePath);
    scene.lastFramePath = framePath;

    this.openScenes.push(scene);
    this.nonMatchCounts.set(scene.id, 0);

    console.log(
      `[SceneStream] Opened scene ${scene.id}: ${scene.type}/${scene.subPhase}` +
      ` at ${scene.place || 'unknown'}`,
    );
    return scene;
  }

  // ─── After-Frame Triggers ─────────────

  private checkAfterFrameTriggers(
    scene: Scene,
    logger: PipelineLogger,
  ): void {
    // Sedentary check for work scenes
    if (scene.type === 'work') {
      this.checkSedentary(scene, logger);
    }

    // Cook timer detection for meal scenes
    if (scene.type === 'meal_prep' && scene.food?.method) {
      this.checkCookTimer(scene, logger);
    }
  }

  private checkSedentary(scene: Scene, _logger: PipelineLogger): void {
    try {
      const { getDb } = require('../../database');
      const db = getDb();
      const profile = db.getFirstSync(
        'SELECT work_interval_mins FROM nutrition_profile WHERE id = 1',
      ) as any;

      const intervalMs = (profile?.work_interval_mins || 45) * 60 * 1000;
      const elapsed = Date.now() - scene.openedAt;

      if (elapsed >= intervalMs) {
        console.log(
          `[SceneStream] Sedentary alert: ${Math.round(elapsed / 60000)}min at desk`,
        );
        // Will be handled by nudge system in Step 6
      }
    } catch {}
  }

  private checkCookTimer(scene: Scene, _logger: PipelineLogger): void {
    if (scene.food?.cookFinishAt && Date.now() >= scene.food.cookFinishAt) {
      console.log('[SceneStream] Cook timer expired for', scene.food.method);
      // Will be handled by nudge system in Step 7
    }
  }

  // ─── Timeout / Cleanup ────────────────

  private checkTimeouts(
    _timestamp: number,
    logger: PipelineLogger,
  ): void {
    const now = Date.now();
    const toClose: Scene[] = [];

    for (const scene of this.openScenes) {
      if (isTimedOut(scene, now)) {
        toClose.push(scene);
      }
    }

    for (const scene of toClose) {
      this.closeAndRoute(scene, 'timeout', logger);
    }
  }

  // ─── Close & Route ────────────────────

  private closeAndRoute(
    scene: Scene,
    reason: 'scene_change' | 'timeout' | 'geofence_exit' | 'user',
    logger: PipelineLogger,
  ): void {
    const closeIdx = logger.startPhase('scene', 'close');
    closeScene(scene, reason);

    // Remove from open scenes
    this.openScenes = this.openScenes.filter((s) => s.id !== scene.id);
    this.nonMatchCounts.delete(scene.id);

    logger.completePhase(
      closeIdx,
      `Closed: ${reason}, ${scene.frameCount} frames`,
    );

    console.log(
      `[SceneStream] Closed scene ${scene.id}: ${scene.type} ` +
      `(${reason}, ${scene.frameCount} frames)`,
    );

    // Persist scene log
    persistScene(scene, logger.finalize());

    // Route to existing pipelines for actual log creation
    this.routeToLogPipeline(scene);
  }

  /**
   * On scene close, write to nutrition_logs or activity_logs.
   * Reuses existing API functions so the UI picks up entries automatically.
   */
  private routeToLogPipeline(scene: Scene): void {
    try {
      if (scene.type === 'meal_prep' || scene.type === 'eating') {
        this.writeNutritionLog(scene);
      } else if (
        scene.type === 'work' ||
        scene.type === 'exercise' ||
        scene.type === 'social' ||
        scene.type === 'commute'
      ) {
        this.writeActivityLog(scene);
      }
    } catch (err: any) {
      console.error('[SceneStream] Failed to route log:', err?.message || err);
    }
  }

  private writeNutritionLog(scene: Scene): void {
    const { getDb } = require('../../database');
    const db = getDb();

    const mealType = guessMealType(scene.openedAt);
    const items = scene.food?.ingredients || [];
    const logName = items.length > 0
      ? items.map((i) => i.name).join(', ')
      : `${mealType} (pendant)`;

    db.runSync(
      `INSERT INTO nutrition_logs (
        logged_at, meal_type, log_name, items,
        source, image_uris, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pendant', ?, datetime('now'), datetime('now'))`,
      [
        new Date(scene.openedAt).toISOString(),
        mealType,
        logName,
        JSON.stringify(items),
        scene.framePaths.length > 0
          ? JSON.stringify(scene.framePaths)
          : null,
      ],
    );
    console.log(`[SceneStream] Wrote nutrition_log: ${logName}`);
  }

  private writeActivityLog(scene: Scene): void {
    const { getDb } = require('../../database');
    const db = getDb();

    const durationMin = scene.closedAt
      ? Math.round((scene.closedAt - scene.openedAt) / 60000)
      : 0;
    const logName = `${scene.type} (pendant)`;

    db.runSync(
      `INSERT INTO activity_logs (
        logged_at, log_name, activity_type, duration_min,
        source, location, image_uris, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pendant', ?, ?, datetime('now'), datetime('now'))`,
      [
        new Date(scene.openedAt).toISOString(),
        logName,
        scene.type,
        durationMin,
        scene.place || null,
        scene.framePaths.length > 0
          ? JSON.stringify(scene.framePaths)
          : null,
      ],
    );
    console.log(`[SceneStream] Wrote activity_log: ${logName} (${durationMin}min)`);
  }
}

// ─── Helpers ────────────────────────────

function guessMealType(
  timestampMs: number,
): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const hour = new Date(timestampMs).getHours();
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 21) return 'dinner';
  return 'snack';
}
