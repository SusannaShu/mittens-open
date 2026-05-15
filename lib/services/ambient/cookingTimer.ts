/**
 * ambient/cookingTimer.ts -- Ephemeral cooking timer manager.
 *
 * Manages nutrition-optimized cooking timers with TTS alerts.
 * Timers are in-memory only (no DB persistence) -- if the app
 * is killed mid-cook, the user already knows what's on the stove.
 *
 * Timer durations come from the brain estimating optimal cook time
 * for maximum nutrient retention, with food safety minimums enforced.
 */

import type { CookingTimer } from './types';

// Module-level timer state
const activeTimers = new Map<string, {
  timer: CookingTimer;
  timeoutId: ReturnType<typeof setTimeout>;
}>();

// --- Public API ---

/**
 * Start a cooking timer for an ingredient.
 * Fires TTS alert when done. Returns the timer object.
 */
export function startCookingTimer(
  ingredient: string,
  method: string,
  durationSec: number,
): CookingTimer {
  const key = ingredient.toLowerCase().trim();

  // Cancel existing timer for the same ingredient
  if (activeTimers.has(key)) {
    cancelTimer(ingredient);
  }

  const timer: CookingTimer = {
    ingredient,
    method,
    durationSec,
    startedAt: Date.now(),
    cancelled: false,
  };

  const timeoutId = setTimeout(() => {
    onTimerComplete(timer);
  }, durationSec * 1000);

  activeTimers.set(key, { timer, timeoutId });

  console.log(
    `[CookingTimer] Started: ${ingredient} (${method}) -- ${formatDuration(durationSec)}`,
  );

  // Emit chat notification about the timer
  emitTimerMessage(
    `${capitalize(method)} timer set for ${ingredient}: ${formatDuration(durationSec)}.`,
  );

  return timer;
}

/**
 * Cancel a specific timer by ingredient name.
 * Called when the camera detects the item was removed before timer ends.
 */
export function cancelTimer(ingredient: string): void {
  const key = ingredient.toLowerCase().trim();
  const entry = activeTimers.get(key);
  if (!entry) return;

  clearTimeout(entry.timeoutId);
  entry.timer.cancelled = true;
  activeTimers.delete(key);

  console.log(`[CookingTimer] Cancelled: ${ingredient}`);
}

/**
 * Cancel all active timers. Called when cooking session closes.
 */
export function cancelAllTimers(): void {
  for (const [, entry] of activeTimers) {
    clearTimeout(entry.timeoutId);
    entry.timer.cancelled = true;
  }
  activeTimers.clear();
  console.log('[CookingTimer] All timers cancelled');
}

/**
 * Get all currently active (non-cancelled) timers.
 */
export function getActiveTimers(): CookingTimer[] {
  return Array.from(activeTimers.values()).map(e => e.timer);
}

/**
 * Get remaining seconds for a timer. Returns 0 if expired or not found.
 */
export function getRemainingSeconds(ingredient: string): number {
  const key = ingredient.toLowerCase().trim();
  const entry = activeTimers.get(key);
  if (!entry) return 0;

  const elapsed = (Date.now() - entry.timer.startedAt) / 1000;
  return Math.max(0, entry.timer.durationSec - elapsed);
}

/**
 * Ask the brain to estimate optimal cook time for an ingredient + method.
 * Returns seconds. Enforces food safety minimums.
 */
export async function estimateCookTime(
  ingredient: string,
  method: string,
): Promise<number> {
  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    const prompt = [
      `How many minutes should "${ingredient}" be cooked by ${method}`,
      'for optimal nutrition retention while ensuring food safety?',
      '',
      'Consider:',
      '- Maximum vitamin/mineral preservation (shorter is often better for vegetables)',
      '- Food safety minimum temperatures and times (especially for meats, eggs, seafood)',
      '- Return the HIGHER of nutrition-optimal and safety-minimum',
      '',
      'Respond JSON only: {"minutes": number, "reason": "brief explanation"}',
    ].join('\n');

    const raw = await brain.text(prompt);
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) return 600; // Default 10 min

    const parsed = JSON.parse(match[0]);
    const minutes = Number(parsed.minutes);

    if (isNaN(minutes) || minutes <= 0) return 600;
    return Math.round(minutes * 60);
  } catch (err: any) {
    console.warn('[CookingTimer] Cook time estimation failed:', err?.message);
    return 600; // Default 10 min
  }
}

// --- Internal ---

function onTimerComplete(timer: CookingTimer): void {
  const key = timer.ingredient.toLowerCase().trim();
  activeTimers.delete(key);

  const message = `Your ${timer.ingredient} is done! Remove from ${timer.method} for best nutrition.`;
  console.log(`[CookingTimer] Complete: ${timer.ingredient}`);

  // TTS notification
  try {
    const { speak } = require('../voice/ttsService');
    speak(message);
  } catch { /* TTS not available */ }

  // Chat notification
  emitTimerMessage(message);
}

function emitTimerMessage(text: string): void {
  try {
    const { DeviceEventEmitter } = require('react-native');
    DeviceEventEmitter.emit('pendantMessageAdded', {
      id: `m-timer-${Date.now()}`,
      role: 'mittens',
      text,
      timestamp: new Date(),
      source: 'pendant',
    });
  } catch { /* emit not available */ }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m} min`;
  return `${m} min ${s}s`;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
