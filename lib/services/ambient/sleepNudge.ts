/**
 * ambient/sleepNudge.ts -- Bedtime camera trigger + VLM classification.
 *
 * 35 minutes before the user's configured bedtime, the app forces a
 * camera capture and classifies what's happening:
 *   - Total black -> user slept early, no nudge
 *   - Screen/work visible -> nudge to stop working
 *   - Dim light / bathroom -> already winding down, no nudge
 *   - Other -> gentle reminder
 *
 * Also handles morning greeting + wake-up nudge scheduling.
 *
 * All times derive from the LMST schedule:
 *   wake_time_lmst_minutes (e.g. 360 = 6:00 AM)
 *   sleep_hours (e.g. 9)
 *   bedtime = wake - sleep_hours (e.g. 21:00)
 */

import type { SleepNudgeResult } from './types';

/** How many minutes before bedtime to trigger the check */
const NUDGE_LEAD_MIN = 35;

let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
let lastNudgeDate: string | null = null;

/** Morning greeting state */
let memoryMorningGreetedDate: string | null = null;
let isUserAwakeFlag: boolean = false;
let isUserAwakeDate: string | null = null;
let wakeNudgeTimer: ReturnType<typeof setTimeout> | null = null;

// --- Schedule Config (LMST-derived) ---

export interface ScheduleConfig {
  wakeHour: number;
  wakeMin: number;
  bedtimeHour: number;
  bedtimeMin: number;
  sleepHours: number;
}

/**
 * Read wake/bedtime from the LMST schedule fields.
 * wake = wake_time_lmst_minutes, bedtime = wake - sleep_hours.
 */
export function getScheduleConfig(): ScheduleConfig {
  try {
    const { getDb } = require('../../database');
    const db = getDb();
    const row = db.getFirstSync(
      'SELECT wake_time_lmst_minutes, sleep_hours FROM nutrition_profile WHERE id = 1',
    ) as any;

    const wakeMins = row?.wake_time_lmst_minutes ?? 360; // default 6:00 AM
    const sleepHours = row?.sleep_hours ?? 8;
    const bedMins = (wakeMins - sleepHours * 60 + 1440) % 1440;

    return {
      wakeHour: Math.floor(wakeMins / 60),
      wakeMin: wakeMins % 60,
      bedtimeHour: Math.floor(bedMins / 60),
      bedtimeMin: bedMins % 60,
      sleepHours,
    };
  } catch {
    return { wakeHour: 6, wakeMin: 0, bedtimeHour: 22, bedtimeMin: 0, sleepHours: 8 };
  }
}

/** Legacy alias for existing callers. */
export function getBedtimeConfig(): { bedtimeHour: number; bedtimeMin: number } {
  const cfg = getScheduleConfig();
  return { bedtimeHour: cfg.bedtimeHour, bedtimeMin: cfg.bedtimeMin };
}

/** Check if current time is within 2 hours of bedtime (for quality gate). */
export function isNearBedtime(): boolean {
  const cfg = getScheduleConfig();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const bedMin = cfg.bedtimeHour * 60 + cfg.bedtimeMin;

  // Within 2 hours before or 6 hours after bedtime
  let diffMin = nowMin - bedMin;
  if (diffMin < -12 * 60) diffMin += 1440;
  if (diffMin > 12 * 60) diffMin -= 1440;

  return diffMin >= -120 && diffMin <= 360;
}

// --- Morning Greeting & Awake State ---

/** Check if we've received ANY pendant data today (user is awake) */
export function isUserAwake(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (isUserAwakeDate !== today) {
    isUserAwakeFlag = false;
  }
  return isUserAwakeFlag;
}

/** Mark user as awake (called on ANY BLE data receive, before dedup) */
export function markUserAwake(): void {
  isUserAwakeDate = new Date().toISOString().slice(0, 10);
  isUserAwakeFlag = true;
}

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Check if first capture of the day has been greeted. */
export async function hasMorningGreeted(): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  if (memoryMorningGreetedDate === today) return true;
  
  try {
    const val = await AsyncStorage.getItem('@morning_greeted_date');
    if (val === today) {
      memoryMorningGreetedDate = today;
      return true;
    }
  } catch (e) {}

  try {
    const { getDb } = require('../../database');
    const db = getDb();
    
    const actRow = db.getFirstSync(
      `SELECT id FROM activity_logs WHERE date(logged_at) = ? AND source = 'pendant' LIMIT 1`,
      [today]
    );
    if (actRow) {
      await markMorningGreeted();
      return true;
    }
    
    const msgRow = db.getFirstSync(
      `SELECT id FROM mittens_messages WHERE date(created_at) = ? AND photos IS NOT NULL AND photos != '[]' LIMIT 1`,
      [today]
    );
    if (msgRow) {
      await markMorningGreeted();
      return true;
    }
  } catch (e) {
    console.warn('[sleepNudge] hasMorningGreeted DB error:', e);
  }
  
  return false;
}

/** Mark morning greeting as done for today. */
export async function markMorningGreeted(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  memoryMorningGreetedDate = today;
  try {
    await AsyncStorage.setItem('@morning_greeted_date', today);
  } catch (e) {}
}

/** Get owner's name from profile for greetings. */
export function getOwnerName(): string {
  try {
    const { getDb } = require('../../database');
    const db = getDb();
    const row = db.getFirstSync(
      'SELECT name FROM nutrition_profile WHERE id = 1',
    ) as any;
    return row?.name || 'there';
  } catch {
    return 'there';
  }
}

/**
 * Schedule a wake-up nudge 30 min after wake time.
 * If no pendant capture arrives by then, Mittens says "Time to get up".
 * Call on app boot and after midnight.
 */
export function scheduleWakeNudge(): void {
  if (wakeNudgeTimer) {
    clearTimeout(wakeNudgeTimer);
    wakeNudgeTimer = null;
  }

  const today = new Date().toISOString().slice(0, 10);
  if (memoryMorningGreetedDate === today) {
    // Already greeted today -- no nudge needed
    return;
  }

  const cfg = getScheduleConfig();
  const now = new Date();
  const nudgeTime = new Date(now);
  nudgeTime.setHours(cfg.wakeHour, cfg.wakeMin + 30, 0, 0);

  const delayMs = nudgeTime.getTime() - now.getTime();
  if (delayMs <= 0) {
    // Already past nudge time -- check DB
    hasMorningGreeted().then((greeted) => {
      if (!greeted && !isUserAwake()) {
        fireWakeNudge();
      }
    });
    return;
  }

  console.log(`[SleepNudge] Wake nudge scheduled for ${nudgeTime.toLocaleTimeString()} (${Math.round(delayMs / 60000)}min)`);

  wakeNudgeTimer = setTimeout(() => {
    wakeNudgeTimer = null;
    hasMorningGreeted().then((greeted) => {
      if (!greeted && !isUserAwake()) {
        fireWakeNudge();
      }
    });
  }, delayMs);
}

function fireWakeNudge(): void {
  const name = getOwnerName();
  const message = `Time to get up ${name}!`;
  console.log(`[SleepNudge] Wake nudge: "${message}"`);

  try {
    const { DeviceEventEmitter } = require('react-native');
    DeviceEventEmitter.emit('pendantMessageAdded', {
      id: `m-wake-${Date.now()}`,
      role: 'mittens',
      text: message,
      timestamp: new Date(),
      source: 'pendant',
    });
  } catch { /* emit not available */ }

  try {
    const { speak } = require('../../services/ai/voiceService');
    speak(message);
  } catch { /* voice not available */ }

  markMorningGreeted();
}

// --- Bedtime Nudge Scheduling ---

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

  const cfg = getScheduleConfig();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // Already nudged today
  if (lastNudgeDate === today) {
    console.log('[SleepNudge] Already nudged today, skipping');
    return;
  }

  // Calculate trigger time (bedtime - lead time)
  const triggerTime = new Date(now);
  triggerTime.setHours(cfg.bedtimeHour, cfg.bedtimeMin, 0, 0);
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
        urgent: true
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

