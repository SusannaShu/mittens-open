/**
 * ambient/trailActivityBridge.ts -- Links location sessions to activity logs.
 *
 * When a movement session starts (walking/biking/running), auto-creates an
 * activity log. When the trail closes (stationary), updates the end time.
 * During the trail, ambient captures route AEIOU updates to this log.
 *
 * For non-home stationary dwell sessions, auto-creates activity logs with
 * reverse-geocoded location titles. Calendar event matching merges planned
 * events with actual arrivals/departures.
 */

import { getDb } from '../../database';

// MET values for motion types (matches GPS motion classifier output)
const MOTION_MET: Record<string, number> = {
  walking: 3.5,
  running: 8.0,
  cycling: 7.5,
  driving: 1.3,
  transit: 1.3,
  unknown: 2.0,
};

// Human-readable labels for motion types
const MOTION_LABELS: Record<string, string> = {
  walking: 'Walking',
  running: 'Running',
  cycling: 'Cycling',
  driving: 'Driving',
  transit: 'Transit',
  unknown: 'Moving',
};

// Default log duration (minutes) -- will be updated on trail close
const DEFAULT_DURATION_MIN = 30;

/**
 * Called when a new movement session starts.
 * Creates an activity log with origin_session_id provenance.
 */
export function onTrailStart(
  sessionId: number,
  motionType: string,
  startedAt: string,
  lat: number,
  lon: number,
): number | null {
  try {
    const db = getDb();

    // Only auto-create activity logs for movement trails (walking, running, cycling)
    if (motionType !== 'walking' && motionType !== 'running' && motionType !== 'cycling') {
      return null;
    }

    // Check if there's already an activity log for this session
    // Check both old FK and new provenance column
    const existing = db.getFirstSync(
      `SELECT id FROM activity_logs
       WHERE location_session_id = ? OR origin_session_id = ?`,
      [sessionId, sessionId],
    ) as any;
    if (existing) return existing.id;

    const label = MOTION_LABELS[motionType] || MOTION_LABELS.unknown;
    const metValue = MOTION_MET[motionType] ?? MOTION_MET.unknown;

    // Resolve place name from known_places or reverse geocode
    let placeName: string | null = null;
    let locationLabel: string | null = null;
    try {
      const place = db.getFirstSync(
        `SELECT name FROM known_places
         WHERE ABS(latitude - ?) < 0.002 AND ABS(longitude - ?) < 0.002
         LIMIT 1`,
        [lat, lon],
      ) as any;
      placeName = place?.name ?? null;
    } catch { /* known_places may not exist */ }

    // Build a descriptive log name: "Walking in Central Park" not "Walking (trail)"
    if (placeName) {
      locationLabel = placeName;
    } else {
      try {
        const { localReverseGeocode } = require('../location/placeInference');
        // localReverseGeocode is async but we need sync here; use cached neighborhood
        const { getCurrentPlace } = require('../location/locationService');
        locationLabel = getCurrentPlace() || null;
      } catch { /* location service not available */ }
    }
    const logName = locationLabel
      ? `${label} in ${locationLabel}`
      : label;

    // Don't hard-code outdoors — walking in a museum isn't outdoor.
    // Let the VLM triage detect outdoors/nature from the actual scene.
    const result = db.runSync(
      `INSERT INTO activity_logs (
        logged_at, log_name, activity_type, duration_min, mets,
        location, source, location_session_id, origin_session_id,
        outdoors, is_nature,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'trail', ?, ?, 0, 0, datetime('now'), datetime('now'))`,
      [
        startedAt,
        logName,
        motionType,
        DEFAULT_DURATION_MIN,
        metValue,
        placeName,
        sessionId,
        sessionId,
      ],
    );

    const logId = result?.lastInsertRowId ?? null;
    console.log(`[TrailBridge] Created activity log #${logId}: ${logName} (${metValue} MET)`);
    return logId;
  } catch (err: any) {
    console.warn('[TrailBridge] Failed to create trail activity:', err?.message);
    return null;
  }
}

/**
 * Called when a movement session ends (user becomes stationary).
 * Updates the activity log duration to actual elapsed time.
 */
export function onTrailEnd(sessionId: number, endedAt: string): void {
  try {
    const db = getDb();

    const log = db.getFirstSync(
      `SELECT id, logged_at FROM activity_logs
       WHERE location_session_id = ? OR origin_session_id = ?`,
      [sessionId, sessionId],
    ) as any;
    if (!log) return;

    const startMs = new Date(log.logged_at).getTime();
    const endMs = new Date(endedAt).getTime();
    const durationMin = Math.max(1, Math.round((endMs - startMs) / 60000));

    db.runSync(
      `UPDATE activity_logs SET
        duration_min = ?, updated_at = datetime('now')
      WHERE id = ?`,
      [durationMin, log.id],
    );

    console.log(`[TrailBridge] Closed trail activity #${log.id}: ${durationMin}min`);
  } catch (err: any) {
    console.warn('[TrailBridge] Failed to close trail activity:', err?.message);
  }
}

/**
 * Called when a non-home stationary dwell session starts.
 * Auto-creates an activity log with reverse-geocoded location as title.
 * Attempts to match against planned calendar events.
 */
export async function onDwellActivityCreate(
  sessionId: number,
  lat: number,
  lon: number,
  startedAt: string,
  placeName: string | null,
  neighborhood: string | null,
): Promise<number | null> {
  // Prevent stationary dwell sessions from automatically creating activity logs.
  // Location logs can still be manually logged or converted by the user.
  return null;
}

/**
 * Returns the activity log ID for the currently active trail, if any.
 * Used by the ambient triage engine to route capture updates.
 */
export function getActiveTrailLogId(): number | null {
  try {
    const db = getDb();

    // Find the most recent open movement session
    const session = db.getFirstSync(
      `SELECT ls.id as session_id, al.id as log_id
       FROM location_sessions ls
       JOIN activity_logs al ON al.location_session_id = ls.id
          OR al.origin_session_id = ls.id
       WHERE ls.ended_at IS NULL
         AND ls.motion_type != 'stationary'
       ORDER BY ls.started_at DESC LIMIT 1`,
    ) as any;

    return session?.log_id ?? null;
  } catch {
    return null;
  }
}

/**
 * For bridge sessions (created for background GPS jumps), create and
 * immediately close the activity log since the session is already ended.
 */
export function onBridgeSession(
  sessionId: number,
  motionType: string,
  startedAt: string,
  endedAt: string,
  lat: number,
  lon: number,
): void {
  const logId = onTrailStart(sessionId, motionType, startedAt, lat, lon);
  if (logId != null) {
    onTrailEnd(sessionId, endedAt);
  }
}
