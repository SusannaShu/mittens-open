/**
 * location/reverseGeocode.ts -- Reverse geocoding for location sessions.
 *
 * Wraps expo-location's reverseGeocodeAsync (Apple's geocoder on iOS).
 * Provides human-readable labels like "at LES for 20min" or
 * "walking in SoHo and Chelsea".
 *
 * Coordinate-level cache avoids redundant geocode calls for the
 * same location (rounds to ~100m grid cells).
 */

import * as Location from 'expo-location';

// --- Types ---

export interface GeoResult {
  address: string;
  neighborhood: string | null;
  city: string | null;
}

// --- Cache ---

/** Round coordinates to ~100m grid for cache keys */
function cacheKey(lat: number, lon: number): string {
  return `${Math.round(lat * 1000)},${Math.round(lon * 1000)}`;
}

const geoCache = new Map<string, GeoResult>();
const MAX_CACHE = 200;

// --- Public API ---

/**
 * Reverse geocode a coordinate pair into an address + neighborhood.
 * Returns cached result if available.
 */
export async function resolveAddress(
  lat: number,
  lon: number,
): Promise<GeoResult | null> {
  const key = cacheKey(lat, lon);
  const cached = geoCache.get(key);
  if (cached) return cached;

  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: lat,
      longitude: lon,
    });
    if (!results.length) return null;

    const r = results[0];
    const parts = [r.streetNumber, r.street].filter(Boolean);
    const address =
      parts.join(' ') || r.name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

    const result: GeoResult = {
      address,
      neighborhood: r.district || r.subregion || null,
      city: r.city || null,
    };

    // Cache with eviction
    if (geoCache.size >= MAX_CACHE) {
      const firstKey = geoCache.keys().next().value;
      if (firstKey) geoCache.delete(firstKey);
    }
    geoCache.set(key, result);

    return result;
  } catch (err: any) {
    console.warn('[ReverseGeocode] Failed:', err?.message);
    return null;
  }
}

/**
 * Format a human-readable location label for a session.
 *
 * Stationary: "at LES for 20min" or "at Home for 2h"
 * Trail: "walking in SoHo and Chelsea"
 */
export function formatLocationLabel(opts: {
  placeName?: string | null;
  neighborhood?: string | null;
  address?: string | null;
  motionType: string;
  durationMin?: number;
}): string {
  const { placeName, neighborhood, address, motionType, durationMin } = opts;
  const locationPart = placeName || neighborhood || address || 'unknown location';

  if (motionType === 'stationary') {
    const timePart = durationMin
      ? durationMin >= 60
        ? ` for ${Math.round(durationMin / 60)}h`
        : ` for ${durationMin}min`
      : '';
    return `at ${locationPart}${timePart}`;
  }

  // Trail: "walking in SoHo"
  const MOTION_VERBS: Record<string, string> = {
    walking: 'walking in',
    running: 'running in',
    cycling: 'biking through',
    driving: 'driving through',
  };
  const verb = MOTION_VERBS[motionType] || 'moving through';
  return `${verb} ${locationPart}`;
}

/**
 * Update a location session row with reverse-geocoded address data.
 * Called when a new stationary session is created without a known place name.
 */
export async function geocodeSession(
  sessionId: number,
  lat: number,
  lon: number,
): Promise<GeoResult | null> {
  const geo = await resolveAddress(lat, lon);
  if (!geo) return null;

  try {
    const { getDb } = require('../../database');
    const db = getDb();
    db.runSync(
      'UPDATE location_sessions SET address = ?, neighborhood = ? WHERE id = ?',
      [geo.address, geo.neighborhood, sessionId],
    );
  } catch (err: any) {
    console.warn('[ReverseGeocode] DB update failed:', err?.message);
  }

  return geo;
}
