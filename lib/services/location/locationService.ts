/**
 * Location Service -- iOS-native power-efficient location tracking.
 *
 * 3-layer context stack:
 * Layer 1: Geofencing (zero battery while inside a fence, 20 region limit)
 * Layer 2: Background GPS trail points while moving
 * Layer 3: Motion inference (Activity Recognition + location speed/distance)
 *
 * Background tasks must be defined at top-level scope (imported in _layout.tsx).
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { KnownPlace } from './knownPlaceApi';
import { getDb } from '../../database';
import { recordLocationPoint } from './locationSessionBuilder';

// Task names (must match defineTask calls)
export const GEOFENCE_TASK = 'MITTENS_GEOFENCE';
export const LOCATION_TASK = 'MITTENS_LOCATION';

// In-memory state (persisted to Backend on change)
let currentPlace: string | null = null;
let currentLocation: { lat: number; lon: number } | null = null;
let lastLocationTime: number = 0;
let lastMotionType: string | null = null;
let locationChangeCallbacks: Array<() => void> = [];
let motionUnsubscribe: (() => void) | null = null;

// Cached known places for coordinate-based matching (fallback when geofence hasn't fired)
let cachedKnownPlaces: KnownPlace[] = [];

// Geofence event cooldown: prevents oscillation spam (5 min per place+type)
const GEOFENCE_COOLDOWN_MS = 5 * 60 * 1000;
const EXIT_GRACE_MS = 2 * 60 * 1000; // keep currentPlace for 2 min after exit
const lastGeofenceEvent: Map<string, { type: string; time: number }> = new Map();
let exitGraceTimer: ReturnType<typeof setTimeout> | null = null;

// Recent location history for pattern analysis (last 15 points)
const locationHistory: Array<{ lat: number; lon: number; time: number; motionType: string | null }> = [];

const TRAIL_POINT_DISTANCE_M = 15;
const STATIONARY_SUPPRESSION_RADIUS_M = 50;
const MOTION_START_CONFIRM_DISTANCE_M = 50;
const STATIONARY_SETTLE_MS = 5 * 60 * 1000;
const MOTION_RECHECK_MS = 30 * 1000;

let stationaryAnchor: { lat: number; lon: number } | null = null;
let activeTrailMotion: string | null = null;
let pendingMotionStart:
  | { motionType: string; anchor: { lat: number; lon: number }; timer: ReturnType<typeof setTimeout> | null; attempts: number }
  | null = null;
let stationarySettleTimer: ReturnType<typeof setTimeout> | null = null;

// ──────────────────────────────────────────
// Background task definitions (top-level)
// ──────────────────────────────────────────

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    if ((error as any).code === 0 || (error.message && error.message.includes('Code=0'))) {
      console.warn('[location] Suppressed simulated geofence task error:', error.message);
      return;
    }
    console.error('[location] Geofence task error:', error);
    return;
  }
  if (data) {
    const { eventType, region } = data as {
      eventType: Location.GeofencingEventType;
      region: Location.LocationRegion;
    };
    handleGeofenceEvent(eventType, region);
  }
});

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    if ((error as any).code === 0 || (error.message && error.message.includes('Code=0'))) {
      console.warn('[location] Suppressed simulated location task error:', error.message);
      return;
    }
    console.error('[location] Location task error:', error);
    return;
  }
  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    if (locations && locations.length > 0) {
      for (const loc of locations) {
        handleSignificantLocationChange(loc);
      }
    }
  }
});

// ──────────────────────────────────────────
// Event handlers
// ──────────────────────────────────────────

function logToLocal(entry: {
  latitude?: number | null;
  longitude?: number | null;
  eventType: string;
  placeName?: string | null;
  motionType?: string | null;
  speed?: number | null;
  loggedAt: string;
}) {
  try {
    const db = getDb();
    db.runSync(
      `INSERT INTO location_logs (latitude, longitude, activity_type, place_name, recorded_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        entry.latitude ?? null,
        entry.longitude ?? null,
        entry.motionType ?? null,
        entry.placeName ?? null,
        entry.loggedAt,
      ]
    );

    // Feed into the session builder to populate location_sessions
    // ONLY IF IT'S A REAL GPS EVENT, NOT A GEOFENCE EVENT
    if (entry.latitude != null && entry.longitude != null && entry.eventType !== 'enter' && entry.eventType !== 'exit') {
      recordLocationPoint({
        latitude: entry.latitude,
        longitude: entry.longitude,
        motionType: entry.motionType ?? null,
        speed: entry.speed ?? null,
        loggedAt: entry.loggedAt,
      });
    }
  } catch (err) {
    console.warn('[location] Failed to log locally:', err);
  }
}

function handleGeofenceEvent(
  eventType: Location.GeofencingEventType,
  region: Location.LocationRegion
) {
  const isEnter = eventType === Location.GeofencingEventType.Enter;
  const placeName = region.identifier || 'Unknown';
  const evtType = isEnter ? 'enter' : 'exit';
  const now = Date.now();

  // Throttle: skip duplicate same-type events within 5 min, and filter cross-type rapid bouncing (< 1 min)
  const lastEvt = lastGeofenceEvent.get(placeName);
  if (lastEvt) {
    const elapsed = now - lastEvt.time;
    if (lastEvt.type === evtType && elapsed < GEOFENCE_COOLDOWN_MS) {
      return; // skip duplicate
    }
    if (lastEvt.type !== evtType && elapsed < 60 * 1000) {
      return; // skip rapid oscillation
    }
  }
  lastGeofenceEvent.set(placeName, { type: evtType, time: now });

  console.log(`[location] Geofence ${isEnter ? 'ENTER' : 'EXIT'}: ${placeName}`);

  if (isEnter) {
    // Cancel any pending exit grace timer
    if (exitGraceTimer) {
      clearTimeout(exitGraceTimer);
      exitGraceTimer = null;
    }
    currentPlace = placeName;
  } else {
    // Grace period: keep currentPlace for 2 min to prevent dwell detector
    // from firing during oscillation
    if (currentPlace === placeName) {
      if (exitGraceTimer) clearTimeout(exitGraceTimer);
      exitGraceTimer = setTimeout(() => {
        if (currentPlace === placeName) {
          currentPlace = null;
          notifyListeners();
        }
        exitGraceTimer = null;
      }, EXIT_GRACE_MS);
    }
  }

  logToLocal({
    latitude: region.latitude,
    longitude: region.longitude,
    eventType: evtType,
    placeName,
    loggedAt: new Date().toISOString(),
  });

  notifyListeners();
}

function handleSignificantLocationChange(location: Location.LocationObject) {
  const { latitude, longitude } = location.coords;
  const now = new Date().toISOString();
  const prevLat = currentLocation?.lat;
  const prevLon = currentLocation?.lon;

  currentLocation = { lat: latitude, lon: longitude };
  lastLocationTime = Date.now();

  // Feed the new sample into the phone motion classifier and use its output
  // as the authoritative motion type. The classifier fuses GPS displacement,
  // pedometer step rate, and AR (with confidence gating) on a 90s window.
  // It is far more resistant to fidget-induced false positives than any one
  // of those signals alone.
  let motionType: string | null = null;
  let motionConfidence: number | null = null;
  try {
    const { recordGpsSample, classifyNow } = require('./phoneMotionClassifier');
    recordGpsSample({
      lat: latitude,
      lon: longitude,
      speed: location.coords.speed,
      accuracy: location.coords.accuracy,
      time: Date.now(),
    });
    const result = classifyNow();
    if (result.type !== 'unknown') {
      motionType = result.type;
      motionConfidence = result.confidence;
    }
  } catch (err) {
    // Classifier not loaded yet (or threw): fall through to legacy logic
    console.warn('[location] motion classifier unavailable:', (err as any)?.message);
  }

  // Legacy fallback only if classifier returned unknown / failed to load.
  if (!motionType) {
    try {
      const { getCurrentMotion } = require('./motionService');
      const arMotion = getCurrentMotion();
      const fresh = Date.now() - arMotion.timestamp < 60000;
      const trustworthy = arMotion.confidence === 'medium' || arMotion.confidence === 'high';
      if (arMotion.type !== 'unknown' && fresh && trustworthy && hasRecentDisplacement(30, 60_000)) {
        motionType = arMotion.type;
      }
    } catch { /* motionService not loaded */ }

    if (!motionType && location.coords.speed != null) {
      const speedKmh = location.coords.speed * 3.6;
      if (speedKmh < 2) {
        motionType = 'stationary';
      } else if (hasRecentDisplacement(30, 60_000)) {
        if (speedKmh < 8) motionType = 'walking';
        else if (speedKmh < 25) motionType = 'cycling';
        else motionType = 'driving';
      }
    }
  }

  lastMotionType = motionType;
  if (motionConfidence != null) {
    console.log(`[location] motion=${motionType} conf=${motionConfidence.toFixed(2)}`);
  }

  // When stationary, always forward to the session builder for dwell tracking,
  // even if the point will be suppressed below for trail/history purposes.
  // The session builder needs continuous input to track the 3-minute dwell
  // threshold and create/maintain stationary sessions.
  if (motionType === 'stationary') {
    recordLocationPoint({
      latitude,
      longitude,
      motionType: 'stationary',
      speed: location.coords.speed != null ? location.coords.speed : null,
      loggedAt: now,
    });
  }

  // Only log if moved meaningfully. Motion transitions can force their own samples,
  // so the regular trail stream can stay distance-based without cutting off endpoints.
  if (prevLat != null && prevLon != null) {
    const dist = haversineMeters(prevLat, prevLon, latitude, longitude);
    if (dist < TRAIL_POINT_DISTANCE_M) return;
  }

  // Stationary suppression: when we're at rest (or the classifier says stationary),
  // suppress any point that's within the suppression radius of the stationary anchor.
  // GPS drift at home/school can easily be 20-60m and creates messy trail clusters.
  if (motionType === 'stationary' && stationaryAnchor) {
    const anchorDist = haversineMeters(stationaryAnchor.lat, stationaryAnchor.lon, latitude, longitude);
    if (anchorDist < STATIONARY_SUPPRESSION_RADIUS_M) return;
  }

  logLocationPoint({
    latitude,
    longitude,
    eventType: 'significant_change',
    motionType,
    speed: location.coords.speed != null ? location.coords.speed : null,
    loggedAt: now,
  });

  // Trigger pendant capture if in GPS-synced active mode
  try {
    const { getCaptureGate } = require('../ambient/captureGate');
    const gate = getCaptureGate();
    if (gate.isActiveMode()) {
      gate.triggerGpsCapture(latitude, longitude);
    }
  } catch { /* captureGate not loaded yet */ }

  // Trigger dwell detection check (lazy import to avoid circular deps)
  try {
    const { checkDwell } = require('./placeInference');
    checkDwell();
  } catch { /* placeInference not loaded yet */ }

  notifyListeners();
}

async function getCurrentPositionForTransition(): Promise<Location.LocationObject | null> {
  try {
    return await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    });
  } catch (err) {
    console.warn('[location] Transition GPS pull failed:', err);
    return null;
  }
}

function logLocationPoint(entry: {
  latitude: number;
  longitude: number;
  eventType: 'significant_change' | 'motion_change';
  motionType?: string | null;
  speed?: number | null;
  loggedAt: string;
}) {
  locationHistory.push({
    lat: entry.latitude,
    lon: entry.longitude,
    time: new Date(entry.loggedAt).getTime(),
    motionType: entry.motionType || null,
  });
  if (locationHistory.length > 15) locationHistory.shift();

  logToLocal(entry);
}

async function pullAndLogMotionPoint(
  motionType: string,
  eventType: 'significant_change' | 'motion_change' = 'motion_change'
): Promise<{ lat: number; lon: number } | null> {
  const loc = await getCurrentPositionForTransition();
  if (!loc) return null;

  const { latitude, longitude, speed } = loc.coords;
  currentLocation = { lat: latitude, lon: longitude };
  lastLocationTime = Date.now();
  lastMotionType = motionType;

  logLocationPoint({
    latitude,
    longitude,
    eventType,
    motionType,
    speed: speed != null ? speed : null,
    loggedAt: new Date().toISOString(),
  });

  notifyListeners();
  return currentLocation;
}

function clearPendingMotionStart() {
  if (pendingMotionStart?.timer) clearTimeout(pendingMotionStart.timer);
  pendingMotionStart = null;
}

function clearStationarySettleTimer() {
  if (stationarySettleTimer) clearTimeout(stationarySettleTimer);
  stationarySettleTimer = null;
}

async function confirmMotionStart(motionType: string, anchor: { lat: number; lon: number }, attempts = 0) {
  const sample = await getCurrentPositionForTransition();
  if (!sample) return;

  const loc = { lat: sample.coords.latitude, lon: sample.coords.longitude };
  currentLocation = loc;
  lastLocationTime = Date.now();
  notifyListeners();

  const dist = haversineMeters(anchor.lat, anchor.lon, loc.lat, loc.lon);
  if (dist >= MOTION_START_CONFIRM_DISTANCE_M) {
    logLocationPoint({
      latitude: loc.lat,
      longitude: loc.lon,
      eventType: 'motion_change',
      motionType,
      speed: sample.coords.speed != null ? sample.coords.speed : null,
      loggedAt: new Date().toISOString(),
    });
    activeTrailMotion = motionType;
    stationaryAnchor = null;
    clearPendingMotionStart();

    // Switch pendant to GPS-synced active capture mode
    try {
      const { getCaptureGate } = require('../ambient/captureGate');
      getCaptureGate().onMotionStart();
    } catch { /* captureGate not loaded yet */ }

    notifyListeners();
    return;
  }

  // Hardware activity can flip to walking from hand movement. Recheck once after
  // a short delay before calling it a real trail.
  if (attempts >= 1) {
    clearPendingMotionStart();
    return;
  }

  pendingMotionStart = {
    motionType,
    anchor,
    attempts: attempts + 1,
    timer: setTimeout(() => {
      pendingMotionStart = null;
      confirmMotionStart(motionType, anchor, attempts + 1).catch(() => {});
    }, MOTION_RECHECK_MS),
  };
}

/**
 * Look at the recent locationHistory and report whether the user has actually
 * displaced more than `meters` within the last `withinMs` milliseconds.
 *
 * This is the gate that protects us from the classic "fidget-marked-as-walking"
 * failure mode: Activity Recognition can fire a low-confidence walking event
 * from hand jiggle while the phone is on a desk. If GPS hasn't moved, we
 * shouldn't believe the event.
 */
function hasRecentDisplacement(meters: number, withinMs: number = 60_000): boolean {
  const now = Date.now();
  // Reduce locationHistory to points within the window
  const recent = locationHistory.filter((p) => now - p.time <= withinMs);
  if (recent.length < 2) return false;
  // Total path length traversed
  let total = 0;
  for (let i = 1; i < recent.length; i++) {
    total += haversineMeters(recent[i - 1].lat, recent[i - 1].lon, recent[i].lat, recent[i].lon);
    if (total >= meters) return true;
  }
  return false;
}

function handleMotionStateChange(motionType: string) {
  if (!motionType || motionType === 'unknown') return;
  const wasStationary = lastMotionType === 'stationary' || !activeTrailMotion;

  // Displacement gate: any non-stationary AR event must be backed by real
  // GPS displacement in the recent past, otherwise we're being lied to by
  // a fidget-induced classification. Stationary is always allowed through.
  if (motionType !== 'stationary' && !hasRecentDisplacement(30, 60_000)) {
    console.log(`[location] Ignoring "${motionType}" AR event -- no GPS displacement in last 60s`);
    return;
  }

  lastMotionType = motionType;

  if (motionType === 'stationary') {
    clearPendingMotionStart();
    clearStationarySettleTimer();

    const anchor = currentLocation;
    if (anchor) stationaryAnchor = anchor;

    // Pull one settled endpoint after the phone has really been still for a bit.
    stationarySettleTimer = setTimeout(() => {
      stationarySettleTimer = null;
      pullAndLogMotionPoint('stationary').then((loc) => {
        if (loc) stationaryAnchor = loc;
        activeTrailMotion = null;

        // Switch pendant back to IMU-driven passive capture mode
        try {
          const { getCaptureGate } = require('../ambient/captureGate');
          getCaptureGate().onMotionStop();
        } catch { /* captureGate not loaded yet */ }
      }).catch(() => {});
    }, STATIONARY_SETTLE_MS);
    return;
  }

  clearStationarySettleTimer();

  if (!wasStationary && activeTrailMotion === motionType) return;

  // We need an anchor to measure displacement against. If we have neither
  // a stationaryAnchor nor a currentLocation, pull a GPS sample to use as
  // the anchor -- but DO NOT log it as a motion point yet. confirmMotionStart
  // will decide whether to log based on subsequent displacement.
  const anchor = stationaryAnchor || currentLocation;
  if (!anchor) {
    getCurrentPositionForTransition().then((sample) => {
      if (!sample) return;
      const loc = { lat: sample.coords.latitude, lon: sample.coords.longitude };
      currentLocation = loc;
      lastLocationTime = Date.now();
      notifyListeners();
      clearPendingMotionStart();
      confirmMotionStart(motionType, loc).catch(() => {});
    }).catch(() => {});
    return;
  }

  clearPendingMotionStart();
  confirmMotionStart(motionType, anchor).catch(() => {});
}

// ──────────────────────────────────────────
// Public API
// ──────────────────────────────────────────

/**
 * Initialize location services.
 * Call after login with the user's known places.
 */
export async function initLocationServices(
  knownPlaces: KnownPlace[]
): Promise<{ foreground: boolean; background: boolean }> {
  // Request foreground permission first
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') {
    console.warn('[location] Foreground permission denied');
    return { foreground: false, background: false };
  }

  // Request background (Always) permission
  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  const backgroundGranted = bgStatus === 'granted';

  if (!backgroundGranted) {
    console.warn('[location] Background permission denied -- geofencing disabled');
  }

  // Cache known places for coordinate-based matching
  cachedKnownPlaces = knownPlaces;

  // Get initial location
  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    currentLocation = { lat: loc.coords.latitude, lon: loc.coords.longitude };
    lastLocationTime = Date.now();

    logToLocal({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      eventType: 'app_start',
      motionType: 'stationary',
      loggedAt: new Date().toISOString(),
    });

    // Check if already inside a known place (geofence won't fire if already inside)
    if (!currentPlace && knownPlaces.length > 0) {
      const match = knownPlaces.find((p) =>
        haversineMeters(p.latitude, p.longitude, loc.coords.latitude, loc.coords.longitude) < (p.radius || 50)
      );
      if (match) {
        currentPlace = match.name;
        console.log(`[location] Already at known place: ${match.name}`);
      }
    }
  } catch (err) {
    console.warn('[location] Failed to get initial location:', err);
  }

  if (backgroundGranted) {
    // Start geofencing for known places (Layer 1)
    await startGeofencing(knownPlaces);

    // Start significant location changes (Layer 2)
    await startSignificantLocationChanges();
  }

  return { foreground: true, background: backgroundGranted };
}

/**
 * Start Activity Recognition tracking (separate from location permissions).
 * Called after initLocationServices so native module has time to load.
 */
export async function startActivityRecognition(): Promise<boolean> {
  // Always start the phone motion classifier (pedometer + GPS fusion). It is
  // the primary source of motion labels now.
  try {
    const { startMotionClassifier } = require('./phoneMotionClassifier');
    await startMotionClassifier();
  } catch (err) {
    console.warn('[location] Failed to start phone motion classifier:', err);
  }

  // Activity Recognition is still useful as a soft prior fed into the
  // classifier. Start it if available, but don't fail the whole flow if not.
  try {
    const { startMotionTracking, onMotionChange } = require('./motionService');
    const started = await startMotionTracking();
    if (started && !motionUnsubscribe) {
      motionUnsubscribe = onMotionChange((state: { type: string }) => {
        handleMotionStateChange(state.type);
      });
    }
    return started;
  } catch (err) {
    console.warn('[location] Failed to start Activity Recognition:', err);
    return false;
  }
}

/**
 * Register geofences for up to 20 known places.
 */
async function startGeofencing(places: KnownPlace[]): Promise<void> {
  // Stop existing geofencing first
  const isRunning = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
  if (isRunning) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }

  if (places.length === 0) return;

  // iOS limit: 20 regions
  const regions = places.slice(0, 20).map((p) => ({
    identifier: p.name,
    latitude: p.latitude,
    longitude: p.longitude,
    radius: p.radius || 50,
    notifyOnEnter: true,
    notifyOnExit: true,
  }));

  await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
  console.log(`[location] Geofencing started with ${regions.length} regions`);
}

/**
 * Start significant location change monitoring.
 */
async function startSignificantLocationChanges(): Promise<void> {
  const isRunning = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK);
  if (isRunning) return;

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    distanceInterval: TRAIL_POINT_DISTANCE_M,
    deferredUpdatesDistance: TRAIL_POINT_DISTANCE_M,
    deferredUpdatesInterval: 30000, // batch often enough to keep visible trails current
    activityType: Location.ActivityType.Fitness,
    showsBackgroundLocationIndicator: false,
    pausesUpdatesAutomatically: false, // Don't let iOS kill it when resting
  });

  console.log('[location] Significant location changes started');
}

/**
 * Get current location from cache (no GPS poll).
 */
export function getCurrentLocation(): { lat: number; lon: number } | null {
  return currentLocation;
}

/**
 * Get current place name from geofence state.
 */
export function getCurrentPlace(): string | null {
  return currentPlace;
}

/**
 * Manually set the current place (e.g. when dwell detector matches via coordinates
 * but geofence didn't fire). This prevents the dwell detector from re-asking.
 */
export function setCurrentPlaceManual(name: string): void {
  currentPlace = name;
}

/**
 * Check if location data is fresh (within last 30 min).
 */
export function isLocationFresh(): boolean {
  return Date.now() - lastLocationTime < 30 * 60 * 1000;
}

/**
 * Get the last detected motion type from speed analysis.
 */
export function getLastMotionType(): string | null {
  return lastMotionType;
}

/**
 * Get recent location history for pattern analysis.
 */
export function getLocationHistory(): Array<{ lat: number; lon: number; time: number; motionType: string | null }> {
  return [...locationHistory];
}

/**
 * Subscribe to location changes.
 * Returns cleanup function.
 */
export function onLocationChange(callback: () => void): () => void {
  locationChangeCallbacks.push(callback);
  return () => {
    locationChangeCallbacks = locationChangeCallbacks.filter((cb) => cb !== callback);
  };
}

/**
 * Update geofences (e.g. after adding/removing a known place).
 */
export async function updateGeofences(places: KnownPlace[]): Promise<void> {
  cachedKnownPlaces = places;
  await startGeofencing(places);
}

/**
 * Get cached known places for coordinate-based matching.
 */
export function getKnownPlacesCache(): KnownPlace[] {
  return cachedKnownPlaces;
}

/**
 * Stop all location services (e.g. on logout).
 */
export async function stopLocationServices(): Promise<void> {
  try {
    const geoRunning = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
    if (geoRunning) await Location.stopGeofencingAsync(GEOFENCE_TASK);
  } catch (err) {
    console.warn('[location] Stop geofencing error:', err);
  }

  try {
    const locRunning = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK);
    if (locRunning) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch (err) {
    console.warn('[location] Stop location updates error:', err);
  }

  currentPlace = null;
  currentLocation = null;
  clearPendingMotionStart();
  clearStationarySettleTimer();
  stationaryAnchor = null;
  activeTrailMotion = null;

  if (motionUnsubscribe) {
    motionUnsubscribe();
    motionUnsubscribe = null;
  }

  // Stop Activity Recognition
  try {
    const { stopMotionTracking } = require('./motionService');
    await stopMotionTracking();
  } catch { /* motionService not loaded */ }

  console.log('[location] All services stopped');
}

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function notifyListeners() {
  for (const cb of locationChangeCallbacks) {
    try { cb(); } catch (err) { /* ignore */ }
  }
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
