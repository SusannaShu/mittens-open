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
  matchesSceneType,
  matchesSceneVision,
  isTimedOut,
  persistScene,
} from './scene';
import { classifyFrame } from './sceneClassifier';
import { PipelineLogger, summarizeResult, PipelineLog } from '../../pipelines/logger';

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
  async onPendantFrame(framePath: string, timestamp: number): Promise<{ summary: string, log?: PipelineLog } | null> {
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

    // Drain queued frames in background
    (async () => {
      try {
        while (this.pendingFrames.length > 0) {
          const next = this.pendingFrames.shift()!;
          await this.processFrame(next.framePath, next.timestamp);
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

    // 1. Build context from phone state
    const context = this.buildContext();

    // 2. Classify the frame
    const classifyIdx = logger.startPhase('scene', 'classify');
    const classification = await classifyFrame(framePath, context);
    logger.completePhase(
      classifyIdx,
      `${classification.sceneType}/${classification.subPhase} (conf: ${classification.confidence})`,
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
      ` items=${classification.items.length}`,
    );

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

      // AEIOU incremental phase dispatch -- only run changed dimensions
      try {
        const {
          extractDetections,
          detectChangedDimensions,
          phasesToRun,
          recordPhaseResult,
        } = require('./aeiouPhaseDispatch');

        const detections = await extractDetections(framePath, classification);

        // Update brain hygiene metadata
        matched.meta = matched.meta || {};
        if (detections.screenVisible) {
          // Assume 1 minute per frame interval for simplicity
          matched.meta.scrolling_min = (matched.meta.scrolling_min || 0) + 1;
        }
        if (detections.multitaskingDetected) {
          matched.meta.multitasking_detected = true;
        }

        const changed = detectChangedDimensions(matched.id, detections);
        const phases = phasesToRun(changed);

        if (phases.length > 0 || detections.screenVisible || detections.multitaskingDetected) {
          const aeiouIdx = logger.startPhase('aeiou', 'dispatch');
          for (const phase of phases) {
            const dim = phase[0].toUpperCase() as 'A' | 'E' | 'I' | 'O' | 'U';
            const value = this.getPhaseValue(phase, detections);
            recordPhaseResult(matched, {
              dimension: dim,
              timestamp: Date.now(),
              value,
              confidence: classification.confidence,
              framePath,
            });
          }
          logger.completePhase(
            aeiouIdx,
            `Ran ${phases.length} phases: ${phases.join(', ')}`,
          );

          // Incremental DB update
          if (matched.logId) {
            const { updateLogIncremental } = require('./sceneLogWriter');
            updateLogIncremental(matched.logId, matched);
          }
        }
      } catch { /* aeiouPhaseDispatch not loaded */ }

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

    // 5. Ambient face recognition (non-blocking)
    // Run on social scenes, or periodically on any frame
    if (
      classification.sceneType === 'social' ||
      (matched && matched.type === 'social')
    ) {
      try {
        await this.checkFaceRecognition(framePath, logger);
      } catch (err: any) {
        console.warn('[SceneStream] Face recognition error:', err?.message);
      }
    }

    // 6. Timeout check on all open scenes
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
    // Fast pass: find candidates by scene type (no API call)
    const candidates = this.openScenes.filter(
      (s) => matchesSceneType(s, classification),
    );

    if (candidates.length === 0) return null;

    // Vision pass: check actual image continuity for each candidate
    for (const scene of candidates) {
      try {
        const result = await matchesSceneVision(scene, classification, framePath);
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

    // Create DB log entry immediately
    try {
      const { createLogOnDetect } = require('./sceneLogWriter');
      const logId = createLogOnDetect(scene);
      if (logId) {
        scene.logId = logId;
      }
    } catch (err) {
      console.warn('[SceneStream] Failed to create log on detect:', err);
    }

    console.log(
      `[SceneStream] Opened scene ${scene.id}: ${scene.type}/${scene.subPhase}` +
      ` at ${scene.place || 'unknown'}`,
    );
    return scene;
  }
  // ─── AEIOU Value Extraction ────────────

  /** Extract the current value for a given AEIOU dimension from detections */
  private getPhaseValue(phase: string, detections: any): string {
    switch (phase) {
      case 'activity': return detections.sceneType || 'unknown';
      case 'environment':
        return `${detections.environment || 'unknown'}${detections.nature ? ' (nature)' : ''}`;
      case 'interaction': return `${detections.personCount || 0} people`;
      case 'objects': return (detections.objects || []).join(', ') || 'none';
      case 'user': return 'no change';
      default: return 'unknown';
    }
  }

  // ─── After-Frame Triggers ─────────────

  private checkAfterFrameTriggers(
    scene: Scene,
    classification: SceneClassification,
    logger: PipelineLogger,
  ): void {
    const { checkAfterFrameTriggers: check } = require('./sceneTriggers');
    check(scene, classification, logger);
  }

  // ─── Face Recognition ─────────────────

  /**
   * Delegate face recognition to the extracted module.
   */
  private async checkFaceRecognition(
    framePath: string,
    logger: PipelineLogger,
  ): Promise<void> {
    const { checkFaceRecognition: check } = require('./sceneFaceRecognition');
    await check(framePath, logger);
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

    // Clear AEIOU detection state for this scene
    try {
      const { clearSceneDetections } = require('./aeiouPhaseDispatch');
      clearSceneDetections(scene.id);
    } catch { /* aeiouPhaseDispatch not loaded */ }

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

    // Apply pantry deltas if any
    if (scene.pantryDeltas.length > 0) {
      try {
        const { applyPantryDeltas } = require('./smartPantry');
        const runningLow = applyPantryDeltas(scene.pantryDeltas);
        // Nudge about first running-low item
        if (runningLow.length > 0) {
          try {
            const { nudgeLowPantry } = require('./nudgeComposer');
            nudgeLowPantry(runningLow[0].name);
          } catch { /* nudgeComposer not loaded */ }
        }
      } catch { /* smartPantry not loaded */ }
    }

    // Finalize the database log row (async -- runs food pipeline)
    try {
      if (scene.logId) {
        const { finalizeLog } = require('./sceneLogWriter');
        finalizeLog(scene).catch(console.error);
      }
    } catch (err: any) {
      console.error('[SceneStream] Failed to finalize log:', err?.message || err);
    }
  }
}

