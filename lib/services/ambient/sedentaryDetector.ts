/**
 * ambient/sedentaryDetector.ts -- At-home sedentary detection.
 *
 * When the pendant captures a frame at home, checks if the user is
 * sitting, laying down, or using a screen. If so and no timer is
 * running, auto-starts a focus timer with TTS readout.
 *
 * Uses the user's configured break interval (from useFocusTimer)
 * unless an explicit duration is provided via voice command.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { FOCUS_TIMER_STORAGE_KEY } from '../../../hooks/useFocusTimer';

// --- State ---

let lastAutoStartAt = 0;
const AUTO_START_COOLDOWN_MS = 30 * 60 * 1000; // 30 min between auto-starts

// --- Types ---

export interface SedentaryResult {
  detected: boolean;
  posture: 'sitting' | 'laying' | 'standing' | 'unknown';
  screenUse: boolean;
  timerStarted: boolean;
}

// --- Public API ---

/**
 * Check if the user is sedentary at home from a pendant frame.
 * If detected and no timer running, emits auto-start event.
 */
export async function checkSedentaryState(
  framePath: string,
): Promise<SedentaryResult> {
  const fallback: SedentaryResult = {
    detected: false,
    posture: 'unknown',
    screenUse: false,
    timerStarted: false,
  };

  // Guard: cooldown
  if (Date.now() - lastAutoStartAt < AUTO_START_COOLDOWN_MS) {
    return fallback;
  }

  // Guard: timer already running
  if (await isTimerRunning()) return fallback;

  // VLM detection
  const detection = await detectSedentary(framePath);
  if (!detection.detected) return detection;

  // Auto-start timer
  lastAutoStartAt = Date.now();

  // Read user's configured break interval
  const breakMin = await getBreakInterval();
  const activityLabel = detection.screenUse ? 'screen time' : 'sedentary';

  emitAutoTimer(activityLabel, breakMin);
  emitReadout(`Starting ${activityLabel} timer of ${breakMin} minutes.`);

  return { ...detection, timerStarted: true };
}

/**
 * Trigger sedentary timer from a pre-computed signal (no VLM call).
 * Called by sceneStreamManager when triage detects screenUse at home.
 */
export async function triggerFromSignal(
  screenUse: boolean,
): Promise<SedentaryResult> {
  const fallback: SedentaryResult = {
    detected: false,
    posture: 'unknown',
    screenUse: false,
    timerStarted: false,
  };

  if (!screenUse) return fallback;

  // Guard: cooldown
  if (Date.now() - lastAutoStartAt < AUTO_START_COOLDOWN_MS) {
    return fallback;
  }

  // Guard: timer already running
  if (await isTimerRunning()) return fallback;

  lastAutoStartAt = Date.now();
  const breakMin = await getBreakInterval();

  emitAutoTimer('screen time', breakMin);
  emitReadout(`Starting screen time timer of ${breakMin} minutes.`);

  return {
    detected: true,
    posture: 'sitting',
    screenUse: true,
    timerStarted: true,
  };
}

// --- Detection ---

async function detectSedentary(framePath: string): Promise<SedentaryResult> {
  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    if (!brain.supportsVision) {
      return { detected: false, posture: 'unknown', screenUse: false, timerStarted: false };
    }

    const prompt = [
      'A wearable camera photo taken at home. Is the person:',
      '1. Sitting at a desk or couch?',
      '2. Laying down?',
      '3. Using a screen (laptop, phone, tablet)?',
      '',
      'Return JSON only:',
      '{"sedentary": true/false, "posture": "sitting"|"laying"|"standing", "screen": true/false}',
    ].join('\n');

    const raw = await brain.vision(prompt, [framePath]);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return { detected: false, posture: 'unknown', screenUse: false, timerStarted: false };
    }

    const parsed = JSON.parse(match[0]);
    return {
      detected: Boolean(parsed.sedentary),
      posture: parsed.posture === 'sitting' ? 'sitting'
        : parsed.posture === 'laying' ? 'laying'
        : parsed.posture === 'standing' ? 'standing'
        : 'unknown',
      screenUse: Boolean(parsed.screen),
      timerStarted: false,
    };
  } catch (err: any) {
    console.warn('[SedentaryDetector] Detection failed:', err?.message);
    return { detected: false, posture: 'unknown', screenUse: false, timerStarted: false };
  }
}

// --- Helpers ---

async function isTimerRunning(): Promise<boolean> {
  try {
    const endStr = await AsyncStorage.getItem(FOCUS_TIMER_STORAGE_KEY);
    if (!endStr) return false;
    return parseInt(endStr, 10) > Date.now();
  } catch {
    return false;
  }
}

/** Read user's break interval from timer settings. Default 45 min. */
async function getBreakInterval(): Promise<number> {
  try {
    const val = await AsyncStorage.getItem('mittens_focus_break_interval');
    if (val) return parseInt(val, 10) || 45;
  } catch { /* fallback */ }
  return 45;
}

function emitAutoTimer(category: string, durationMin: number): void {
  try {
    const { DeviceEventEmitter } = require('react-native');
    DeviceEventEmitter.emit('autoStartTimer', {
      category,
      name: category,
      durationMin,
    });
  } catch { /* emit not available */ }
}

function emitReadout(text: string): void {
  try {
    const { speak } = require('../voice/ttsService');
    speak(text);
  } catch { /* TTS not available */ }
}
