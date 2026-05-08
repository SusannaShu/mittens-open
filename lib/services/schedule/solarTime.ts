import { AnchorTransition } from '../../types';

/**
 * Local Mean Solar Time (LMST) utilities.
 * LMST is the mean solar time at a given longitude, independent of civil timezones and DST.
 * Solar noon at longitude L is UTC + (L / 15) hours.
 *
 * All times are represented either as:
 *   (a) a `Date` (absolute UTC instant), or
 *   (b) a number of LMST-minutes-from-midnight (0-1439), which is a "time of day" in LMST.
 *
 * LMST minutes from midnight at longitude L for instant t (UTC):
 *   lmst = ((t_utc + L/15 hours) mod 24h) in minutes
 */

const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;

/** Convert a UTC Date to LMST minutes-of-day at the given longitude. */
export function utcToLmstMinutes(utc: Date, longitude: number): number {
  const offsetMs = (longitude / 15) * 3600 * 1000;
  const shifted = utc.getTime() + offsetMs;
  const minutes = Math.floor(shifted / MS_PER_MINUTE) % MINUTES_PER_DAY;
  return ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Given an LMST time-of-day (minutes from LMST midnight) and a target calendar day,
 * return the UTC Date at which that LMST time occurs on that day.
 *
 * The `dayAnchor` is interpreted in the user's longitude frame — specifically, the UTC
 * day containing the requested LMST moment is derived from dayAnchor's date parts.
 */
export function lmstToUtc(lmstMinutes: number, longitude: number, dayAnchor: Date): Date {
  const y = dayAnchor.getUTCFullYear();
  const m = dayAnchor.getUTCMonth();
  const d = dayAnchor.getUTCDate();
  const lmstMidnightUtcMs = Date.UTC(y, m, d) - (longitude / 15) * 3600 * 1000;
  return new Date(lmstMidnightUtcMs + lmstMinutes * MS_PER_MINUTE);
}

/** Derive the LMST offset (minutes) of civil time for a longitude. Positive = LMST ahead of UTC. */
export function lmstOffsetMinutes(longitude: number): number {
  return Math.round((longitude / 15) * 60);
}

/** Interpolate LMST anchor during a travel transition. Returns effective longitude for scheduling. */
export function effectiveLongitude(
  transition: AnchorTransition | null,
  homeLongitude: number,
  now: Date
): number {
  if (!transition) return homeLongitude;
  const start = new Date(transition.startedAt).getTime();
  const end = new Date(transition.completesAt).getTime();
  const nowMs = now.getTime();
  if (nowMs <= start) return transition.fromLongitude;
  if (nowMs >= end) return transition.toLongitude;
  const frac = (nowMs - start) / (end - start);
  const delta = shortestLongitudeDelta(transition.fromLongitude, transition.toLongitude);
  return normalizeLongitude(transition.fromLongitude + delta * frac);
}

function shortestLongitudeDelta(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

export function normalizeLongitude(lon: number): number {
  let l = lon;
  while (l > 180) l -= 360;
  while (l <= -180) l += 360;
  return l;
}

export function normalizeLmstMinutes(minutes: number): number {
  return ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}
