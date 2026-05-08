/**
 * Place Inference Service -- Dwell detection + smart stationary prompting.
 *
 * When user is stationary at an unknown location for >X min:
 * 1. Checks if sleep window (skip if sleeping)
 * 2. Checks if timer is running (skip if active)
 * 3. Checks daily prompt count (max N/day)
 * 4. Checks backend known-places for coordinate match
 * 5. If no match: sends Mittens message asking what user is doing
 *
 * No Google Maps/Places API calls.
 */

import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBase, getAuthToken } from '../../api';
import { getCurrentLocation, getCurrentPlace, setCurrentPlaceManual, updateGeofences, getKnownPlacesCache } from './locationService';
import { saveMittensMessage } from '../schedule/alarmScheduler';
import { FOCUS_TIMER_STORAGE_KEY } from '../../../hooks/useFocusTimer';

// Dwell detection state
let dwellStartTime: number | null = null;
let dwellLocation: { lat: number; lon: number } | null = null;
let dwellTriggered = false;
let dwellCheckInterval: ReturnType<typeof setInterval> | null = null;

// Config (can be overridden from profile)
let configDwellThresholdMin = 30; // minutes before asking
let configMaxDailyPrompts = 3;

const DWELL_RADIUS_M = 80;
const DWELL_CHECK_INTERVAL_MS = 60 * 1000;
const PROMPT_COUNT_KEY = 'mittens_daily_prompt_count';
const PROMPT_DATE_KEY = 'mittens_daily_prompt_date';

/**
 * Configure dwell detection from profile settings.
 */
export function configureDwell(opts: {
  promptFrequencyMin?: number;
  maxDailyPrompts?: number;
}): void {
  if (opts.promptFrequencyMin) configDwellThresholdMin = opts.promptFrequencyMin;
  if (opts.maxDailyPrompts) configMaxDailyPrompts = opts.maxDailyPrompts;
}

/**
 * Start dwell detection. Call after location services are initialized.
 */
export function startDwellDetection(): void {
  if (dwellCheckInterval) return;
  dwellCheckInterval = setInterval(() => {
    checkDwell();
  }, DWELL_CHECK_INTERVAL_MS);
}

/**
 * Stop dwell detection (e.g. on logout).
 */
export function stopDwellDetection(): void {
  if (dwellCheckInterval) {
    clearInterval(dwellCheckInterval);
    dwellCheckInterval = null;
  }
  resetDwell();
}

/**
 * Check current location against dwell state.
 * Called periodically and on each significant location change.
 */
export function checkDwell(): void {
  const loc = getCurrentLocation();
  const place = getCurrentPlace();

  // If at a known place (via geofence), no need for dwell detection
  if (place) {
    resetDwell();
    return;
  }

  // Fallback: check coordinates against cached known places
  if (loc) {
    const knownPlaces = getKnownPlacesCache();
    const match = knownPlaces.find((p) =>
      haversineMeters(p.latitude, p.longitude, loc.lat, loc.lon) < (p.radius || 50)
    );
    if (match) {
      setCurrentPlaceManual(match.name);
      resetDwell();
      return;
    }
  }

  if (!loc) return;

  // If we have no dwell anchor, start one
  if (!dwellLocation) {
    dwellLocation = loc;
    dwellStartTime = Date.now();
    dwellTriggered = false;
    return;
  }

  // Check if still near the dwell anchor
  const dist = haversineMeters(dwellLocation.lat, dwellLocation.lon, loc.lat, loc.lon);

  if (dist > DWELL_RADIUS_M) {
    dwellLocation = loc;
    dwellStartTime = Date.now();
    dwellTriggered = false;
    return;
  }

  // Still at same spot -- check if threshold exceeded
  if (dwellTriggered) return;
  if (!dwellStartTime) return;

  const dwellMs = Date.now() - dwellStartTime;
  const thresholdMs = configDwellThresholdMin * 60 * 1000;
  if (dwellMs >= thresholdMs) {
    dwellTriggered = true;
    handleDwellDetected(loc.lat, loc.lon, Math.round(dwellMs / 60000));
  }
}

/**
 * Called when user has been stationary at an unknown location for >threshold.
 * Respects sleep window, active timer, and daily prompt limit.
 */
async function handleDwellDetected(lat: number, lon: number, dwellMinutes: number): Promise<void> {
  const token = getAuthToken();
  if (!token) return;

  // Guard 1: Check if within sleep window
  if (await isInSleepWindow()) return;

  // Guard 2: Check if timer is running
  if (await isTimerRunning()) return;

  // Guard 3: Check daily prompt count
  if (await isDailyLimitReached()) return;

  try {
    // Check backend known-places for coordinate match
    const placesRes = await fetch(`${getApiBase()}/known-places`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (placesRes.ok) {
      const places = await placesRes.json();
      const match = places.find((p: { latitude: number; longitude: number; radius: number; name: string }) =>
        haversineMeters(p.latitude, p.longitude, lat, lon) < (p.radius || 50)
      );
      if (match) {
        setCurrentPlaceManual(match.name);
        try { await updateGeofences(places); } catch {}
        return;
      }
      try { await updateGeofences(places); } catch {}
    }

    // No known place match -- ask the user
    const geo = await localReverseGeocode(lat, lon);
    const hint = geo ? ` (near ${geo.address})` : '';
    await saveMittensMessage(
      `You've been at a new spot${hint} for ${dwellMinutes} min. What are you up to? You can also name this place for future visits.`,
      'dwell_prompt',
      { lat, lon }
    );

    // Increment daily prompt count
    await incrementPromptCount();
  } catch {
    // Dwell inference is best-effort
  }
}

/**
 * Check if current time is within the user's planned sleep window.
 */
async function isInSleepWindow(): Promise<boolean> {
  try {
    const token = getAuthToken();
    if (!token) return false;
    const res = await fetch(`${getApiBase()}/nutrition-profiles/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const profile = await res.json();
    const bedtime = profile.bedtime; // e.g. "22:30"
    const wakeTime = profile.wakeTime; // e.g. "06:30"
    if (!bedtime || !wakeTime) return false;

    const now = new Date();
    const [bedH, bedM] = bedtime.split(':').map(Number);
    const [wakeH, wakeM] = wakeTime.split(':').map(Number);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const bedMin = bedH * 60 + bedM;
    const wakeMin = wakeH * 60 + wakeM;

    // Handles overnight sleep (e.g. 22:30 - 06:30)
    if (bedMin > wakeMin) {
      return nowMin >= bedMin || nowMin < wakeMin;
    }
    return nowMin >= bedMin && nowMin < wakeMin;
  } catch {
    return false;
  }
}

/**
 * Check if focus timer is currently running.
 */
async function isTimerRunning(): Promise<boolean> {
  try {
    const endStr = await AsyncStorage.getItem(FOCUS_TIMER_STORAGE_KEY);
    if (!endStr) return false;
    return parseInt(endStr, 10) > Date.now();
  } catch {
    return false;
  }
}

/**
 * Check if daily prompt limit has been reached.
 */
async function isDailyLimitReached(): Promise<boolean> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const savedDate = await AsyncStorage.getItem(PROMPT_DATE_KEY);
    if (savedDate !== today) return false; // new day, no prompts yet
    const countStr = await AsyncStorage.getItem(PROMPT_COUNT_KEY);
    const count = parseInt(countStr || '0', 10);
    return count >= configMaxDailyPrompts;
  } catch {
    return false;
  }
}

/**
 * Increment the daily prompts counter.
 */
async function incrementPromptCount(): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const savedDate = await AsyncStorage.getItem(PROMPT_DATE_KEY);
    let count = 0;
    if (savedDate === today) {
      count = parseInt(await AsyncStorage.getItem(PROMPT_COUNT_KEY) || '0', 10);
    }
    await AsyncStorage.setItem(PROMPT_DATE_KEY, today);
    await AsyncStorage.setItem(PROMPT_COUNT_KEY, (count + 1).toString());
  } catch {}
}

/**
 * Free reverse geocoding via expo-location (Apple's geocoder on iOS).
 */
export async function localReverseGeocode(
  lat: number,
  lon: number
): Promise<{ address: string; neighborhood: string | null; city: string | null } | null> {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
    if (!results.length) return null;

    const r = results[0];
    const parts = [r.streetNumber, r.street].filter(Boolean);
    const address = parts.join(' ') || r.name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

    return {
      address,
      neighborhood: r.district || r.subregion || null,
      city: r.city || null,
    };
  } catch {
    return null;
  }
}

function resetDwell(): void {
  dwellLocation = null;
  dwellStartTime = null;
  dwellTriggered = false;
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
