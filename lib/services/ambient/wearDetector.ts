/**
 * ambient/wearDetector.ts -- Pendant worn/not-worn detection.
 *
 * Infers whether the pendant is being worn based on:
 *   1. BLE connection status (if not connected, definitely not worn)
 *   2. Motion frame recency (no frames in N minutes = likely not worn)
 *   3. IMU data cadence (consistent micro-motion = worn on body)
 *
 * Used by the wakeup nudge to decide whether to escalate alerts.
 */

/** If no frame received within this window, pendant is likely not worn */
const NO_FRAME_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/** Track last frame time */
let lastFrameTime = 0;
let bleConnected = false;

/**
 * Update the last frame timestamp.
 * Called from usePendantBridge on every motion frame.
 */
export function onFrameReceived(): void {
  lastFrameTime = Date.now();
}

/**
 * Update BLE connection status.
 * Called when pendant connects/disconnects.
 */
export function onBleStatusChange(connected: boolean): void {
  bleConnected = connected;
}

/**
 * Is the pendant likely being worn?
 *
 * Returns:
 *   'worn'       -- BLE connected + recent frames
 *   'connected'  -- BLE connected but no recent frames (maybe on desk)
 *   'off'        -- BLE disconnected
 */
export function getWearStatus(): 'worn' | 'connected' | 'off' {
  if (!bleConnected) return 'off';

  const elapsed = Date.now() - lastFrameTime;
  if (lastFrameTime > 0 && elapsed < NO_FRAME_THRESHOLD_MS) {
    return 'worn';
  }

  return 'connected';
}

/**
 * Is the pendant connected via BLE?
 */
export function isPendantConnected(): boolean {
  return bleConnected;
}

/**
 * How long since the last motion frame? (ms)
 * Returns Infinity if no frame ever received.
 */
export function timeSinceLastFrame(): number {
  if (lastFrameTime === 0) return Infinity;
  return Date.now() - lastFrameTime;
}
