/**
 * ambient/sleepNudge.ts -- Bedtime camera trigger + VLM classification.
 *
 * 35 minutes before the user's configured bedtime, the app forces a
 * camera capture and classifies what's happening:
 *   - Total black -> user slept early, no nudge
 *   - Screen/work visible -> nudge to stop working
 *   - Dim light / bathroom -> already winding down, no nudge
 *   - Other -> gentle reminder
 */

import type { SleepNudgeResult } from './types';

/** Default bedtime (24h format). Override via nutrition_profile.bedtime_hour */
const DEFAULT_BEDTIME_HOUR = 23;
const DEFAULT_BEDTIME_MIN = 0;

/** How many minutes before bedtime to trigger the check */
const NUDGE_LEAD_MIN = 35;

let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
let lastNudgeDate: string | null = null;

/**
 * Schedule the sleep nudge check for today.
 * Call this once at app start and after midnight.
 * Automatically cancels any existing timer.
 */
export function scheduleSleepNudge(): void {
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }

  const { bedtimeHour, bedtimeMin } = getBedtimeConfig();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // Already nudged today
  if (lastNudgeDate === today) {
    console.log('[SleepNudge] Already nudged today, skipping');
    return;
  }

  // Calculate trigger time (bedtime - lead time)
  const triggerTime = new Date(now);
  triggerTime.setHours(bedtimeHour, bedtimeMin, 0, 0);
  triggerTime.setMinutes(triggerTime.getMinutes() - NUDGE_LEAD_MIN);

  const delayMs = triggerTime.getTime() - now.getTime();
  if (delayMs <= 0) {
    console.log('[SleepNudge] Trigger time already passed for today');
    return;
  }

  console.log(`[SleepNudge] Scheduled for ${triggerTime.toLocaleTimeString()} (${Math.round(delayMs / 60000)}min from now)`);

  scheduledTimer = setTimeout(async () => {
    scheduledTimer = null;
    lastNudgeDate = today;
    await executeSleepCheck();
  }, delayMs);
}

/**
 * Cancel any pending sleep nudge timer.
 */
export function cancelSleepNudge(): void {
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    scheduledTimer = null;
    console.log('[SleepNudge] Cancelled');
  }
}

// --- Core Logic ---

async function executeSleepCheck(): Promise<void> {
  console.log('[SleepNudge] Triggering bedtime camera capture...');

  try {
    // Force a camera capture from the pendant
    const { getPendantService } = require('../../services/pendant/pendantService');
    const service = getPendantService();

    // Request a single frame capture
    const framePath = await service.requestFrame();
    if (!framePath) {
      console.warn('[SleepNudge] No frame received from pendant');
      return;
    }

    // Classify the bedtime scene
    const result = await classifyBedtimeScene(framePath);
    console.log(`[SleepNudge] Scene: ${result.scene}, nudge: ${result.nudge}, reason: ${result.reason}`);

    // Handle the result
    if (result.scene === 'black') {
      // User is already asleep -- log sleep, no nudge
      logEarlySleep();
      return;
    }

    if (result.nudge) {
      const { deliverNudge } = require('./nudgeComposer');
      deliverNudge({
        type: 'bedtime',
        message: result.message || 'Time to start winding down for bed.',
      });
    }

    // Clean up frame
    const FileSystem = require('expo-file-system/legacy');
    FileSystem.deleteAsync(framePath, { idempotent: true }).catch(() => {});
  } catch (err: any) {
    console.warn('[SleepNudge] Check failed:', err?.message);
  }
}

async function classifyBedtimeScene(framePath: string): Promise<SleepNudgeResult> {
  const { getBrain } = require('../../brain/selector');
  const brain = await getBrain();

  const prompt = [
    'This photo was taken 35 minutes before the user\'s bedtime.',
    'Classify the scene to decide if the user needs a bedtime nudge.',
    'Respond JSON only:',
    '{',
    '  "scene": "black" | "screen_work" | "winding_down" | "other",',
    '  "nudge": true/false,',
    '  "message": "optional nudge message if nudge is true",',
    '  "reason": "brief explanation"',
    '}',
    '',
    'Guidelines:',
    '- "black": totally dark/black photo -> user likely asleep, nudge=false',
    '- "screen_work": screens, laptop, bright lights -> nudge=true, tell them to stop working',
    '- "winding_down": dim lights, bathroom, brushing teeth -> nudge=false, already preparing',
    '- "other": unclear scene -> nudge=true with gentle reminder',
  ].join('\n');

  try {
    const raw = await brain.vision(prompt, [framePath]);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { scene: 'other', nudge: true, reason: 'Could not parse response', message: 'Time to start winding down for bed.' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      scene: parsed.scene || 'other',
      nudge: Boolean(parsed.nudge),
      message: parsed.message || undefined,
      reason: parsed.reason || '',
    };
  } catch (err: any) {
    console.warn('[SleepNudge] Classification failed:', err?.message);
    return { scene: 'other', nudge: false, reason: `Error: ${err?.message}` };
  }
}

// --- Helpers ---

function getBedtimeConfig(): { bedtimeHour: number; bedtimeMin: number } {
  try {
    const { getDb } = require('../../database');
    const db = getDb();
    const profile = db.getFirstSync(
      'SELECT bedtime_hour, bedtime_min FROM nutrition_profile WHERE id = 1',
    ) as any;
    return {
      bedtimeHour: profile?.bedtime_hour ?? DEFAULT_BEDTIME_HOUR,
      bedtimeMin: profile?.bedtime_min ?? DEFAULT_BEDTIME_MIN,
    };
  } catch {
    return { bedtimeHour: DEFAULT_BEDTIME_HOUR, bedtimeMin: DEFAULT_BEDTIME_MIN };
  }
}

function logEarlySleep(): void {
  try {
    const { getDb } = require('../../database');
    const db = getDb();
    db.runSync(
      `INSERT INTO activity_logs (
        logged_at, log_name, activity_type, duration_min, mets,
        source, created_at, updated_at
      ) VALUES (?, 'Sleep (early)', 'sleeping', 0, 0.9, 'pendant', datetime('now'), datetime('now'))`,
      [new Date().toISOString()],
    );
    console.log('[SleepNudge] Logged early sleep');
  } catch (err: any) {
    console.warn('[SleepNudge] Failed to log sleep:', err?.message);
  }
}
