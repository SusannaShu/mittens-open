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
import { getApiBase, getAuthToken } from '../../api';
import { KnownPlace } from './knownPlaceApi';

// Task names (must match defineTask calls)
export const GEOFENCE_TASK = 'MITTENS_GEOFENCE';
export const LOCATION_TASK = 'MITTENS_LOCATION';

// In-memory state (persisted to Strapi on change)
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

const TRAIL_POINT_DISTANCE_M = 10;
const MOTION_START_CONFIRM_DISTANCE_M = 10;
const STATIONARY_SETTLE_MS = 3 * 60 * 1000;
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
    if (locations.length > 0) {
      handleSignificantLocationChange(locations[locations.length - 1]);
    }
  }
});

// ──────────────────────────────────────────
// Event handlers
// ──────────────────────────────────────────

async function logToServer(entry: {
  latitude?: number | null;
  longitude?: number | null;
  eventType: string;
  placeName?: string | null;
  motionType?: string | null;
  speed?: number | null;
  loggedAt: string;
}) {
  try {
    const token = getAuthToken();
    if (!token) return;
    await fetch(`${getApiBase()}/location-logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(entry),
    });
  } catch (err) {
    console.warn('[location] Failed to log to server:', err);
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

  logToServer({
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

  // Get motion type from Activity Recognition API (primary)
  // Falls back to GPS speed if AR not available or stale (>60s)
  let motionType: string | null = null;
  try {
    const { getCurrentMotion } = require('./motionService');
    const arMotion = getCurrentMotion();
    if (arMotion.type !== 'unknown' && Date.now() - arMotion.timestamp < 60000) {
      motionType = arMotion.type;
    }
  } catch { /* motionService not loaded */ }

  // Fallback to GPS speed inference if AR unavailable
  if (!motionType && location.coords.speed != null && location.coords.speed > 0) {
    const speedKmh = location.coords.speed * 3.6;
    if (speedKmh < 2) motionType = 'stationary';
    else if (speedKmh < 8) motionType = 'walking';
    else if (speedKmh < 25) motionType = 'cycling';
    else motionType = 'driving';
  }

  lastMotionType = motionType;

  // Only log if moved meaningfully. Motion transitions can force their own samples,
  // so the regular trail stream can stay distance-based without cutting off endpoints.
  if (prevLat != null && prevLon != null) {
    const dist = haversineMeters(prevLat, prevLon, latitude, longitude);
    if (dist < TRAIL_POINT_DISTANCE_M) return;
  }

  logLocationPoint({
    latitude,
    longitude,
    eventType: 'significant_change',
    motionType,
    speed: location.coords.speed != null ? location.coords.speed : null,
    loggedAt: now,
  });

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

  logToServer(entry);
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

function handleMotionStateChange(motionType: string) {
  if (!motionType || motionType === 'unknown') return;
  const wasStationary = lastMotionType === 'stationary' || !activeTrailMotion;
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
      }).catch(() => {});
    }, STATIONARY_SETTLE_MS);
    return;
  }

  clearStationarySettleTimer();

  if (!wasStationary && activeTrailMotion === motionType) return;

  const anchor = stationaryAnchor || currentLocation;
  if (!anchor) {
    pullAndLogMotionPoint(motionType).then((loc) => {
      if (loc) {
        activeTrailMotion = motionType;
        stationaryAnchor = null;
      }
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
