/**
 * ambient/captureGate.ts -- Pendant capture mode manager.
 *
 * Manages ACTIVE (phone-driven, transit) vs PASSIVE (IMU-driven, stationary) modes.
 *
 * PASSIVE (default): pendant captures on IMU motion events. Every frame classified.
 * ACTIVE:  phone controls captures. On each GPS trail dot (~10m), phone sends
 *          CMD:CAPTURE to pendant. Frame tagged with GPS coords and linked to
 *          location_logs.frame_path. IMU captures disabled to avoid motion blur.
 *
 * Transitions:
 *   Stationary -> Moving (GPS displacement > 10m):  send mode:active
 *   Moving -> Stationary (2+ min no displacement):  send mode:passive
 */

import type { CaptureMode, CaptureGateState } from './types';

// ═══════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════

let instance: CaptureGate | null = null;

export function getCaptureGate(): CaptureGate {
  if (!instance) {
    instance = new CaptureGate();
  }
  return instance;
}

// ═══════════════════════════════════════
// GATE
// ═══════════════════════════════════════

/** Minimum stationary time before switching back to PASSIVE */
const STATIONARY_SETTLE_MS = 2 * 60 * 1000; // 2 minutes

class CaptureGate {
  private state: CaptureGateState = {
    mode: 'passive',
    lastModeChange: Date.now(),
  };

  /** Timer for settling into stationary state */
  private stationaryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Pending GPS tag for the next incoming frame */
  private pendingTag: { lat: number; lon: number; timestamp: number } | null = null;

  /** Is the pendant currently in ACTIVE (phone-driven) mode? */
  isActiveMode(): boolean {
    return this.state.mode === 'active';
  }

  /** Get the current capture mode */
  getMode(): CaptureMode {
    return this.state.mode;
  }

  /**
   * Called when phone detects motion start (confirmed GPS displacement).
   * Switches pendant to ACTIVE mode: IMU captures disabled, phone drives captures.
   */
  async onMotionStart(): Promise<void> {
    if (this.state.mode === 'active') return;

    this.clearStationaryTimer();
    await this.setMode('active');
    console.log('[CaptureGate] Motion started -> ACTIVE mode');
  }

  /**
   * Called when phone detects motion stop (stationary 2+ min).
   * Schedules switch back to PASSIVE mode after settle period.
   */
  onMotionStop(): void {
    if (this.state.mode === 'passive') return;

    // Don't switch immediately -- wait for settle period
    this.clearStationaryTimer();
    this.stationaryTimer = setTimeout(async () => {
      await this.setMode('passive');
      console.log('[CaptureGate] Stationary settled -> PASSIVE mode');
    }, STATIONARY_SETTLE_MS);
  }

  /**
   * Called on each GPS trail point (every ~10m) during transit.
   * Sends CMD:CAPTURE to pendant and tags the frame with GPS coords.
   *
   * Hook point: called from locationService.logLocationPoint() or
   * handleSignificantLocationChange() when in ACTIVE mode.
   */
  async triggerGpsCapture(lat: number, lon: number): Promise<void> {
    if (this.state.mode !== 'active') return;

    // Set pending GPS tag -- the next incoming frame gets tagged with these coords
    this.pendingTag = { lat, lon, timestamp: Date.now() };

    try {
      const { getPendantService } = require('../pendant/pendantService');
      const service = getPendantService();
      await service.sendCommand('capture');
      console.log(`[CaptureGate] GPS capture triggered at ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    } catch (err: any) {
      console.warn('[CaptureGate] Capture command failed:', err?.message);
      this.pendingTag = null;
    }
  }

  /**
   * Called when a frame arrives from pendant. If there's a pending GPS tag,
   * attach coords and store in location_logs.
   * Returns the GPS tag if one was pending, or null.
   */
  consumeGpsTag(): { lat: number; lon: number; timestamp: number } | null {
    if (!this.pendingTag) return null;

    // Only consume if tag is fresh (< 30s old)
    const age = Date.now() - this.pendingTag.timestamp;
    if (age > 30_000) {
      this.pendingTag = null;
      return null;
    }

    const tag = this.pendingTag;
    this.pendingTag = null;
    return tag;
  }

  /**
   * Tag a frame with GPS coords in location_logs.
   * Called after a frame is received and consumeGpsTag() returns coords.
   */
  tagFrameInLocationLog(
    framePath: string,
    lat: number,
    lon: number,
  ): void {
    try {
      const { getDb } = require('../../database');
      const db = getDb();

      // Find the most recent location_log entry near these coords
      const row = db.getFirstSync(
        `SELECT id FROM location_logs
         WHERE ABS(latitude - ?) < 0.0002 AND ABS(longitude - ?) < 0.0002
         ORDER BY recorded_at DESC LIMIT 1`,
        [lat, lon],
      ) as any;

      if (row?.id) {
        db.runSync(
          'UPDATE location_logs SET frame_path = ? WHERE id = ?',
          [framePath, row.id],
        );
        console.log(`[CaptureGate] Tagged location_log #${row.id} with frame`);
      }
    } catch (err: any) {
      console.warn('[CaptureGate] Failed to tag frame:', err?.message);
    }
  }

  // ─── Internal ─────────────────────────

  private async setMode(mode: CaptureMode): Promise<void> {
    this.state.mode = mode;
    this.state.lastModeChange = Date.now();

    try {
      const { getPendantService } = require('../pendant/pendantService');
      const service = getPendantService();
      await service.sendCommand(`mode:${mode}`);
    } catch (err: any) {
      console.warn(`[CaptureGate] Failed to send mode:${mode}:`, err?.message);
    }
  }

  private clearStationaryTimer(): void {
    if (this.stationaryTimer) {
      clearTimeout(this.stationaryTimer);
      this.stationaryTimer = null;
    }
  }
}
