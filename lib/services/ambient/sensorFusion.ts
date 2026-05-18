/**
 * sensorFusion.ts -- Cross-validates pendant (eyes) vs GPS (compass) signals.
 *
 * The pendant captures are the visual "ground truth" that override GPS/motion
 * when they conflict. This module provides validation functions called by
 * the locationSessionBuilder to:
 *   - Gate trail creation (prevent false movement when user is at desk)
 *   - End trails (arrived at destination)
 *   - Delete poisoned location sessions (transit reported while at desk)
 */

import { getTodayCaptures, type PendantCapture } from '../pendant/pendantStore';

// ─── Types ───

export interface VisualContext {
  /** Whether the user is in front of a screen */
  screenUse: boolean;
  /** Whether the user is outdoors */
  outdoors: boolean;
  /** Whether the user is in physical motion */
  movement: boolean;
  /** Specific movement type if detected */
  movementType?: string;
  /** Whether the user is in nature */
  nature: boolean;
  /** How many recent captures contributed */
  captureCount: number;
  /** Age of the most recent capture in ms */
  ageMs: number;
  /** Confidence: 'high' if multiple recent captures agree, 'low' otherwise */
  confidence: 'high' | 'low' | 'none';
}

export interface FusionDecision {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Reason for the decision */
  reason: string;
  /** Visual context used for the decision */
  visualContext: VisualContext | null;
}

// ─── Constants ───

/** Maximum age of pendant captures to consider (5 minutes) */
const VISUAL_WINDOW_MS = 5 * 60 * 1000;

/** Minimum captures needed for high confidence */
const HIGH_CONFIDENCE_COUNT = 2;

// ─── Public API ───

/**
 * Get the most recent visual context from pendant captures.
 * Returns null if no recent captures exist within the window.
 */
export function getRecentVisualContext(
  withinMs: number = VISUAL_WINDOW_MS,
): VisualContext | null {
  const now = Date.now();
  const captures = getTodayCaptures()
    .filter(c => c.triageSignals && c.timestamp >= now - withinMs)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (captures.length === 0) return null;

  // Use majority vote from recent captures
  const latest = captures[0];
  const signals = latest.triageSignals!;
  const ageMs = now - latest.timestamp;

  // For high confidence, check agreement among recent captures
  let confidence: 'high' | 'low' | 'none' = 'low';
  if (captures.length >= HIGH_CONFIDENCE_COUNT) {
    const screenVotes = captures.filter(c => c.triageSignals?.screenUse).length;
    const outdoorVotes = captures.filter(c => c.triageSignals?.outdoors).length;
    const total = captures.length;

    // If signals agree (>= 2/3 majority), high confidence
    const screenAgreement = screenVotes / total >= 0.67 || (total - screenVotes) / total >= 0.67;
    const outdoorAgreement = outdoorVotes / total >= 0.67 || (total - outdoorVotes) / total >= 0.67;
    if (screenAgreement && outdoorAgreement) {
      confidence = 'high';
    }
  }

  return {
    screenUse: signals.screenUse,
    outdoors: signals.outdoors,
    movement: signals.movement,
    movementType: signals.movementType,
    nature: signals.nature,
    captureCount: captures.length,
    ageMs,
    confidence,
  };
}

/**
 * Should a new movement trail be started?
 * Called by locationSessionBuilder before creating a movement session.
 *
 * Logic:
 *   - If pendant shows screen use (indoors at desk) --> DENY (GPS is lying)
 *   - If pendant shows outdoors/movement --> ALLOW (visual confirms)
 *   - If no recent captures (pendant dormant) --> ALLOW (legacy behavior)
 */
export function shouldStartTrail(
  motionType: string,
  _lat?: number,
  _lon?: number,
): FusionDecision {
  const visual = getRecentVisualContext();

  if (!visual) {
    return {
      allowed: true,
      reason: 'No recent pendant captures -- allowing trail (legacy behavior)',
      visualContext: null,
    };
  }

  // User is at their screen -- GPS movement is false positive
  if (visual.screenUse && visual.confidence === 'high') {
    return {
      allowed: false,
      reason: `Trail denied: pendant shows screen use (${visual.captureCount} captures, ${Math.round(visual.ageMs / 1000)}s ago)`,
      visualContext: visual,
    };
  }

  // User is outdoors or moving -- visual confirms GPS
  if (visual.outdoors || visual.movement) {
    return {
      allowed: true,
      reason: `Trail confirmed: pendant shows ${visual.outdoors ? 'outdoors' : 'movement'} (${motionType})`,
      visualContext: visual,
    };
  }

  // Indoor, not at screen, not moving -- allow with low confidence
  // (could be transitioning, e.g. putting on shoes)
  return {
    allowed: true,
    reason: 'Pendant shows indoor/stationary but not at screen -- allowing trail with low confidence',
    visualContext: visual,
  };
}

/**
 * Should an active trail be ended?
 * Called when the user goes stationary after movement.
 *
 * Logic:
 *   - If pendant shows indoors --> END (arrived at destination)
 *   - If pendant shows outdoors + movement --> KEEP (still moving)
 *   - If pendant shows outdoors + stationary --> END (stopped outdoors)
 */
export function shouldEndTrail(): FusionDecision {
  const visual = getRecentVisualContext();

  if (!visual) {
    return {
      allowed: true, // "allowed" = allowed to end
      reason: 'No recent pendant captures -- allowing trail end (legacy behavior)',
      visualContext: null,
    };
  }

  // User went indoors
  if (!visual.outdoors) {
    return {
      allowed: true,
      reason: 'Pendant shows indoors -- trail ended (arrived at destination)',
      visualContext: visual,
    };
  }

  // Still outdoors and moving
  if (visual.outdoors && visual.movement) {
    return {
      allowed: false,
      reason: 'Pendant shows outdoors + movement -- keep trail active',
      visualContext: visual,
    };
  }

  // Outdoors but stationary
  return {
    allowed: true,
    reason: 'Pendant shows outdoors + stationary -- trail ended',
    visualContext: visual,
  };
}

/**
 * Validate a closed location session against pendant captures.
 * Returns true if the session should be DELETED (poisoned data).
 *
 * Logic:
 *   - If session says "transit"/"walking"/"running" but ALL captures
 *     during that window show "desk/screen" --> DELETE (false GPS data)
 *   - Mixed signals (some outdoor, some indoor) --> KEEP (genuine transition)
 *   - No captures during session --> KEEP (can't verify, don't delete)
 */
export function shouldDeleteSession(
  motionType: string,
  startedAtMs: number,
  endedAtMs: number,
): { shouldDelete: boolean; reason: string } {
  // Only validate movement sessions (transit, walking, running, cycling)
  const movementTypes = ['transit', 'walking', 'running', 'cycling', 'driving'];
  if (!movementTypes.includes(motionType)) {
    return { shouldDelete: false, reason: 'Stationary session -- no validation needed' };
  }

  const captures = getTodayCaptures()
    .filter(c => c.triageSignals && c.timestamp >= startedAtMs && c.timestamp <= endedAtMs);

  if (captures.length === 0) {
    return { shouldDelete: false, reason: 'No captures during session -- keeping (unverifiable)' };
  }

  // Check if ALL captures show screen use (contradicts movement)
  const screenCaptures = captures.filter(c => c.triageSignals?.screenUse);
  const indoorStationary = captures.filter(c => !c.triageSignals?.outdoors && !c.triageSignals?.movement);

  if (screenCaptures.length === captures.length) {
    return {
      shouldDelete: true,
      reason: `All ${captures.length} captures show screen use during "${motionType}" session -- deleting false data`,
    };
  }

  if (indoorStationary.length === captures.length && captures.length >= 2) {
    return {
      shouldDelete: true,
      reason: `All ${captures.length} captures show indoor/stationary during "${motionType}" session -- deleting false data`,
    };
  }

  // Mixed signals -- genuine transition (e.g., user walked from desk to car)
  return {
    shouldDelete: false,
    reason: `Mixed signals (${screenCaptures.length}/${captures.length} screen) -- keeping session`,
  };
}
