/**
 * ambient/activitySession.ts -- Time-based activity session manager.
 *
 * Replaces scene-count-based activity logging with duration-based sessions.
 * Going to the restroom for 2 minutes doesn't create a new activity.
 *
 * Session lifecycle:
 *   - START: new activity type detected (or first frame)
 *   - CONTINUE: same activity type → update duration, no new DB row
 *   - TRANSIENT: different type for <5 min → session continues (restroom, hallway)
 *   - END: different type for >5 min, or no frames for >30 min
 *
 * Only logs health/life-relevant events:
 *   - Walking/running/cycling → MET + AEIOU + location
 *   - Eating → nutrition pipeline handles this
 *   - Stationary >30min outside home → location log
 *   - Working → can trigger timer via timerAutoStop
 */

import type { SceneTriage } from './types';

// =============================================
// CONFIGURATION
// =============================================

/** Ignore activity type changes shorter than this (restroom trips, hallway walks) */
const TRANSIENT_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** Close session if no confirming frames for this long */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/** Minimum session duration before creating a DB log */
const MIN_LOG_DURATION_MS = 2 * 60 * 1000; // 2 minutes

// =============================================
// TYPES
// =============================================

export interface ActivitySession {
  /** Inferred activity type */
  type: string;
  /** When the session started (epoch ms) */
  startedAt: number;
  /** Current/last known place name */
  place: string | null;
  /** DB activity_logs row ID (created after MIN_LOG_DURATION) */
  logId: number | null;
  /** Last frame timestamp (epoch ms) */
  lastFrameAt: number;
  /** Number of frames that confirmed this session */
  frameCount: number;
}

export interface SessionUpdateResult {
  /** What happened: created, updated, continued (transient), or none */
  action: 'created' | 'updated' | 'continued' | 'none';
  /** Activity log ID if one was created or exists */
  logId: number | null;
}

// =============================================
// STATE
// =============================================

let currentSession: ActivitySession | null = null;
let transientStart: number | null = null;
let transientType: string | null = null;

// =============================================
// PUBLIC API
// =============================================

/**
 * Called on every triage result. Manages session lifecycle.
 *
 * @param activityType - Inferred activity type from triage signals
 * @param place - Resolved place name (from visual + GPS)
 * @param triage - Full triage result for signal access
 * @param framePath - Current frame path
 * @returns What happened and the activity log ID
 */
export function updateSession(
  activityType: string,
  place: string | null,
  triage: SceneTriage,
  framePath: string,
): SessionUpdateResult {
  const now = Date.now();

  // Check if current session has timed out
  if (currentSession && (now - currentSession.lastFrameAt > SESSION_TIMEOUT_MS)) {
    console.log(`[ActivitySession] Session timed out after ${Math.round((now - currentSession.lastFrameAt) / 60000)}min`);
    closeSession();
  }

  // No current session → start a new one
  if (!currentSession) {
    return startSession(activityType, place, triage, framePath, now);
  }

  // Same activity type → update existing session
  if (isSameActivity(currentSession.type, activityType)) {
    transientStart = null;
    transientType = null;
    return updateExistingSession(place, triage, framePath, now);
  }

  // Different activity type → check if transient
  if (!transientStart) {
    // First frame of potential new activity
    transientStart = now;
    transientType = activityType;
    console.log(`[ActivitySession] Potential change: ${currentSession.type} → ${activityType} (monitoring...)`);
    return { action: 'continued', logId: currentSession.logId };
  }

  // Already in transient state
  if (transientType === activityType) {
    const elapsed = now - transientStart;
    if (elapsed < TRANSIENT_THRESHOLD_MS) {
      // Still within threshold → treat as transient (restroom break)
      console.log(`[ActivitySession] Transient: ${activityType} for ${Math.round(elapsed / 1000)}s (< ${TRANSIENT_THRESHOLD_MS / 1000}s threshold)`);
      return { action: 'continued', logId: currentSession.logId };
    }

    // Exceeded threshold → this IS a new activity. Close old, start new.
    console.log(`[ActivitySession] Activity changed: ${currentSession.type} → ${activityType} (sustained ${Math.round(elapsed / 1000)}s)`);
    finalizeSession(now);
    transientStart = null;
    transientType = null;
    return startSession(activityType, place, triage, framePath, now);
  }

  // Different transient type — reset transient tracking
  transientStart = now;
  transientType = activityType;
  return { action: 'continued', logId: currentSession.logId };
}

/** Get current session info (for context window) */
export function getCurrentSession(): ActivitySession | null {
  return currentSession;
}

/** Force-close the current session (e.g. app background, pendant disconnect) */
export function closeSession(): void {
  if (currentSession) {
    finalizeSession(Date.now());
  }
  currentSession = null;
  transientStart = null;
  transientType = null;
}

// =============================================
// INTERNAL
// =============================================

function startSession(
  activityType: string,
  place: string | null,
  triage: SceneTriage,
  _framePath: string,
  now: number,
): SessionUpdateResult {
  // Only create DB log for health/life-relevant activities
  if (!shouldLog(activityType, triage)) {
    console.log(`[ActivitySession] Not logging: ${activityType} (not health/life relevant)`);
    currentSession = {
      type: activityType,
      startedAt: now,
      place,
      logId: null,
      lastFrameAt: now,
      frameCount: 1,
    };
    return { action: 'none', logId: null };
  }

  currentSession = {
    type: activityType,
    startedAt: now,
    place,
    logId: null, // Log created after MIN_LOG_DURATION
    lastFrameAt: now,
    frameCount: 1,
  };

  console.log(`[ActivitySession] Started: ${activityType} at ${place || 'unknown'}`);
  return { action: 'created', logId: null };
}

function updateExistingSession(
  place: string | null,
  _triage: SceneTriage,
  _framePath: string,
  now: number,
): SessionUpdateResult {
  if (!currentSession) return { action: 'none', logId: null };

  currentSession.lastFrameAt = now;
  currentSession.frameCount++;
  if (place) currentSession.place = place;

  const elapsed = now - currentSession.startedAt;

  // Create DB log once session exceeds MIN_LOG_DURATION
  if (!currentSession.logId && elapsed >= MIN_LOG_DURATION_MS) {
    const logId = createActivityLogForSession(currentSession);
    currentSession.logId = logId;
    console.log(`[ActivitySession] Created log #${logId} for ${currentSession.type} (${Math.round(elapsed / 60000)}min)`);
    return { action: 'created', logId };
  }

  // Update existing DB log duration
  if (currentSession.logId) {
    const durationMin = Math.max(1, Math.round(elapsed / 60000));
    updateActivityLogDuration(currentSession.logId, durationMin, place);
    return { action: 'updated', logId: currentSession.logId };
  }

  return { action: 'continued', logId: null };
}

function finalizeSession(now: number): void {
  if (!currentSession) return;

  const elapsed = now - currentSession.startedAt;
  const durationMin = Math.max(1, Math.round(elapsed / 60000));

  if (currentSession.logId) {
    updateActivityLogDuration(currentSession.logId, durationMin, currentSession.place);
    console.log(`[ActivitySession] Finalized log #${currentSession.logId}: ${currentSession.type}, ${durationMin}min`);
  } else if (elapsed >= MIN_LOG_DURATION_MS && shouldLog(currentSession.type, null)) {
    // Session was long enough but never got a log — create one now
    const logId = createActivityLogForSession(currentSession);
    if (logId) {
      updateActivityLogDuration(logId, durationMin, currentSession.place);
      console.log(`[ActivitySession] Late-created log #${logId}: ${currentSession.type}, ${durationMin}min`);
    }
  }

  currentSession = null;
}

/**
 * Determine if two activity types are essentially the same.
 * "walking" and "walking" are the same. "screen_use" and "working" are the same.
 */
function isSameActivity(a: string, b: string): boolean {
  if (a === b) return true;
  // Group related types
  const screenTypes = new Set(['screen_use', 'working', 'studying', 'desk_work']);
  const moveTypes = new Set(['walking', 'strolling']);
  if (screenTypes.has(a) && screenTypes.has(b)) return true;
  if (moveTypes.has(a) && moveTypes.has(b)) return true;
  return false;
}

/**
 * Decide if this activity type is worth logging.
 * Only health and life-relevant activities create DB rows.
 */
function shouldLog(activityType: string, triage: SceneTriage | null): boolean {
  // Always log: movement activities (MET tracking)
  const movementTypes = new Set(['walking', 'running', 'cycling', 'hiking', 'exercising', 'gym']);
  if (movementTypes.has(activityType)) return true;

  // Always log: eating/cooking (handled by nutrition pipeline, but mark as loggable)
  const nutritionTypes = new Set(['eating', 'cooking']);
  if (nutritionTypes.has(activityType)) return true;

  // Log: outdoor activities (nature/vitamin D tracking)
  if (triage?.signals.outdoors) return true;

  // Log: social activities (AEIOU tracking)
  if (triage && triage.people > 0) return true;

  // Don't log: generic screen use, sitting at home, hallway, restroom
  return false;
}

function createActivityLogForSession(session: ActivitySession): number | null {
  try {
    const { getDb } = require('../../database');
    const db = getDb();

    const verb = session.type.charAt(0).toUpperCase() + session.type.slice(1);
    const logName = session.place ? `${verb} at ${session.place}` : verb;
    const durationMin = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));

    // Look up MET for activity type
    const MET_VALUES: Record<string, number> = {
      walking: 3.5, running: 8.0, cycling: 7.5, hiking: 6.0,
      exercising: 5.0, gym: 5.0, cooking: 2.5, eating: 1.5,
    };
    const mets = MET_VALUES[session.type] || 2.0;

    const result = db.runSync(
      `INSERT INTO activity_logs (
        logged_at, log_name, activity_type, duration_min, mets,
        location, source, outdoors, is_nature,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pendant', 0, 0, datetime('now'), datetime('now'))`,
      [
        new Date(session.startedAt).toISOString(),
        logName,
        session.type,
        durationMin,
        mets,
        session.place,
      ],
    );

    return result?.lastInsertRowId ?? null;
  } catch (err: any) {
    console.warn('[ActivitySession] Failed to create log:', err?.message);
    return null;
  }
}

function updateActivityLogDuration(logId: number, durationMin: number, place: string | null): void {
  try {
    const { getDb } = require('../../database');
    const db = getDb();

    if (place) {
      const verb = ''; // Keep existing log_name unless place changed
      db.runSync(
        `UPDATE activity_logs SET duration_min = ?, location = ?, updated_at = datetime('now') WHERE id = ?`,
        [durationMin, place, logId],
      );
    } else {
      db.runSync(
        `UPDATE activity_logs SET duration_min = ?, updated_at = datetime('now') WHERE id = ?`,
        [durationMin, logId],
      );
    }
  } catch (err: any) {
    console.warn('[ActivitySession] Failed to update log:', err?.message);
  }
}

/**
 * Infer activity type from triage signals.
 * Maps raw signals to normalized activity types for session management.
 */
export function inferActivityType(triage: SceneTriage): string {
  // Movement first
  if (triage.signals.movement) {
    return triage.signals.movementType || 'walking';
  }

  // Food context
  if (triage.signals.foodContext === 'eating') return 'eating';
  if (triage.signals.foodContext === 'cooking') return 'cooking';

  // Screen use
  if (triage.signals.screenUse) return 'screen_use';

  // Generic
  return 'stationary';
}
