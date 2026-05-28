/**
 * ambient/contextWindow.ts -- Rolling context for every triage call.
 *
 * Provides a rich snapshot of the user's current state: time, place,
 * motion, recent scenes, and the previous frame path for multi-image
 * VLM calls. This replaces ad-hoc context building scattered across
 * the pipeline.
 *
 * All state is in-memory (ring buffers) -- survives for the pendant
 * session but resets on app restart, which is fine.
 */

import type { ActivitySession } from './activitySession';

// =============================================
// TYPES
// =============================================

export interface ContextSnapshot {
  /** Formatted time: "3:41 PM, Monday" */
  time: string;
  /** Resolved place name (visual + GPS + geocode) */
  place: string | null;
  /** Motion sensor state */
  motion: string | null;
  /** Last 3 scene descriptions (ring buffer, newest last) */
  recentScenes: string[];
  /** File path of the previous processed frame (for multi-image VLM) */
  lastFramePath: string | null;
  /** Current activity session info */
  currentSession: ActivitySession | null;
  /** Visually recognized place name (from place embeddings) */
  visualPlace: string | null;
}

// =============================================
// STATE (in-memory ring buffers)
// =============================================

const MAX_RECENT_SCENES = 3;
let recentScenes: string[] = [];
let lastFramePath: string | null = null;

// =============================================
// PUBLIC API
// =============================================

/**
 * Build a context snapshot for the current triage call.
 *
 * @param place - Resolved place name (from resolvePlace or GPS)
 * @param visualPlace - Visually recognized place name (from place embeddings)
 */
export function getContextSnapshot(
  place: string | null = null,
  visualPlace: string | null = null,
): ContextSnapshot {
  // Format time
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const dayStr = now.toLocaleDateString('en-US', { weekday: 'long' });
  const time = `${timeStr}, ${dayStr}`;

  // Get motion state
  let motion: string | null = null;
  try {
    const { getLatestMotion } = require('./sensorFusion');
    const m = getLatestMotion();
    if (m?.type) motion = m.type;
  } catch { /* sensor fusion not loaded */ }

  // Get current activity session
  let currentSession: ActivitySession | null = null;
  try {
    const { getCurrentSession } = require('./activitySession');
    currentSession = getCurrentSession();
  } catch { /* activity session not loaded */ }

  return {
    time,
    place,
    motion,
    recentScenes: [...recentScenes],
    lastFramePath,
    currentSession,
    visualPlace,
  };
}

/** Push a new scene description into the ring buffer */
export function pushScene(description: string): void {
  if (!description) return;
  recentScenes.push(description);
  if (recentScenes.length > MAX_RECENT_SCENES) {
    recentScenes.shift();
  }
}

/** Update the last processed frame path */
export function setLastFrame(framePath: string): void {
  lastFramePath = framePath;
}

/** Get the last processed frame path */
export function getLastFrame(): string | null {
  return lastFramePath;
}

/** Reset context (e.g. on pendant disconnect) */
export function resetContext(): void {
  recentScenes = [];
  lastFramePath = null;
}
