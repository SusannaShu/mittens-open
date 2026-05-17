/**
 * ambient/sceneStreamManager.ts -- Ambient intelligence brain.
 *
 * Multi-signal pipeline: quality gate -> scene triage -> log.
 * Every frame gets a title and description. Independent signals
 * (nature, outdoors, movement, screenUse, foodContext) route to
 * appropriate downstream handlers.
 */

import type { SceneTriage } from './types';
import { triageFrame } from './sceneClassifier';
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

// ─── Types ───

export interface FrameResult {
  summary: string;
  log?: PipelineLog;
  title?: string;
  description?: string;
}

// ─── Singleton ───

let instance: SceneStreamManager | null = null;
export function getSceneStreamManager(): SceneStreamManager {
  if (!instance) {
    instance = new SceneStreamManager();
    try { scheduleWakeNudge(); } catch { /* non-critical */ }
  }
  return instance;
}

// ─── Manager ───

class SceneStreamManager {
  private processing = false;
  private pendingFrames: Array<{
    framePath: string;
    timestamp: number;
    onResult?: (framePath: string, result: FrameResult) => void;
  }> = [];

  async onPendantFrame(
    framePath: string,
    timestamp: number,
    onQueueResult?: (framePath: string, result: FrameResult) => void,
  ): Promise<FrameResult | null> {
    if (this.processing) {
      this.pendingFrames.push({ framePath, timestamp, onResult: onQueueResult });
      console.log('[SceneStream] Frame queued (processing in progress)');
      return { summary: 'Queued for processing...' };
    }

    this.processing = true;
    let result: FrameResult = { summary: '' };
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

  async retryCapture(
    framePath: string,
    timestamp: number,
  ): Promise<FrameResult> {
    console.log('[SceneStream] Retrying capture:', framePath.slice(-30));
    try {
      return await this.processFrame(framePath, timestamp, true);
    } catch (err: any) {
      console.error('[SceneStream] Retry error:', err?.message);
      return { summary: `Retry failed: ${err?.message}` };
    }
  }

  // ─── Core Processing ───

  private async processFrame(
    framePath: string,
    _timestamp: number,
    skipGate = false,
  ): Promise<FrameResult> {
    const logger = new PipelineLogger();
    const FileSystem = require('expo-file-system/legacy');

    // Phase 0: Morning greeting
    await this.checkMorningGreeting(skipGate);

    // Phase 1: Quality Gate
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

    // Consume GPS tag if phone-triggered capture
    this.consumeGpsTag(framePath);

    // Build context from phone state
    const context = this.buildContext();

    // Phase 2: Scene Triage (replaces dual classifier)
    const triageIdx = logger.startPhase('classify', 'triage');
    const triage = await triageFrame(framePath, context);

    const signalLabels = this.buildSignalLabels(triage);
    logger.completePhase(
      triageIdx,
      `${signalLabels}, ${triage.people} people`,
    );

    // Brain offline -- surface error
    if (triage.error) {
      console.warn('[SceneStream] Brain error:', triage.error);
      return {
        summary: triage.error,
        log: logger.finalize(),
        title: triage.title,
        description: triage.description,
      };
    }

    // Phase 2.5: Sleep check
    this.checkBedtime(triage);

    // Phase 2.5b: Face Recognition (whenever people > 0)
    const recognizedNames = await this.runFaceRecognition(
      triage, framePath, logger,
    );

    // Phase 2.5c: Sedentary auto-timer (screenUse at home, no separate VLM)
    if (triage.signals.screenUse) {
      this.checkSedentaryFromSignal(framePath);
    }

    // Determine which downstream pipelines to run
    const hasFood = triage.signals.foodContext != null;
    const hasMovement = triage.signals.movement;

    // Phase 3: Log Creation (food and/or activity)
    const logResult = await this.runLogPhase(
      triage, hasFood, hasMovement, framePath, logger,
    );

    // Emit chat message for nutrition logs
    if (logResult?.nutritionLogId && logResult.pipelineFoods) {
      this.emitNutritionChat(logResult, framePath);
    }

    // Build summary for UI
    const summary = this.buildSummary(
      triage, logResult, recognizedNames, hasFood, hasMovement,
    );

    return {
      summary,
      log: logger.finalize(),
      title: triage.title,
      description: triage.description,
    };
  }

  // ─── Sub-phases (extracted for readability) ───

  private async checkMorningGreeting(skipGate: boolean): Promise<void> {
    if (skipGate) return;
    if (await hasMorningGreeted()) return;

    const cfg = getScheduleConfig();
    const now = new Date();
    const hr = now.getHours();
    const nowMin = hr * 60 + now.getMinutes();
    if (hr >= 4 && nowMin < (cfg.bedtimeHour * 60 + cfg.bedtimeMin)) {
      await markMorningGreeted();
      const name = getOwnerName();
      const timeGreeting = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
      const greeting = `${timeGreeting} ${name}!`;
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

  private consumeGpsTag(framePath: string): void {
    try {
      const { getCaptureGate } = require('./captureGate');
      const gate = getCaptureGate();
      const gpsTag = gate.consumeGpsTag();
      if (gpsTag) {
        gate.tagFrameInLocationLog(framePath, gpsTag.lat, gpsTag.lon);
      }
    } catch { /* captureGate not loaded */ }
  }

  private buildContext(): { place?: string; motionType?: string; recentMemory?: string } {
    const context: { place?: string; motionType?: string; recentMemory?: string } = {};

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

  private buildSignalLabels(triage: SceneTriage): string {
    const parts: string[] = [];
    if (triage.signals.nature) parts.push('nature');
    if (triage.signals.outdoors) parts.push('outdoors');
    if (triage.signals.movement) parts.push(`movement(${triage.signals.movementType || '?'})`);
    if (triage.signals.screenUse) parts.push('screen');
    if (triage.signals.foodContext) parts.push(`food(${triage.signals.foodContext})`);
    return parts.length > 0 ? parts.join('+') : 'ambient';
  }

  private checkBedtime(triage: SceneTriage): void {
    if (!triage.sleepContext) return;
    try {
      const cfg = getScheduleConfig();
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const bedMin = cfg.bedtimeHour * 60 + cfg.bedtimeMin;
      let diffMin = nowMin - bedMin;
      if (diffMin < 0) diffMin += 1440;

      if (diffMin >= 0 && diffMin < 6 * 60) {
        if (!triage.sleepContext.isDark || triage.sleepContext.screensVisible) {
          const { deliverNudge } = require('./nudgeComposer');
          deliverNudge({
            type: 'bedtime',
            message: 'It is past your bedtime. Please put away screens and go to sleep.',
            urgent: true,
          });
          console.log('[SceneStream] Triggered bedtime nudge (not dark / screens visible)');
        }
      }
    } catch (err: any) {
      console.warn('[SceneStream] Bedtime check failed:', err?.message);
    }
  }

  private async runFaceRecognition(
    triage: SceneTriage,
    framePath: string,
    logger: PipelineLogger,
  ): Promise<string[]> {
    if (triage.people <= 0) return [];
    try {
      const { checkFaceRecognition } = require('./sceneFaceRecognition');
      const faceResult = await checkFaceRecognition(framePath, null, logger);
      return faceResult.recognizedNames || [];
    } catch (err: any) {
      console.warn('[SceneStream] Face recognition failed:', err?.message);
      return [];
    }
  }

  private checkSedentaryFromSignal(framePath: string): void {
    try {
      const { getCurrentPlace } = require('../location/locationService');
      const place = getCurrentPlace();
      if (place === 'Home') {
        const { triggerFromSignal } = require('./sedentaryDetector');
        triggerFromSignal(true).catch(() => { /* non-blocking */ });
      }
    } catch { /* location or sedentary service not loaded */ }
  }

  private async runLogPhase(
    triage: SceneTriage,
    hasFood: boolean,
    hasMovement: boolean,
    framePath: string,
    logger: PipelineLogger,
  ): Promise<any> {
    if (!hasFood && !hasMovement) {
      // No actionable signals -- still logged title/description
      const signalTags: string[] = [];
      if (triage.signals.nature) signalTags.push('nature');
      if (triage.signals.outdoors) signalTags.push('outdoors');
      if (signalTags.length > 0) {
        logger.completePhase(
          logger.startPhase('log', 'tags'),
          `Tagged: ${signalTags.join(', ')}`,
        );
      }
      return null;
    }

    const pipelines: string[] = [];
    if (hasFood) pipelines.push('nutrition');
    if (hasMovement) pipelines.push('activity');
    logger.setTriageSummary(pipelines.join(' + '));

    const logIdx = logger.startPhase('log', 'write');
    try {
      const logResult = await executeLogDecision(triage, framePath, logger);
      const parts: string[] = [];
      if (logResult.nutritionLogId) parts.push(`meal #${logResult.nutritionLogId}`);
      if (logResult.activityLogId) parts.push(`activity #${logResult.activityLogId}`);
      logger.completePhase(logIdx, parts.join(' + ') || logResult.nutritionSummary || 'No logs created');
      return logResult;
    } catch (err: any) {
      logger.failPhase(logIdx, err?.message);
      return null;
    }
  }

  private emitNutritionChat(logResult: any, framePath: string): void {
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

  private buildSummary(
    triage: SceneTriage,
    logResult: any,
    recognizedNames: string[],
    hasFood: boolean,
    hasMovement: boolean,
  ): string {
    // Always start with the title
    const summaryParts: string[] = [];

    if (logResult?.nutritionSummary) {
      summaryParts.push(logResult.nutritionSummary);
    } else if (hasFood && triage.foodItems.length > 0) {
      summaryParts.push(triage.foodItems.map(i => i.name).join(', '));
    }

    if (hasMovement) {
      summaryParts.push(triage.signals.movementType || 'movement');
    }

    if (recognizedNames.length > 0) {
      summaryParts.push(`with ${recognizedNames.join(', ')}`);
    }

    // Build signal tags
    const tags: string[] = [];
    if (triage.signals.nature) tags.push('nature');
    if (triage.signals.outdoors) tags.push('outdoors');
    if (triage.signals.screenUse) tags.push('screen');

    if (summaryParts.length > 0) {
      const tagStr = tags.length > 0 ? ` [${tags.join(',')}]` : '';
      return `${triage.title}: ${summaryParts.join(' | ')}${tagStr}`;
    }

    if (tags.length > 0) {
      return `${triage.title} [${tags.join(',')}]`;
    }

    if (triage.people > 0) {
      return `${triage.title}: ${triage.people} ${triage.people === 1 ? 'person' : 'people'}`;
    }

    // Fallback: always return the title (never "Nothing detected")
    return triage.title;
  }
}
