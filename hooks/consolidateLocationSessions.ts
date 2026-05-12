/**
 * consolidateLocationSessions.ts
 *
 * Merges fragmented location sessions before rendering on the calendar.
 * Fixes the alternating unknown(1min)/stationary pattern caused by
 * background wake GPS classification delay.
 *
 * Rules:
 * 1. Absorb short "unknown" sessions (< 2min) into the previous session
 * 2. Merge consecutive stationary sessions at the same approximate location
 */

import { LocationSession } from '../lib/services/location/locationSessionApi';

const MERGE_DISTANCE_THRESHOLD_M = 200;
const SHORT_UNKNOWN_THRESHOLD_SEC = 120;

/**
 * Haversine distance in meters between two lat/lon points.
 */
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

export function consolidateLocationSessions(
  rawSessions: LocationSession[]
): LocationSession[] {
  if (rawSessions.length === 0) return [];

  const consolidated: LocationSession[] = [];

  for (let i = 0; i < rawSessions.length; i++) {
    const s = rawSessions[i];
    const prev = consolidated.length > 0
      ? consolidated[consolidated.length - 1]
      : null;

    // 1. Absorb short unknown sessions into the previous session
    const durationSec = s.endedAt
      ? (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000
      : 0;

    if (s.motionType === 'unknown' && durationSec < SHORT_UNKNOWN_THRESHOLD_SEC && prev) {
      // Extend the previous session's end time to cover this gap
      prev.endedAt = s.endedAt;
      if (s.path && s.path.length > 0) {
        prev.path = [...prev.path, ...s.path];
      }
      if (prev.endedAt) {
        prev.duration_min = Math.round(
          (new Date(prev.endedAt).getTime() - new Date(prev.startedAt).getTime()) / 60000
        );
      }
      continue;
    }

    // 2. Merge consecutive stationary sessions at the same location
    if (
      prev &&
      s.motionType === 'stationary' &&
      prev.motionType === 'stationary' &&
      prev.path.length > 0 &&
      s.path && s.path.length > 0
    ) {
      const prevLast = prev.path[prev.path.length - 1];
      const currFirst = s.path[0];
      const distM = haversineMeters(
        prevLast[0], prevLast[1],
        currFirst[0], currFirst[1]
      );

      if (distM < MERGE_DISTANCE_THRESHOLD_M) {
        prev.endedAt = s.endedAt;
        prev.placeName = s.placeName || prev.placeName;
        prev.path = [...prev.path, ...s.path];
        if (prev.endedAt) {
          prev.duration_min = Math.round(
            (new Date(prev.endedAt).getTime() - new Date(prev.startedAt).getTime()) / 60000
          );
        }
        continue;
      }
    }

    // No merge -- add as a new consolidated session (shallow copy to avoid mutation)
    consolidated.push({
      ...s,
      path: s.path ? [...s.path] : [],
    });
  }

  return consolidated;
}
