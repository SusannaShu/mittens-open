/**
 * backgroundBreakTimer.ts -- Standalone background break timer.
 *
 * Runs TTS voice nudges and chat messages when a focus timer break fires,
 * even when the app is backgrounded. Works because the JS thread stays
 * alive via two entitlements that are already active:
 *   1. Background audio keepalive (silent loop in voiceService.ts)
 *   2. Background location updates (locationService.ts)
 *
 * This replaces the old approach where the break nudge lived inside a
 * React hook setInterval (which iOS suspends) and a notification listener
 * (which the user didn't want -- they want Mittens to just *talk*).
 *
 * How it works:
 *   - startGlobalTimer() calls scheduleBackgroundBreak()
 *   - scheduleBackgroundBreak() sets a plain setTimeout for the break interval
 *   - When the timeout fires, it speaks the nudge via TTS, saves a chat
 *     message, and re-schedules itself for the next break
 *   - stopGlobalTimer() calls cancelBackgroundBreak() to clear it
 *
 * The progressive nudge logic (escalating messages) is self-contained here.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveMittensMessage } from './schedule/alarmScheduler';
import { ActivityTypeService } from './activityTypeService';

const BREAK_COUNT_KEY = 'mittens_focus_timer_break_count';
const STORAGE_KEY = 'mittens_focus_timer_end';

// ─── State ───

let breakTimer: ReturnType<typeof setTimeout> | null = null;
let currentActivity: string = 'work';
let currentBreakIntervalMins: number = 45;

/** Track when the last break was handled so useFocusTimer's checkTimer()
 *  can skip its own TTS/chat if we already fired. */
let lastHandledBreakAt = 0;
export function getLastHandledBreakAt(): number {
  return lastHandledBreakAt;
}

// ─── Public API ───

/**
 * Schedule (or reschedule) the background break timer.
 * Called from startGlobalTimer() in useFocusTimer.ts.
 */
export function scheduleBackgroundBreak(
  activityName: string,
  breakIntervalMins: number,
): void {
  // Clear any existing timer
  cancelBackgroundBreak();

  currentActivity = activityName;
  currentBreakIntervalMins = breakIntervalMins;

  const delayMs = breakIntervalMins * 60 * 1000;
  console.log(`[BackgroundBreak] Scheduled in ${breakIntervalMins} min for "${activityName}"`);

  breakTimer = setTimeout(() => {
    fireBreakNudge();
  }, delayMs);
}

/**
 * Cancel the background break timer.
 * Called from stopGlobalTimer() in useFocusTimer.ts.
 */
export function cancelBackgroundBreak(): void {
  if (breakTimer) {
    clearTimeout(breakTimer);
    breakTimer = null;
  }
}

// ─── Break Nudge ───

async function fireBreakNudge(): Promise<void> {
  console.log('[BackgroundBreak] Break fired! Speaking nudge...');

  try {
    // Track break count
    let breakCount = 1;
    try {
      const countStr = await AsyncStorage.getItem(BREAK_COUNT_KEY);
      breakCount = countStr ? parseInt(countStr, 10) + 1 : 1;
    } catch {}
    await AsyncStorage.setItem(BREAK_COUNT_KEY, breakCount.toString());

    // Get break goals (activities tagged with "Mention in Break")
    let breakGoals: string[] = [];
    try {
      const allTypes = await ActivityTypeService.getAll();
      breakGoals = allTypes
        .filter(t => t.mentionDuringBreak)
        .map(t => t.label);
    } catch {}

    const goalsPhrase = breakGoals.length > 0
      ? breakGoals.join(' or ')
      : 'a stretch';

    // Build progressive nudge messages
    let ttsMsg: string;
    let chatMsg: string;

    if (breakCount === 1) {
      ttsMsg = `Susanna, time to take a break from ${currentActivity}. How about some ${goalsPhrase}?`;
      chatMsg = `Time to stretch! You've been doing ${currentActivity} for a while. How about some ${goalsPhrase}?`;
    } else if (breakCount === 2) {
      ttsMsg = `Hey Susanna, still going? Your body will thank you for some ${goalsPhrase}. Come on, just a quick set!`;
      chatMsg = `Still at it? Come on, just a quick round of ${goalsPhrase}. Your future self will thank you!`;
    } else {
      ttsMsg = `Susanna! That's ${breakCount} reminders now. Seriously, go do some ${goalsPhrase}. I'm not going to stop asking.`;
      chatMsg = `Reminder #${breakCount}. I'm not going away until you do some ${goalsPhrase}. Your back is begging you.`;
    }

    // Fire TTS -- this works in background because of the audio keepalive
    try {
      const { speak } = require('./ai/voiceService');
      speak(ttsMsg);
    } catch (ttsErr) {
      console.warn('[BackgroundBreak] TTS failed:', ttsErr);
    }

    // Save chat message
    saveMittensMessage(chatMsg, 'focus_timer_break');

    // Update the timer end timestamp for the next interval
    const nextEnd = Date.now() + currentBreakIntervalMins * 60 * 1000;
    await AsyncStorage.setItem(STORAGE_KEY, nextEnd.toString());

    // Mark so checkTimer() doesn't double-fire
    lastHandledBreakAt = Date.now();

    // Schedule next break
    scheduleBackgroundBreak(currentActivity, currentBreakIntervalMins);

    console.log(`[BackgroundBreak] Nudge #${breakCount} delivered, next in ${currentBreakIntervalMins} min`);
  } catch (err: any) {
    console.warn('[BackgroundBreak] Nudge failed:', err?.message);
    // Still try to schedule next break even if this one failed
    scheduleBackgroundBreak(currentActivity, currentBreakIntervalMins);
  }
}

/**
 * Restore a background break timer if one was active before the app was killed.
 * Call once at app boot. If the timer already expired while killed, fire immediately.
 */
export async function restoreBackgroundBreakIfNeeded(): Promise<void> {
  try {
    const endStr = await AsyncStorage.getItem(STORAGE_KEY);
    if (!endStr) return;

    const nameStr = await AsyncStorage.getItem('mittens_focus_timer_name');
    const activity = nameStr || 'work';

    // Read break interval from timer settings
    let breakMins = 45;
    try {
      const val = await AsyncStorage.getItem('mittens_focus_break_interval');
      if (val) breakMins = parseInt(val, 10) || 45;
    } catch {}

    const endMs = parseInt(endStr, 10);
    const remaining = endMs - Date.now();

    if (remaining > 0) {
      // Timer still running -- schedule the break
      currentActivity = activity;
      currentBreakIntervalMins = breakMins;

      console.log(`[BackgroundBreak] Restoring timer, ${Math.round(remaining / 1000)}s remaining`);
      breakTimer = setTimeout(() => {
        fireBreakNudge();
      }, remaining);
    } else {
      // Timer expired while app was killed -- fire immediately
      currentActivity = activity;
      currentBreakIntervalMins = breakMins;
      console.log('[BackgroundBreak] Timer expired while app was killed, firing now');
      fireBreakNudge();
    }
  } catch (err: any) {
    console.warn('[BackgroundBreak] Restore failed:', err?.message);
  }
}
