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

// GPS jitter suppression radius for stationary sessions (meters).
// Points within this radius of a stationary session's start are silently dropped.
const STATIONARY_SUPPRESSION_M = 50;

// Minimum dwell time (ms) before we split a moving session into a stationary one.
// If the user stops for less than this, the stationary points stay in the trail.
const MIN_STATIONARY_DWELL_MS = 3 * 60 * 1000;

// Distance (meters) that constitutes a significant location jump.
// When a stationary session sees a point this far away, it means
// the user traveled while the app was backgrounded. We bridge with
// a transit session rather than discarding the movement.
const DISTANCE_JUMP_M = 200;

// Minimum trail points required per 10 minutes of transit duration.
// Real movement generates consistent GPS samples; jitter creates sparse,
// scattered points. A 35-minute "transit" with only 3 points is GPS drift.
const MIN_POINTS_PER_10MIN = 3;

// Movement confirmation: require this many CONSECUTIVE non-stationary
// readings before transitioning out of a stationary session.
// GPS jitter produces isolated spikes; real movement produces consistent
// non-stationary readings. 10 consecutive is ~1-2 min of real movement
// but impossible for random jitter to sustain.
const MIN_CONSECUTIVE_MOVEMENT = 10;

// Track when the classifier first reported "stationary" during a moving session.
// We keep adding points to the trail until this exceeds MIN_STATIONARY_DWELL_MS,
// at which point we close the moving session and create a stationary one.
let stationarySince: { time: number; lat: number; lon: number } | null = null;
let stationaryDwellTimer: ReturnType<typeof setTimeout> | null = null;

// Movement confirmation counter: tracks consecutive non-stationary readings
// while in a stationary session. Resets to 0 on any stationary/unknown reading.
let consecutiveMovement = 0;
let firstMovement: { time: number; lat: number; lon: number; motion: string } | null = null;

function clearDwellTimer() {
  if (stationaryDwellTimer) {
    clearTimeout(stationaryDwellTimer);
    stationaryDwellTimer = null;
  }
}

/**
 * Schedule automatic dwell confirmation after MIN_STATIONARY_DWELL_MS.
 * This ensures a stationary session is created even if no further GPS
 * points arrive (e.g. because locationService suppresses drift).
 */
function scheduleDwellConfirmation() {
  clearDwellTimer();
  stationaryDwellTimer = setTimeout(() => {
    stationaryDwellTimer = null;
    if (!stationarySince) return;

    try {
      const db = getDb();
      const activeSession = db.getFirstSync(
        'SELECT * FROM location_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
      ) as any;

      if (!activeSession) {
        console.log('[sessionBuilder] Dwell timer fired: creating stationary session');
        startNewSession(db, stationarySince.lat, stationarySince.lon, 'stationary', new Date(stationarySince.time).toISOString());
        stationarySince = null;
      } else if (activeSession.motion_type !== 'stationary') {
        const splitTime = new Date(stationarySince.time).toISOString();
        console.log('[sessionBuilder] Dwell timer fired: splitting moving session to stationary');
        closeSession(db, activeSession.id, splitTime);
        startNewSession(db, stationarySince.lat, stationarySince.lon, 'stationary', splitTime);
        stationarySince = null;
      }
    } catch (err) {
      console.warn('[sessionBuilder] Dwell timer failed:', err);
    }
  }, MIN_STATIONARY_DWELL_MS + 500);
}

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
    const nowMs = new Date(now).getTime();
    const motionType = entry.motionType || 'unknown';

    console.log(`[sessionBuilder] recordPoint: motion=${motionType} speed=${entry.speed} at=${now}`);

    // Find the currently active (open) session
    const activeSession = db.getFirstSync(
      'SELECT * FROM location_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
    ) as any;

    if (!activeSession) {
      // No active session — only start one for actual movement.
      // If stationary, begin tracking dwell time but don't create a session yet.
      if (motionType === 'stationary') {
        if (!stationarySince) {
          stationarySince = { time: nowMs, lat: entry.latitude, lon: entry.longitude };
          scheduleDwellConfirmation();
          console.log('[sessionBuilder] Tracking stationary dwell (no active session)');
        }
        const dwellMs = nowMs - stationarySince.time;
        if (dwellMs >= MIN_STATIONARY_DWELL_MS) {
          // Real dwell — create the stationary session with the original start time
          console.log(`[sessionBuilder] Dwell confirmed (${Math.round(dwellMs / 60000)}min), creating stationary session`);
          startNewSession(db, stationarySince.lat, stationarySince.lon, 'stationary', new Date(stationarySince.time).toISOString());
          stationarySince = null;
          clearDwellTimer();
        }
        return;
      }
      // Non-stationary: clear any pending dwell and start a moving session
      stationarySince = null;
      clearDwellTimer();
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
      const currentMotionCheck = activeSession.motion_type || 'unknown';
      const isAtKnownPlace = currentMotionCheck === 'stationary' && !!activeSession.place_name;

      // When stationary at a known place (Home, D12, etc.), large GPS jumps
      // are always indoor drift -- silently absorb them instead of bridging.
      if (isAtKnownPlace) {
        console.log(`[sessionBuilder] GPS jump ${distFromLast.toFixed(0)}m at known place '${activeSession.place_name}' -- suppressing jitter`);
        return;
      }

      const transitMotion = resolveTransitMotion(motionType, distFromLast);
      console.log(`[sessionBuilder] Distance jump ${distFromLast.toFixed(0)}m: bridging with '${transitMotion}' session`);

      closeSession(db, activeSession.id, now);
      createBridgeSession(
        db, lastLat, lastLon, entry.latitude, entry.longitude,
        transitMotion, distFromLast, now
      );

      if (motionType === 'stationary') {
        stationarySince = { time: nowMs, lat: entry.latitude, lon: entry.longitude };
        scheduleDwellConfirmation();
        return;
      }
      stationarySince = null;
      clearDwellTimer();
      startNewSession(db, entry.latitude, entry.longitude, motionType, now);
      return;
    }

    const currentMotion = activeSession.motion_type || 'unknown';

    // ── Stationary dwell tracking ──
    // When a moving session gets a "stationary" point, don't split immediately.
    // Track when stationary started and keep adding points to the trail.
    // Only split after 5 continuous minutes of stationary.
    if (motionType === 'stationary' && currentMotion !== 'stationary') {
      if (!stationarySince) {
        stationarySince = { time: nowMs, lat: entry.latitude, lon: entry.longitude };
        scheduleDwellConfirmation();
        console.log(`[sessionBuilder] Stationary detected during '${currentMotion}' session, tracking dwell...`);
      }

      const dwellMs = nowMs - stationarySince.time;
      if (dwellMs >= MIN_STATIONARY_DWELL_MS) {
        // User has been still for 5+ min — close the moving session at the
        // time stationary started, and create a stationary session.
        const splitTime = new Date(stationarySince.time).toISOString();
        console.log(`[sessionBuilder] Dwell confirmed (${Math.round(dwellMs / 60000)}min), splitting session`);
        closeSession(db, activeSession.id, splitTime);
        startNewSession(db, stationarySince.lat, stationarySince.lon, 'stationary', splitTime);
        stationarySince = null;
        clearDwellTimer();
        return;
      }

      // < 5 min: keep the point in the trail, don't split
      // (fall through to extend the session below)
    } else if (motionType !== 'stationary') {
      // Motion resumed — clear the dwell tracker
      if (stationarySince) {
        console.log(`[sessionBuilder] Motion resumed as '${motionType}', dwell cancelled`);
        stationarySince = null;
        clearDwellTimer();
      }
    }

    // Stationary suppression: when the session IS stationary, GPS drift can be
    // 20-50m indoors. Suppress any point within the suppression radius.
    if (currentMotion === 'stationary' && motionType === 'stationary') {
      const startDist = haversineMeters(activeSession.start_lat, activeSession.start_lon, entry.latitude, entry.longitude);
      if (startDist < STATIONARY_SUPPRESSION_M) return;
    }

    // Motion type change for non-stationary transitions (e.g. walking → cycling)
    if (motionType !== 'stationary' && motionType !== currentMotion && motionType !== 'unknown' && currentMotion !== 'stationary') {
      console.log(`[sessionBuilder] Motion change: '${currentMotion}' -> '${motionType}', trail=${trail.length}pts`);
      closeSession(db, activeSession.id, now);
      startNewSession(db, entry.latitude, entry.longitude, motionType, now);
      return;
    }

    // Stationary -> moving: require 10 consecutive non-stationary readings.
    // GPS jitter never sustains 10 consecutive movement readings without
    // a stationary/unknown reading interrupting. Real movement does.
    if (currentMotion === 'stationary' && motionType !== 'stationary' && motionType !== 'unknown') {
      consecutiveMovement++;
      if (!firstMovement) {
        firstMovement = { time: nowMs, lat: entry.latitude, lon: entry.longitude, motion: motionType };
      }
      // Update dominant motion to latest
      firstMovement.motion = motionType;

      if (consecutiveMovement < MIN_CONSECUTIVE_MOVEMENT) {
        console.log(`[sessionBuilder] Movement reading ${consecutiveMovement}/${MIN_CONSECUTIVE_MOVEMENT}`);
        return; // Absorb the point, keep counting
      }

      // Check displacement -- even with 10 readings, if we haven't moved
      // 80m from anchor, it's persistent oscillation not real movement.
      const anchorLat = activeSession.start_lat;
      const anchorLon = activeSession.start_lon;
      const displacement = haversineMeters(anchorLat, anchorLon, entry.latitude, entry.longitude);

      if (displacement < 80) {
        console.log(`[sessionBuilder] ${consecutiveMovement} readings but displacement only ${displacement.toFixed(0)}m -- jitter, resetting`);
        consecutiveMovement = 0;
        firstMovement = null;
        return;
      }

      // Confirmed real movement
      const transitionTime = new Date(firstMovement.time).toISOString();
      const startLat = firstMovement.lat;
      const startLon = firstMovement.lon;
      console.log(`[sessionBuilder] Movement CONFIRMED: ${consecutiveMovement} consecutive readings, ${displacement.toFixed(0)}m displacement, transitioning to '${motionType}'`);
      consecutiveMovement = 0;
      firstMovement = null;
      closeSession(db, activeSession.id, transitionTime);
      startNewSession(db, startLat, startLon, motionType, transitionTime);
      stationarySince = null;
      clearDwellTimer();
      return;
    } else if (currentMotion === 'stationary') {
      // Stationary or unknown reading -- reset the consecutive counter
      if (consecutiveMovement > 0) {
        console.log(`[sessionBuilder] Stationary reading, resetting movement counter (was ${consecutiveMovement})`);
        consecutiveMovement = 0;
        firstMovement = null;
      }
    }

    // Same motion type (or stationary within dwell window) — extend the session
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

function resolveStationaryPlaceName(db: any, lat: number, lon: number): string | null {
  try {
    const place = db.getFirstSync(
      `SELECT name FROM known_places
       WHERE ABS(latitude - ?) < 0.001 AND ABS(longitude - ?) < 0.001
       LIMIT 1`,
      [lat, lon]
    ) as any;
    return place?.name ?? null;
  } catch { return null; }
}

function startNewSession(
  db: any,
  lat: number,
  lon: number,
  motionType: string,
  startedAt: string
): void {
  const trail = JSON.stringify([[lat, lon]]);

  const placeName = motionType === 'stationary'
    ? resolveStationaryPlaceName(db, lat, lon)
    : null;

  const result = db.runSync(
    `INSERT INTO location_sessions
     (started_at, start_lat, start_lon, motion_type, trail, place_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [startedAt, lat, lon, motionType, trail, placeName]
  );
  const sessionId = result?.lastInsertRowId;
  console.log(`[sessionBuilder] NEW SESSION #${sessionId}: motion=${motionType} place=${placeName || '-'}`);

  // Create linked activity log for movement sessions
  if (motionType !== 'stationary' && sessionId) {
    try {
      const { onTrailStart } = require('../ambient/trailActivityBridge');
      onTrailStart(sessionId, motionType, startedAt, lat, lon);
    } catch { /* trailActivityBridge not loaded */ }
  }
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
  const speedEstimates: Record<string, number> = {
    walking: 1.4, running: 2.8, cycling: 4.2, driving: 8.3, unknown: 2.0,
  };
  const speedMs = speedEstimates[motionType] || 2.0;
  const estimatedSeconds = Math.round(distanceM / speedMs);

  const startTime = new Date(new Date(timestamp).getTime() - estimatedSeconds * 1000);
  const startedAt = startTime.toISOString();

  const trail = JSON.stringify([[fromLat, fromLon], [toLat, toLon]]);

  const result = db.runSync(
    `INSERT INTO location_sessions
     (started_at, ended_at, start_lat, start_lon, end_lat, end_lon,
      motion_type, trail, distance_m, place_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [startedAt, timestamp, fromLat, fromLon, toLat, toLon,
     motionType, trail, distanceM]
  );
  const sessionId = result?.lastInsertRowId;
  console.log(`[sessionBuilder] BRIDGE SESSION #${sessionId}: motion=${motionType} dist=${distanceM.toFixed(0)}m est=${estimatedSeconds}s`);

  // Create and immediately close the linked activity log
  if (sessionId && motionType !== 'stationary') {
    try {
      const { onBridgeSession } = require('../ambient/trailActivityBridge');
      onBridgeSession(sessionId, motionType, startedAt, timestamp, fromLat, fromLon);
    } catch { /* trailActivityBridge not loaded */ }
  }
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
  // Get session info before closing to check if it's a movement session
  const session = db.getFirstSync(
    'SELECT motion_type, started_at, trail FROM location_sessions WHERE id = ?',
    [sessionId],
  ) as any;

  // Phantom transit detection: if a movement session has too few points
  // for its duration, it's GPS jitter -- delete it instead of closing.
  if (session?.motion_type && session.motion_type !== 'stationary') {
    const startMs = new Date(session.started_at).getTime();
    const endMs = new Date(endedAt).getTime();
    const durationMin = (endMs - startMs) / 60000;
    let pointCount = 0;
    try {
      pointCount = session.trail ? JSON.parse(session.trail).length : 0;
    } catch { pointCount = 0; }

    const expectedPoints = Math.max(1, (durationMin / 10) * MIN_POINTS_PER_10MIN);
    if (durationMin > 5 && pointCount < expectedPoints) {
      console.log(`[sessionBuilder] PHANTOM detected: ${pointCount} pts in ${Math.round(durationMin)}min (need ${Math.round(expectedPoints)}), deleting session #${sessionId}`);
      db.runSync('DELETE FROM location_sessions WHERE id = ?', [sessionId]);
      return;
    }
  }

  db.runSync(
    'UPDATE location_sessions SET ended_at = ? WHERE id = ?',
    [endedAt, sessionId]
  );

  // Close linked activity log for movement sessions
  if (session?.motion_type && session.motion_type !== 'stationary') {
    try {
      const { onTrailEnd } = require('../ambient/trailActivityBridge');
      onTrailEnd(sessionId, endedAt);
    } catch { /* trailActivityBridge not loaded */ }
  }
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
