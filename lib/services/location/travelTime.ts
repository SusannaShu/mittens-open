/**
 * Travel Time Computer -- ported from legacy mittens/travel.py.
 *
 * Computes travel time between two points using:
 * 1. Google Maps Directions API (accurate, requires API key)
 * 2. Haversine straight-line fallback with mode-specific speeds
 *
 * Also detects virtual meetings (Zoom, Meet, etc.) that need no travel.
 */

// Speed assumptions for straight-line fallback (miles per hour)
const MODE_SPEEDS: Record<string, number> = {
  walking: 3,
  bicycling: 10,
  transit: 15,
  driving: 25,
};

// Buffer multiplier for straight-line distance (roads aren't straight)
const STRAIGHT_LINE_MULTIPLIER = 1.4;

// Prep time added on top of travel (minutes)
const PREP_BUFFER_MIN = 5;

// Virtual meeting keywords
const VIRTUAL_KEYWORDS = [
  'zoom.us', 'meet.google.com', 'teams.microsoft.com',
  'webex', 'whereby', 'discord', 'virtual', 'online', 'remote',
  'zoom meeting', 'google meet', 'microsoft teams',
];

export interface TravelEstimate {
  durationMin: number;
  distanceMiles: number;
  mode: string;
  source: 'google_maps' | 'haversine';
  withBuffer: number; // total including prep buffer
  destCoords?: { lat: number; lon: number };
}

/**
 * Check if a location string indicates a virtual meeting.
 */
export function isVirtualLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  const lower = location.toLowerCase();
  return VIRTUAL_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Compute travel time from origin to destination.
 *
 * @param origin - { lat, lon } of current location
 * @param destination - address string or { lat, lon }
 * @param mode - walking, bicycling, transit, driving
 * @param apiKey - Google Maps API key (optional, uses haversine if missing)
 */
export async function getTravelTime(
  origin: { lat: number; lon: number },
  destination: string | { lat: number; lon: number },
  mode: string = 'transit',
  apiKey?: string
): Promise<TravelEstimate> {
  // Try Google Maps Directions API first
  if (apiKey && typeof destination === 'string') {
    try {
      const result = await getGoogleDirections(origin, destination, mode, apiKey);
      if (result) return result;
    } catch (err) {
      console.warn('[travel] Google Maps failed, falling back to haversine:', err);
    }
  }

  // Haversine fallback
  let destCoords: { lat: number; lon: number } | undefined;
  if (typeof destination === 'object') {
    destCoords = destination;
  } else {
    // Try geocoding the address (uses Nominatim fallback if no apiKey)
    const geocoded = await geocode(destination, apiKey);
    if (geocoded) {
      destCoords = geocoded;
    }
  }

  if (!destCoords) {
    // Can't compute without coordinates
    return {
      durationMin: 30, // conservative default
      distanceMiles: 0,
      mode,
      source: 'haversine',
      withBuffer: 30 + PREP_BUFFER_MIN,
    };
  }

  const distMiles = haversineDistanceMiles(
    origin.lat, origin.lon,
    destCoords.lat, destCoords.lon
  );

  const speed = MODE_SPEEDS[mode] || MODE_SPEEDS.transit;
  const adjustedDist = distMiles * STRAIGHT_LINE_MULTIPLIER;
  const durationMin = Math.ceil((adjustedDist / speed) * 60);

  return {
    durationMin,
    distanceMiles: Math.round(distMiles * 10) / 10,
    mode,
    source: 'haversine',
    withBuffer: durationMin + PREP_BUFFER_MIN,
    destCoords,
  };
}

/**
 * Google Maps Directions API call.
 */
async function getGoogleDirections(
  origin: { lat: number; lon: number },
  destination: string,
  mode: string,
  apiKey: string
): Promise<TravelEstimate | null> {
  const originStr = `${origin.lat},${origin.lon}`;
  const url =
    `https://maps.googleapis.com/maps/api/directions/json?` +
    `origin=${encodeURIComponent(originStr)}` +
    `&destination=${encodeURIComponent(destination)}` +
    `&mode=${mode}` +
    `&key=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== 'OK' || !data.routes?.length) return null;

  const leg = data.routes[0].legs[0];
  const durationMin = Math.ceil(leg.duration.value / 60);
  const distanceMiles = leg.distance.value / 1609.34;

  return {
    durationMin,
    distanceMiles: Math.round(distanceMiles * 10) / 10,
    mode,
    source: 'google_maps',
    withBuffer: durationMin + PREP_BUFFER_MIN,
    destCoords: leg.end_location ? { lat: leg.end_location.lat, lon: leg.end_location.lng } : undefined,
  };
}

/**
 * Geocode an address to coordinates.
 */
export async function geocode(
  address: string,
  apiKey?: string
): Promise<{ lat: number; lon: number } | null> {
  if (apiKey) {
    try {
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json?` +
        `address=${encodeURIComponent(address)}&key=${apiKey}`;

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'OK' && data.results?.length) {
          const loc = data.results[0].geometry.location;
          return { lat: loc.lat, lon: loc.lng };
        }
      }
    } catch { /* ignore google err */ }
  }

  // Fallback to free Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mittens/1.0 (Mobile Assistant)' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      }
    }
  } catch { /* ignore nominatim err */ }
  
  return null;
}

/**
 * Haversine distance in miles between two coordinate pairs.
 * Ported from legacy travel.py.
 */
export function haversineDistanceMiles(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 3959; // Earth radius in miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
