/**
 * locationSessionBuilder.ts -- Client-side location session aggregator.
 *
 * In mittens-app, the Strapi backend aggregated raw GPS location logs
 * into location_sessions. In mittens-open, this runs on-device.
 *
 * Logic:
 * - Maintains an "active session" (no ended_at) in location_sessions
 * - When motion type changes, closes the current session and starts a new one
 * - When stationary, accumulates dwell time at a single point
 * - When moving, builds a trail (path) of [lat, lon] coordinates
 * - Updates place_name from coordinate matching against known_places
 *
 * Trail lifecycle:
 *   stationary(A) -> GPS change detected -> movement session -> stationary(B)
 *   The movement session IS the trail connecting dots A and B.
 */

import { getDb } from '../../database';

// Minimum distance (meters) between trail points to avoid clutter
const MIN_TRAIL_POINT_DISTANCE_M = 15;

// Distance (meters) that constitutes a significant location jump.
// When a stationary session sees a point this far away, it means
// the user traveled while the app was backgrounded. We bridge with
// a transit session rather than discarding the movement.
const DISTANCE_JUMP_M = 200;

/**
 * Record a location point and update the active session.
 * Called from locationService whenever a new GPS sample is logged.
 */
export function recordLocationPoint(entry: {
  latitude: number;
  longitude: number;
  motionType: string | null;
  speed: number | null;
  loggedAt: string;
}): void {
  try {
    const db = getDb();
    const now = entry.loggedAt;
    const motionType = entry.motionType || 'unknown';

    console.log(`[sessionBuilder] recordPoint: motion=${motionType} speed=${entry.speed} at=${now}`);

    // Find the currently active (open) session
    const activeSession = db.getFirstSync(
      'SELECT * FROM location_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
    ) as any;

    if (!activeSession) {
      console.log('[sessionBuilder] No active session, starting new one');
      startNewSession(db, entry.latitude, entry.longitude, motionType, now);
      return;
    }

    // Parse existing trail
    let trail: [number, number][] = [];
    try {
      trail = activeSession.trail ? JSON.parse(activeSession.trail) : [];
    } catch { trail = []; }

    // Check distance from last known position in this session
    const lastLat = activeSession.end_lat ?? activeSession.start_lat;
    const lastLon = activeSession.end_lon ?? activeSession.start_lon;
    const distFromLast = haversineMeters(lastLat, lastLon, entry.latitude, entry.longitude);

    if (distFromLast > DISTANCE_JUMP_M) {
      // The user has moved significantly. Instead of discarding the movement,
      // close the current session and create a bridge transit session that
      // connects the old position to the new one, then start a new session
      // at the destination.
      const transitMotion = resolveTransitMotion(motionType, distFromLast);
      console.log(`[sessionBuilder] Distance jump ${distFromLast.toFixed(0)}m: bridging with '${transitMotion}' session`);

      closeSession(db, activeSession.id, now);

      // Create a bridge session with a 2-point trail from old position to new
      createBridgeSession(
        db, lastLat, lastLon, entry.latitude, entry.longitude,
        transitMotion, distFromLast, now
      );

      // Start a new session at the destination
      startNewSession(db, entry.latitude, entry.longitude, motionType, now);
      return;
    }

    // Check for motion type change
    const currentMotion = activeSession.motion_type || 'unknown';
    if (motionType !== currentMotion && motionType !== 'unknown') {
      console.log(`[sessionBuilder] Motion change: '${currentMotion}' -> '${motionType}', trail=${trail.length}pts`);
      closeSession(db, activeSession.id, now);
      startNewSession(db, entry.latitude, entry.longitude, motionType, now);
      return;
    }

    // Same motion type -- extend the session
    const trailDist = trail.length > 0
      ? haversineMeters(trail[trail.length - 1][0], trail[trail.length - 1][1], entry.latitude, entry.longitude)
      : Infinity;
    const shouldAddToTrail = trail.length === 0 || trailDist >= MIN_TRAIL_POINT_DISTANCE_M;

    if (shouldAddToTrail) {
      trail.push([entry.latitude, entry.longitude]);
    }

    // Update the session's end coordinates and trail
    db.runSync(
      `UPDATE location_sessions
       SET end_lat = ?, end_lon = ?, trail = ?,
           distance_m = COALESCE(distance_m, 0) + ?
       WHERE id = ?`,
      [
        entry.latitude,
        entry.longitude,
        JSON.stringify(trail),
        shouldAddToTrail && trail.length > 1
          ? haversineMeters(
              trail[trail.length - 2][0], trail[trail.length - 2][1],
              entry.latitude, entry.longitude
            )
          : 0,
        activeSession.id,
      ]
    );
  } catch (err) {
    console.warn('[sessionBuilder] Failed to record location point:', err);
  }
}

/**
 * Close the active session when the app detects a long stationary period
 * or motion stops. Called externally when needed.
 */
export function closeActiveSession(): void {
  try {
    const db = getDb();
    const active = db.getFirstSync(
      'SELECT id FROM location_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
    ) as any;
    if (active) {
      closeSession(db, active.id, new Date().toISOString());
    }
  } catch (err) {
    console.warn('[sessionBuilder] Failed to close active session:', err);
  }
}

// ──────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────

function startNewSession(
  db: any,
  lat: number,
  lon: number,
  motionType: string,
  startedAt: string
): void {
  const trail = JSON.stringify([[lat, lon]]);

  // Resolve place name from known_places
  let placeName: string | null = null;
  if (motionType === 'stationary') {
    const place = db.getFirstSync(
      `SELECT name FROM known_places
       WHERE ABS(latitude - ?) < 0.001 AND ABS(longitude - ?) < 0.001
       LIMIT 1`,
      [lat, lon]
    ) as any;
    if (place) placeName = place.name;
  }

  db.runSync(
    `INSERT INTO location_sessions
     (started_at, start_lat, start_lon, motion_type, trail, place_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [startedAt, lat, lon, motionType, trail, placeName]
  );
  console.log(`[sessionBuilder] NEW SESSION: motion=${motionType} place=${placeName || '-'}`);
}

/**
 * Create a bridge session that connects two points with a 2-point trail.
 * This represents movement that happened while the app was backgrounded
 * and GPS was batched. The session is immediately closed (has both
 * started_at and ended_at).
 */
function createBridgeSession(
  db: any,
  fromLat: number, fromLon: number,
  toLat: number, toLon: number,
  motionType: string,
  distanceM: number,
  timestamp: string
): void {
  // Estimate duration from distance and motion type:
  //   walking ~5km/h, cycling ~15km/h, driving ~30km/h
  const speedEstimates: Record<string, number> = {
    walking: 1.4, running: 2.8, cycling: 4.2, driving: 8.3, unknown: 2.0,
  };
  const speedMs = speedEstimates[motionType] || 2.0;
  const estimatedSeconds = Math.round(distanceM / speedMs);

  const startTime = new Date(new Date(timestamp).getTime() - estimatedSeconds * 1000);
  const startedAt = startTime.toISOString();

  const trail = JSON.stringify([[fromLat, fromLon], [toLat, toLon]]);

  db.runSync(
    `INSERT INTO location_sessions
     (started_at, ended_at, start_lat, start_lon, end_lat, end_lon,
      motion_type, trail, distance_m, place_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [startedAt, timestamp, fromLat, fromLon, toLat, toLon,
     motionType, trail, distanceM]
  );
  console.log(`[sessionBuilder] BRIDGE SESSION: motion=${motionType} dist=${distanceM.toFixed(0)}m est=${estimatedSeconds}s`);
}

/**
 * Infer what motion type a distance jump likely represents.
 * If the incoming classifier already has a real type, use it.
 * Otherwise, estimate from distance.
 */
function resolveTransitMotion(incomingMotion: string, distanceM: number): string {
  // If the classifier already determined a real type, trust it
  if (incomingMotion !== 'unknown' && incomingMotion !== 'stationary') {
    return incomingMotion;
  }
  // Heuristic: short jumps are likely walking, long ones are transit
  if (distanceM < 500) return 'walking';
  if (distanceM < 2000) return 'walking';
  return 'driving';
}

function closeSession(db: any, sessionId: number, endedAt: string): void {
  db.runSync(
    'UPDATE location_sessions SET ended_at = ? WHERE id = ?',
    [endedAt, sessionId]
  );
}

function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
