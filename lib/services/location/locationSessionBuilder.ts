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
 */

import { getDb } from '../../database';

// Minimum gap between sessions (seconds). If a new point arrives
// more than this after the last, force-close the old session.
const SESSION_GAP_SECONDS = 10 * 60; // 10 minutes

// Minimum distance (meters) between trail points to avoid clutter
const MIN_TRAIL_POINT_DISTANCE_M = 15;

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

    // Find the currently active (open) session
    const activeSession = db.getFirstSync(
      'SELECT * FROM location_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
    ) as any;

    if (!activeSession) {
      // No active session -- start a new one
      startNewSession(db, entry.latitude, entry.longitude, motionType, now);
      return;
    }

    // Check for time gap: if more than SESSION_GAP_SECONDS since last update,
    // close the old session and start fresh
    const lastTime = new Date(activeSession.started_at).getTime();
    const currentTime = new Date(now).getTime();
    const gapSeconds = (currentTime - lastTime) / 1000;

    // Also check trail for the most recent point time
    let trail: [number, number][] = [];
    try {
      trail = activeSession.trail ? JSON.parse(activeSession.trail) : [];
    } catch { trail = []; }

    if (gapSeconds > SESSION_GAP_SECONDS && trail.length === 0) {
      closeSession(db, activeSession.id, now);
      startNewSession(db, entry.latitude, entry.longitude, motionType, now);
      return;
    }

    // Check for distance jump (untracked transit while app was suspended)
    let lastLat = activeSession.end_lat ?? activeSession.start_lat;
    let lastLon = activeSession.end_lon ?? activeSession.start_lon;
    const distFromLast = haversineMeters(lastLat, lastLon, entry.latitude, entry.longitude);
    
    if (distFromLast > 200) {
      // Significant jump without tracking. Break session so it resolves the new place correctly.
      closeSession(db, activeSession.id, now);
      startNewSession(db, entry.latitude, entry.longitude, motionType, now);
      return;
    }

    // Check for motion type change
    const currentMotion = activeSession.motion_type || 'unknown';
    if (motionType !== currentMotion && motionType !== 'unknown') {
      // If the active session is "unknown", upgrade it in-place rather than
      // fragmenting. This prevents the alternating unknown(1min)/stationary
      // pattern that occurs after each background wake.
      if (currentMotion === 'unknown') {
        const sessionAge = (currentTime - lastTime) / 1000;
        if (sessionAge < 120) {
          // Upgrade the short unknown session to the real type
          let placeName: string | null = null;
          if (motionType === 'stationary') {
            const place = db.getFirstSync(
              `SELECT name FROM known_places
               WHERE ABS(latitude - ?) < 0.001 AND ABS(longitude - ?) < 0.001
               LIMIT 1`,
              [entry.latitude, entry.longitude]
            ) as any;
            if (place) placeName = place.name;
          }
          db.runSync(
            `UPDATE location_sessions SET motion_type = ?, place_name = COALESCE(?, place_name) WHERE id = ?`,
            [motionType, placeName, activeSession.id]
          );
          // Fall through to extend the session normally
        } else {
          closeSession(db, activeSession.id, now);
          startNewSession(db, entry.latitude, entry.longitude, motionType, now);
          return;
        }
      } else {
        closeSession(db, activeSession.id, now);
        startNewSession(db, entry.latitude, entry.longitude, motionType, now);
        return;
      }
    }

    // Same motion type -- extend the session
    // Add point to trail if far enough from last point
    const shouldAddToTrail = trail.length === 0 ||
      haversineMeters(
        trail[trail.length - 1][0], trail[trail.length - 1][1],
        entry.latitude, entry.longitude
      ) >= MIN_TRAIL_POINT_DISTANCE_M;

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
