/**
 * Motion Service -- Native Activity Recognition wrapper.
 *
 * Subscribes to platform-native motion detection:
 *   iOS: CMMotionActivityManager (M7+ coprocessor)
 *   Android: Activity Recognition Transition API
 *
 * Provides current motion state to locationService for
 * accurate motionType on every location log.
 *
 * NOTE on payload shape:
 *   react-native-motion-activity-tracker emits
 *     { events: ActivityChangeEvent[] }
 *   where each event has { activityType, transitionType, confidence, timestamp }.
 *   We pick the highest-confidence ENTER transition from each batch.
 *   The library's own confidence ('LOW'|'MEDIUM'|'HIGH'|'UNKNOWN') is preserved
 *   so downstream code can gate on it -- low-confidence walk events from
 *   phone fidgeting can be ignored.
 */

import { Platform } from 'react-native';

export type MotionType =
  | 'stationary'
  | 'walking'
  | 'running'
  | 'cycling'
  | 'driving'
  | 'unknown';

export type MotionConfidence = 'low' | 'medium' | 'high';

export interface MotionState {
  type: MotionType;
  confidence: MotionConfidence;
  timestamp: number;
  source: 'activity_recognition' | 'gps_speed';
}

let currentMotion: MotionState = {
  type: 'unknown',
  confidence: 'low',
  timestamp: 0,
  source: 'activity_recognition',
};

let subscription: { remove: () => void } | null = null;
let motionCallbacks: Array<(state: MotionState) => void> = [];

const ACTIVITY_TYPE_TO_MOTION: Record<string, MotionType> = {
  WALKING: 'walking',
  RUNNING: 'running',
  AUTOMOTIVE: 'driving',
  CYCLING: 'cycling',
  STATIONARY: 'stationary',
  UNKNOWN: 'unknown',
};

const CONFIDENCE_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

function mapConfidence(c: string | undefined | null): MotionConfidence {
  const u = (c || '').toUpperCase();
  if (u === 'HIGH') return 'high';
  if (u === 'MEDIUM') return 'medium';
  return 'low';
}

interface ActivityChangeEventLike {
  activityType?: string;
  transitionType?: string;
  confidence?: string;
  timestamp?: number;
}

/**
 * From a batch of ActivityChangeEvents, pick the most-trustworthy ENTER
 * transition. Returns null if no ENTER transitions in the batch.
 *
 * Preference order: HIGH > MEDIUM > LOW > UNKNOWN confidence, then most recent.
 */
function selectActivity(events: ActivityChangeEventLike[]): {
  type: MotionType;
  confidence: MotionConfidence;
  timestamp: number;
} | null {
  if (!events || events.length === 0) return null;
  const enters = events.filter((e) => (e.transitionType || '').toUpperCase() === 'ENTER');
  if (enters.length === 0) return null;

  enters.sort((a, b) => {
    const ar = CONFIDENCE_RANK[(a.confidence || '').toUpperCase()] || 0;
    const br = CONFIDENCE_RANK[(b.confidence || '').toUpperCase()] || 0;
    if (br !== ar) return br - ar;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });

  const best = enters[0];
  return {
    type: ACTIVITY_TYPE_TO_MOTION[(best.activityType || '').toUpperCase()] || 'unknown',
    confidence: mapConfidence(best.confidence),
    timestamp: best.timestamp || Date.now(),
  };
}

/**
 * Initialize Activity Recognition tracking.
 * Call after location permissions are granted (in initLocationServices).
 * Returns true if AR started successfully.
 */
export async function startMotionTracking(): Promise<boolean> {
  try {
    const MAT = require('react-native-motion-activity-tracker');

    // Request permission
    if (Platform.OS === 'android') {
      const status = await MAT.requestPermissionsAsyncAndroid();
      if (status !== 'granted') {
        console.warn('[motion] Android ACTIVITY_RECOGNITION permission denied');
        return false;
      }
    } else {
      const status = await MAT.getPermissionStatusAsync();
      if (status === 'denied' || status === 'restricted') {
        console.warn('[motion] iOS Motion & Fitness permission denied');
        return false;
      }
    }

    // Start real-time tracking
    await MAT.startTracking();

    // Subscribe to state changes
    // The library emits { events: ActivityChangeEvent[] } per batch.
    // Previously this code read event.state which doesn't exist -- the throw
    // was swallowed silently and the entire AR pipeline was a no-op.
    subscription = MAT.addMotionStateChangeListener(
      (payload: { events?: ActivityChangeEventLike[] }) => {
        try {
          const picked = selectActivity(payload?.events || []);
          if (!picked) return;
          currentMotion = {
            type: picked.type,
            confidence: picked.confidence,
            timestamp: picked.timestamp,
            source: 'activity_recognition',
          };
          for (const cb of motionCallbacks) {
            try {
              cb(currentMotion);
            } catch {
              /* ignore listener errors */
            }
          }
        } catch (err) {
          console.warn('[motion] listener error:', err);
        }
      }
    );

    console.log('[motion] Activity Recognition started');
    return true;
  } catch (err) {
    console.warn('[motion] Failed to start Activity Recognition:', err);
    return false;
  }
}

/** Get current motion state (synchronous, from last AR event) */
export function getCurrentMotion(): MotionState {
  return currentMotion;
}

/** Subscribe to motion state changes. Returns cleanup function. */
export function onMotionChange(
  cb: (state: MotionState) => void
): () => void {
  motionCallbacks.push(cb);
  return () => {
    motionCallbacks = motionCallbacks.filter((c) => c !== cb);
  };
}

/** Stop tracking (e.g. on logout) */
export async function stopMotionTracking(): Promise<void> {
  try {
    subscription?.remove();
    subscription = null;
    const MAT = require('react-native-motion-activity-tracker');
    MAT.stopTracking();
    console.log('[motion] Activity Recognition stopped');
  } catch {
    /* library not loaded */
  }
}
