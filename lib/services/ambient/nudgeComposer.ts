/**
 * ambient/nudgeComposer.ts -- Unified nudge delivery system.
 *
 * Composes and delivers proactive voice/visual nudges from the ambient
 * pipeline. All nudges flow through here so we can:
 *   - Rate-limit (no more than 1 nudge per 5 min)
 *   - Respect quiet hours
 *   - Track delivery for debug trace
 *
 * Nudge types:
 *   wakeup      -- morning alarm, pendant not worn / user not up
 *   sedentary   -- sitting too long at desk
 *   cook_done   -- food timer expired
 *   meal_remind -- no meal logged by expected time
 *   bedtime     -- sleep hygiene reminder
 *   low_pantry  -- pantry item running low
 */

/** Minimum gap between any two nudges (ms) */
const NUDGE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/** Quiet hours: no nudges between these hours */
const QUIET_START_HOUR = 22; // 10pm
const QUIET_END_HOUR = 6;   // 6am (wakeup bypasses this)

let lastNudgeAt = 0;

export type NudgeType =
  | 'wakeup'
  | 'sedentary'
  | 'cook_done'
  | 'meal_remind'
  | 'bedtime'
  | 'sleep_nudge'
  | 'low_pantry';

interface NudgeRequest {
  type: NudgeType;
  message: string;
  /** If true, bypasses quiet hours (only wakeup should do this) */
  urgent?: boolean;
}

/**
 * Deliver a nudge. Speaks via TTS and logs to console.
 * Returns true if delivered, false if suppressed by rate limit or quiet hours.
 */
export function deliverNudge(request: NudgeRequest): boolean {
  const now = Date.now();

  // Rate limit check
  if (now - lastNudgeAt < NUDGE_COOLDOWN_MS) {
    console.log(
      `[Nudge] Suppressed ${request.type}: cooldown (${Math.round((NUDGE_COOLDOWN_MS - (now - lastNudgeAt)) / 1000)}s left)`,
    );
    return false;
  }

  // Quiet hours check (wakeup bypasses)
  if (!request.urgent && isQuietHours()) {
    console.log(`[Nudge] Suppressed ${request.type}: quiet hours`);
    return false;
  }

  // Deliver via TTS
  try {
    const { speak } = require('../../services/ai/voiceService');
    speak(request.message);
    lastNudgeAt = now;
    console.log(`[Nudge] Delivered ${request.type}: "${request.message}"`);
    return true;
  } catch (err: any) {
    console.warn(`[Nudge] TTS failed for ${request.type}:`, err?.message);
    return false;
  }
}

// ---- Pre-built nudge templates ----

export function nudgeWakeup(userName: string = 'Susanna'): boolean {
  return deliverNudge({
    type: 'wakeup',
    message: `${userName}, it's time to wake up and get some morning light.`,
    urgent: true,
  });
}

export function nudgeSedentary(minutesSitting: number): boolean {
  return deliverNudge({
    type: 'sedentary',
    message: `You've been sitting for ${minutesSitting} minutes. Time for a quick stretch or walk.`,
  });
}

export function nudgeCookDone(method: string): boolean {
  return deliverNudge({
    type: 'cook_done',
    message: `Your ${method} should be done. Time to check on it.`,
  });
}

export function nudgeMealRemind(mealType: string): boolean {
  return deliverNudge({
    type: 'meal_remind',
    message: `It's getting late for ${mealType}. Have you eaten yet?`,
  });
}

export function nudgeBedtime(customMessage?: string): boolean {
  return deliverNudge({
    type: 'bedtime',
    message: customMessage || 'Time to start winding down. Consider dimming the lights and putting screens away.',
  });
}

export function nudgeLowPantry(itemName: string): boolean {
  return deliverNudge({
    type: 'low_pantry',
    message: `You're running low on ${itemName}. You might want to add it to your shopping list.`,
  });
}

// ---- Helpers ----

function isQuietHours(): boolean {
  const hour = new Date().getHours();
  if (QUIET_START_HOUR > QUIET_END_HOUR) {
    // Wraps midnight: e.g. 22-6
    return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
  }
  return hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR;
}

/** Reset cooldown (for testing) */
export function resetNudgeCooldown(): void {
  lastNudgeAt = 0;
}
