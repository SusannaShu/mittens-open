/**
 * ambient/sceneStreamManager.ts -- Ambient intelligence brain.
 *
 * Simplified pipeline: quality gate -> dual classify -> log.
 * No scene matching, no lifecycle, no open-scene tracking.
 * Each frame independently decides: nutrition? activity? both?
 */

import type { FrameClassification, ClassifierContext } from './types';
import { classifyFrame } from './sceneClassifier';
import { executeLogDecision } from './sceneLogWriter';
import { PipelineLogger, PipelineLog } from '../../pipelines/logger';
import {
  getScheduleConfig,
  isNearBedtime,
  hasMorningGreeted,
  markMorningGreeted,
  getOwnerName,
  scheduleWakeNudge,
} from './sleepNudge';

// Singleton
let instance: SceneStreamManager | null = null;
export function getSceneStreamManager(): SceneStreamManager {
  if (!instance) {
    instance = new SceneStreamManager();
    // Arm the 30-min-after-wake nudge timer on first access
    try { scheduleWakeNudge(); } catch { /* non-critical */ }
  }
  return instance;
}

class SceneStreamManager {
  /** Lock to prevent concurrent frame processing */
  private processing = false;
  /** Queue frames that arrive during processing */
  private pendingFrames: Array<{
    framePath: string;
    timestamp: number;
    onResult?: (framePath: string, result: { summary: string; log?: PipelineLog; title?: string; description?: string }) => void;
  }> = [];

  /**
   * Main entry point: a new pendant frame arrived.
   * Called from usePendantBridge.ts on each motion frame.
   */
  async onPendantFrame(
    framePath: string,
    timestamp: number,
    onQueueResult?: (framePath: string, result: { summary: string; log?: PipelineLog; title?: string; description?: string }) => void,
  ): Promise<{ summary: string; log?: PipelineLog; title?: string; description?: string } | null> {
    // Queue if already processing
    if (this.processing) {
      this.pendingFrames.push({ framePath, timestamp, onResult: onQueueResult });
      console.log('[SceneStream] Frame queued (processing in progress)');
      return { summary: 'Queued for processing...' };
    }

    this.processing = true;
    let result: { summary: string; log?: PipelineLog } = { summary: '' };
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
          try {
            const queuedResult = await this.processFrame(next.framePath, next.timestamp);
            next.onResult?.(next.framePath, queuedResult);
          } catch (err: any) {
            console.error('[SceneStream] Queued frame error:', err?.message);
            next.onResult?.(next.framePath, { summary: `Error: ${err?.message}` });
          }
        }
      } finally {
        this.processing = false;
      }
    })();

    return result;
  }

  /**
   * Retry a previously failed capture.
   * Skips the quality gate (frame already passed once or was kept despite skip)
   * and bypasses the queue lock.
   */
  async retryCapture(
    framePath: string,
    timestamp: number,
  ): Promise<{ summary: string; log?: PipelineLog; title?: string; description?: string }> {
    console.log('[SceneStream] Retrying capture:', framePath.slice(-30));
    try {
      return await this.processFrame(framePath, timestamp, true);
    } catch (err: any) {
      console.error('[SceneStream] Retry error:', err?.message);
      return { summary: `Retry failed: ${err?.message}` };
    }
  }

  // --- Core Processing ---

  private async processFrame(
    framePath: string,
    _timestamp: number,
    skipGate = false,
  ): Promise<{ summary: string; log: PipelineLog; title?: string; description?: string }> {
    const logger = new PipelineLogger();
    const FileSystem = require('expo-file-system/legacy');

    // Phase 0: Morning greeting (before quality gate)
    // First capture of the day after wake time -> "Good morning"
    if (!skipGate && !hasMorningGreeted()) {
      const cfg = getScheduleConfig();
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      // Only greet if we are past 4:00 AM (prevent 2 AM bathroom trips from triggering 'Good morning')
      if (now.getHours() >= 4 && nowMin < (cfg.bedtimeHour * 60 + cfg.bedtimeMin)) {
        markMorningGreeted();
        const name = getOwnerName();
        const greeting = `Good morning ${name}!`;
        console.log(`[SceneStream] Morning greeting: "${greeting}"`);

        try {
          const { speak } = require('../ai/voiceService');
          speak(greeting);
        } catch { /* voice not available */ }

        try {
          const { DeviceEventEmitter } = require('react-native');
          DeviceEventEmitter.emit('pendantMessageAdded', {
            id: `m-gm-${Date.now()}`,
            role: 'mittens',
            text: greeting,
            timestamp: new Date(),
            source: 'pendant',
          });
        } catch { /* emit not available */ }
      }
    }

    // Phase 1: Quality Gate (skipped on retry)
    if (skipGate) {
      logger.skipPhase('gate', 'quality', 'Skipped (retry)');
    } else {
      const gateIdx = logger.startPhase('gate', 'quality');
      try {
        const { checkQualityGate, setLastFrame } = require('./frameDedup');
        const bedtimeNear = isNearBedtime();
        const gateResult = await checkQualityGate(framePath, { nearBedtime: bedtimeNear });
        if (gateResult.skip) {
          logger.completePhase(gateIdx, `Skipped (tier ${gateResult.tier}): ${gateResult.reason}`);
          FileSystem.deleteAsync(framePath, { idempotent: true }).catch(() => {});
          return { summary: `Skipped: ${gateResult.reason}`, log: logger.finalize() };
        }
        logger.completePhase(gateIdx, `Frame passed quality gate${bedtimeNear ? ' (bedtime mode)' : ''}`);
        setLastFrame(framePath);
      } catch (err: any) {
        logger.completePhase(gateIdx, `Gate failed: ${err?.message}`);
      }
    }

    // Consume GPS tag if this was a phone-triggered capture
    try {
      const { getCaptureGate } = require('./captureGate');
      const gate = getCaptureGate();
      const gpsTag = gate.consumeGpsTag();
      if (gpsTag) {
        gate.tagFrameInLocationLog(framePath, gpsTag.lat, gpsTag.lon);
      }
    } catch { /* captureGate not loaded */ }

    // Build context from phone state
    const context = this.buildContext();

    // Phase 2: Dual Classifier
    const classifyIdx = logger.startPhase('classify', 'dual');
    const classification = await classifyFrame(framePath, context);
    const nutLabel = classification.nutrition.detected
      ? `nutrition(${classification.nutrition.items.map(i => i.name).join(',')})`
      : 'no-nutrition';
    const actLabel = classification.activity.detected
      ? `activity(${classification.activity.type || '?'})`
      : 'no-activity';
    logger.completePhase(
      classifyIdx,
      `${nutLabel} + ${actLabel}, ${classification.people} people`,
    );

    // Brain offline -- surface error
    if (classification.error) {
      console.warn('[SceneStream] Brain error:', classification.error);
      return { summary: classification.error, log: logger.finalize() };
    }

    // Phase 2.5: Sleep check
    if (classification.sleepContext) {
      try {
        const cfg = getScheduleConfig();
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const bedMin = cfg.bedtimeHour * 60 + cfg.bedtimeMin;
        let diffMin = nowMin - bedMin;
        if (diffMin < 0) diffMin += 1440;

        // If within 6 hours past bedtime
        if (diffMin >= 0 && diffMin < 6 * 60) {
          if (!classification.sleepContext.isDark || classification.sleepContext.screensVisible) {
             const { deliverNudge } = require('./nudgeComposer');
             deliverNudge({
               type: 'bedtime',
               message: 'It is past your bedtime. Please put away screens and go to sleep.',
               urgent: true
             });
             console.log('[SceneStream] Triggered bedtime nudge (not dark / screens visible)');
          }
        }
      } catch (err: any) {
        console.warn('[SceneStream] Bedtime check failed:', err?.message);
      }
    }

    // Phase 2.5b: Face Recognition (runs whenever people > 0, regardless of activity/nutrition)
    let recognizedNames: string[] = [];
    if (classification.people > 0) {
      const faceIdx = logger.startPhase('face', 'recognition');
      try {
        const { checkFaceRecognition } = require('./sceneFaceRecognition');
        const faceResult = await checkFaceRecognition(framePath, null, logger);
        recognizedNames = faceResult.recognizedNames || [];
        logger.completePhase(
          faceIdx,
          recognizedNames.length > 0
            ? `Recognized: ${recognizedNames.join(', ')}`
            : 'No known faces',
        );
      } catch (err: any) {
        logger.failPhase(faceIdx, err?.message || 'Face recognition failed');
      }
    }

    // Nothing detected at all
    if (!classification.nutrition.detected && !classification.activity.detected) {
      // Even with no food/activity, face check above already ran if people > 0
      logger.skipPhase('log', 'write', 'Nothing detected');
      let summary: string;
      if (recognizedNames.length > 0) {
        summary = `Recognized: ${recognizedNames.join(', ')}`;
      } else if (classification.people > 0) {
        summary = `${classification.people} ${classification.people === 1 ? 'person' : 'people'} detected`;
      } else {
        summary = 'Nothing detected';
      }
      return { summary, log: logger.finalize(), description: classification.description || undefined };
    }

    // Set triage summary for debug trace
    const pipelines: string[] = [];
    if (classification.nutrition.detected) pipelines.push('nutrition');
    if (classification.activity.detected) pipelines.push('activity');
    logger.setTriageSummary(pipelines.join(' + '));

    // Phase 3: Log Creation
    const logIdx = logger.startPhase('log', 'write');
    let logResult: Awaited<ReturnType<typeof executeLogDecision>> | null = null;
    try {
      logResult = await executeLogDecision(classification, framePath, logger);
      const parts: string[] = [];
      if (logResult.nutritionLogId) parts.push(`meal #${logResult.nutritionLogId}`);
      if (logResult.activityLogId) parts.push(`activity #${logResult.activityLogId}`);
      logger.completePhase(logIdx, parts.join(' + ') || logResult.nutritionSummary || 'No logs created');
    } catch (err: any) {
      logger.failPhase(logIdx, err?.message);
    }

    // Emit chat message for nutrition logs (photo + MealPipelineCard)
    if (logResult?.nutritionLogId && logResult.pipelineFoods) {
      try {
        const { DeviceEventEmitter } = require('react-native');
        DeviceEventEmitter.emit('pendantMessageAdded', {
          id: `m-nut-${Date.now()}`,
          role: 'mittens',
          text: logResult.nutritionSummary || 'Food detected.',
          photos: [framePath],
          timestamp: new Date(),
          source: 'pendant',
          pipelineFoods: logResult.pipelineFoods,
          mealMetadata: {
            mealName: logResult.logName,
            mealType: logResult.mealType,
            logId: logResult.nutritionLogId,
            source: 'pendant',
          },
        });
      } catch (emitErr: any) {
        console.warn('[SceneStream] Chat emit failed:', emitErr?.message);
      }
    }


    // Build summary for UI
    const summaryParts: string[] = [];
    if (logResult?.nutritionSummary) {
      summaryParts.push(logResult.nutritionSummary);
    } else if (classification.nutrition.detected) {
      const names = classification.nutrition.items.map(i => i.name).join(', ');
      summaryParts.push(names || 'food detected');
    }
    if (classification.activity.detected) {
      summaryParts.push(classification.activity.type || 'activity');
    }
    const summary = `[${pipelines.join('+')}] ${summaryParts.join(' | ')}`;

    const log = logger.finalize();

    // Extract title/description for pendant store
    const title = classification.activity.detected
      ? (classification.activity.type || classification.description?.slice(0, 50) || 'Capture')
      : (classification.nutrition.detected
        ? classification.nutrition.items.map(i => i.name).join(', ')
        : classification.description?.slice(0, 50) || 'Capture');
    const description = classification.description || undefined;

    return { summary, log, title, description };
  }

  // --- Context Building ---

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
}
