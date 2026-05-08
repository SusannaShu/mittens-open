/**
 * Motion Service -- Native Activity Recognition wrapper.
 *
 * Subscribes to platform-native motion detection:
 *   iOS: CMMotionActivityManager (M7+ coprocessor)
 *   Android: Activity Recognition Transition API
 *
 * Provides current motion state to locationService for
 * accurate motionType on every location log.
 */

import { Platform } from 'react-native';

export type MotionType =
  | 'stationary'
  | 'walking'
  | 'running'
  | 'cycling'
  | 'driving'
  | 'unknown';

export interface MotionState {
  type: MotionType;
  confidence: 'low' | 'medium' | 'high';
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

/** Map library state string to our MotionType */
function mapMotionState(state: string): MotionType {
  const s = state.toLowerCase();
  if (s.includes('stationary') || s.includes('still')) return 'stationary';
  if (s.includes('running')) return 'running';
  if (s.includes('walking')) return 'walking';
  if (s.includes('cycling') || s.includes('bicycle')) return 'cycling';
  if (s.includes('automotive') || s.includes('vehicle') || s.includes('driving')) return 'driving';
  return 'unknown';
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
    subscription = MAT.addMotionStateChangeListener(
      (event: { state: string }) => {
        const mapped = mapMotionState(event.state);
        currentMotion = {
          type: mapped,
          confidence: 'high', // AR API uses hardware ML = high confidence
          timestamp: Date.now(),
          source: 'activity_recognition',
        };
        for (const cb of motionCallbacks) {
          try {
            cb(currentMotion);
          } catch {
            /* ignore listener errors */
          }
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
