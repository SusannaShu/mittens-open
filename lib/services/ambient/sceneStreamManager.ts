/**
 * ambient/sceneStreamManager.ts -- Ambient intelligence brain.
 * Per-frame: classify -> match scenes -> triage -> create/update logs.
 */

import type {
  Scene,
  SceneClassification,
  ClassifierContext,
} from './types';
import {
  openScene,
  extendScene,
  matchesSceneType,
  matchesSceneVision,
  isTimedOut,
} from './scene';
import { classifyFrame } from './sceneClassifier';
import { triageCapture } from './ambientTriage';
import { executeLogDecision } from './sceneLogWriter';
import {
  checkAfterFrameTriggers as lifecycleAfterFrame,
  checkFaceRecognition as lifecycleFaceRecog,
  closeAndRoute as lifecycleClose,
} from './sceneLifecycle';
import { PipelineLogger, PipelineLog } from '../../pipelines/logger';

// Singleton
let instance: SceneStreamManager | null = null;
export function getSceneStreamManager(): SceneStreamManager {
  if (!instance) instance = new SceneStreamManager();
  return instance;
}

const MIN_CONFIDENCE = 0.3;
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
  /** Last vision dedup result (passed to triage for context) */
  private lastVisionResult: { continuityScore: number; changes?: string } | null = null;

  /**
   * Main entry point: a new pendant frame arrived.
   * Called from usePendantBridge.ts on each motion frame.
   *
   * @param onQueueResult -- callback invoked for each queued frame after it
   *   finishes processing in the background drain loop. Without this, queued
   *   frames would process but never update the UI.
   */
  async onPendantFrame(
    framePath: string,
    timestamp: number,
    onQueueResult?: (framePath: string, result: { summary: string, log?: PipelineLog }) => void,
  ): Promise<{ summary: string, log?: PipelineLog } | null> {
    // Queue if already processing
    if (this.processing) {
      this.pendingFrames.push({ framePath, timestamp });
      console.log('[SceneStream] Frame queued (processing in progress)');
      return { summary: 'Queued for processing...' };
    }

    this.processing = true;
    let result: { summary: string, log?: PipelineLog } = { summary: '' };
    try {
      result = await this.processFrame(framePath, timestamp);
    } catch (err) {
      console.error('[SceneStream] Processing error:', err);
      result = { summary: 'Error during processing' };
    }

    // Drain queued frames in background, notifying the caller of each result
    (async () => {
      try {
        while (this.pendingFrames.length > 0) {
          const next = this.pendingFrames.shift()!;
          try {
            const queuedResult = await this.processFrame(next.framePath, next.timestamp);
            onQueueResult?.(next.framePath, queuedResult);
          } catch (err: any) {
            console.error('[SceneStream] Queued frame error:', err?.message);
            onQueueResult?.(next.framePath, { summary: `Error: ${err?.message}` });
          }
        }
      } finally {
        this.processing = false;
      }
    })();

    return result;
  }

  /** Get all currently open scenes (for UI / debug) */
  getOpenScenes(): ReadonlyArray<Scene> {
    return this.openScenes;
  }

  // ─── Core Processing ──────────────────

  private async processFrame(
    framePath: string,
    timestamp: number,
  ): Promise<{ summary: string, log: PipelineLog }> {
    const logger = new PipelineLogger();
    const FileSystem = require('expo-file-system/legacy');

    // 0. Frame dedup -- skip + delete if too similar to last frame
    const frameDedupIdx = logger.startPhase('scene', 'frame_dedup');
    try {
      const { checkFrameDedup, setLastFrame } = require('./frameDedup');
      const dupCheck = await checkFrameDedup(framePath);
      if (dupCheck.isDuplicate) {
        logger.completePhase(frameDedupIdx, `Skipped (tier ${dupCheck.tier}): ${dupCheck.reason}`);
        FileSystem.deleteAsync(framePath, { idempotent: true }).catch(() => {});
        return { summary: `Skipped: ${dupCheck.reason}`, log: logger.finalize() };
      }
      logger.completePhase(frameDedupIdx, 'Frame is different, proceeding');
      setLastFrame(framePath);
    } catch (err: any) {
      logger.completePhase(frameDedupIdx, `Dedup check failed: ${err?.message}`);
    }

    // 1. Build context from phone state
    const context = this.buildContext();

    // 2. Classify the frame
    const classifyIdx = logger.startPhase('scene', 'classify');
    const classification = await classifyFrame(framePath, context);
    logger.completePhase(
      classifyIdx,
      `${classification.sceneType}/${classification.subPhase} (conf: ${classification.confidence}, ppl: ${classification.detectedPeople})`,
    );

    // 2.5. Consume GPS tag if this was a phone-triggered capture
    try {
      const { getCaptureGate } = require('./captureGate');
      const gate = getCaptureGate();
      const gpsTag = gate.consumeGpsTag();
      if (gpsTag) {
        gate.tagFrameInLocationLog(framePath, gpsTag.lat, gpsTag.lon);
      }
    } catch { /* captureGate not loaded */ }

    console.log(
      `[SceneStream] Frame classified: ${classification.sceneType}` +
      `/${classification.subPhase} conf=${classification.confidence}` +
      ` items=${classification.items.length} ppl=${classification.detectedPeople}`,
    );

    // 2.9. Brain offline -- surface error instead of silently classifying as unknown
    if (classification.error) {
      console.warn('[SceneStream] Brain error:', classification.error);
      logger.skipPhase('scene', 'match', classification.error);
      return { summary: classification.error, log: logger.finalize() };
    }

    // 3. Skip low-confidence unknown frames
    if (
      classification.sceneType === 'unknown' &&
      classification.confidence < MIN_CONFIDENCE
    ) {
      logger.skipPhase('scene', 'match', 'Low confidence unknown');
      return { summary: 'Low confidence unknown', log: logger.finalize() };
    }

    // 4. Try to match against open scenes (vision-based)
    const matchIdx = logger.startPhase('scene', 'match');
    const matched = await this.findMatchingScene(classification, framePath, logger);
    logger.completePhase(
      matchIdx,
      matched ? `Matched ${matched.type} (vision)` : 'No match',
    );

    let result = '';

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
      this.checkAfterFrameTriggers(matched, classification, logger);
      result = `[${matched.type}] Extracted ${classification.items.length} items (${classification.subPhase})`;
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
        result = `[${newScene.type}] Scene started (${classification.subPhase})`;
      } else {
        result = `Low confidence frame skipped (${classification.sceneType})`;
      }
    }

    // 5. Per-capture triage: decide what pipeline to run
    const triageIdx = logger.startPhase('ambient', 'triage');
    const dedupContext = matched ? {
      continuityScore: 1.0,
      isSameScene: true,
      changes: undefined as string | undefined,
    } : null;

    // If vision match was attempted, use the result
    if (matched && this.lastVisionResult) {
      dedupContext!.continuityScore = this.lastVisionResult.continuityScore;
      dedupContext!.changes = this.lastVisionResult.changes;
    }

    // Check for active trail (movement session with linked activity log)
    let trailLogId: number | null = null;
    try {
      const { getActiveTrailLogId } = require('./trailActivityBridge');
      trailLogId = getActiveTrailLogId();
    } catch { /* trailActivityBridge not loaded */ }

    const triageDecision = triageCapture(classification, dedupContext, trailLogId);
    logger.completePhase(
      triageIdx,
      `${triageDecision.pipeline}/${triageDecision.action}: ${triageDecision.reason}`,
    );
    logger.setTriageSummary(
      `${triageDecision.pipeline}/${triageDecision.action} -> [${triageDecision.phases.join(', ')}]`,
    );

    // 6. Execute log create/update with gated phases
    if (triageDecision.action !== 'skip') {
      const logIdx = logger.startPhase('ambient', 'log');
      try {
        const { logId } = await executeLogDecision(
          triageDecision, classification, framePath, matched || null, logger,
        );
        logger.completePhase(
          logIdx,
          logId != null
            ? `${triageDecision.action} log #${logId}`
            : 'No log created',
        );
      } catch (err: any) {
        logger.failPhase(logIdx, err?.message);
      }
    } else {
      // If triage skipped, override summary so UI bridge drops it
      result = `Skipped: ${triageDecision.reason}`;
    }

    // 7. Ambient face recognition -- gated by triage (only when people detected)
    const activeScene = matched || (classification.confidence >= MIN_CONFIDENCE ? this.openScenes[this.openScenes.length - 1] : null);
    if (triageDecision.phases.includes('face_recognition') && activeScene) {
      try {
        await this.checkFaceRecognition(framePath, activeScene, logger);
      } catch (err: any) {
        console.warn('[SceneStream] Face recognition error:', err?.message);
      }
    }

    // 8. Timeout check on all open scenes
    this.checkTimeouts(timestamp, logger);

    const log = logger.finalize();
    return { summary: result, log };
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

    // Retrieve relevant memory for the current context
    try {
      const { retrieveMemory } = require('./memoryUpsert');
      const keyword = context.place || 'kitchen';
      const memory = retrieveMemory(keyword);
      if (memory) {
        context.recentMemory = memory.text;
      }
    } catch { /* memoryUpsert not loaded */ }

    return context;
  }

  // ─── Scene Matching ───────────────────

  private async findMatchingScene(
    classification: SceneClassification,
    framePath: string,
    logger: PipelineLogger,
  ): Promise<Scene | null> {
    this.lastVisionResult = null;

    // Fast pass: find candidates by scene type (no API call)
    const candidates = this.openScenes.filter(
      (s) => matchesSceneType(s, classification),
    );

    if (candidates.length === 0) return null;

    // Vision pass: check actual image continuity for each candidate
    for (const scene of candidates) {
      try {
        const result = await matchesSceneVision(scene, classification, framePath);
        // Store for triage context
        this.lastVisionResult = {
          continuityScore: result.continuityScore ?? 1.0,
          changes: result.changes,
        };

        if (result.matches) {
          if (result.changes) {
            console.log(`[SceneStream] Vision match ${scene.id}: score=${result.continuityScore}, changes=${result.changes}`);
          }
          return scene;
        } else {
          console.log(`[SceneStream] Vision rejected ${scene.id}: score=${result.continuityScore} -- different event`);
        }
      } catch {
        // Vision failed -- fall back to text match
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
    // Uses fast text check here -- vision already ran in findMatchingScene
    for (const scene of this.openScenes) {
      if (!matchesSceneType(scene, classification)) {
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
    classification: SceneClassification,
    logger: PipelineLogger,
  ): void {
    lifecycleAfterFrame(scene, classification, logger);
  }

  // ─── Face Recognition ─────────────────

  private async checkFaceRecognition(
    framePath: string,
    scene: Scene,
    logger: PipelineLogger,
  ): Promise<void> {
    await lifecycleFaceRecog(framePath, scene, logger);
  }

  // ─── Timeout / Cleanup ────────────────

  private checkTimeouts(
    _timestamp: number,
    logger: PipelineLogger,
  ): void {
    const now = Date.now();
    for (const scene of this.openScenes) {
      if (isTimedOut(scene, now)) this.closeAndRoute(scene, 'timeout', logger);
    }
  }

  private closeAndRoute(
    scene: Scene,
    reason: 'scene_change' | 'timeout' | 'geofence_exit' | 'user',
    logger: PipelineLogger,
  ): void {
    this.openScenes = lifecycleClose(
      scene, reason, this.openScenes, this.nonMatchCounts, logger,
    );
  }
}
