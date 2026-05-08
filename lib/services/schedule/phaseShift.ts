import { AnchorTransition } from '../../types';

export function initTransition(
  fromLon: number,
  toLon: number,
  now: Date,
  aggressiveness: 'gentle' | 'standard' | 'fast' = 'standard'
): AnchorTransition {
  const delta = Math.abs(shortestLongitudeDelta(fromLon, toLon));
  const totalShiftHours = delta / 15;                      // 1h per 15° longitude
  const perDayHours = aggressiveness === 'gentle' ? 0.5
                    : aggressiveness === 'fast'   ? 1.5
                    : 1.0;
  const days = Math.ceil(totalShiftHours / perDayHours);
  return {
    fromLongitude: fromLon,
    toLongitude: toLon,
    startedAt: now.toISOString(),
    completesAt: new Date(now.getTime() + days * 86400_000).toISOString(),
    perDayShiftMinutes: perDayHours * 60,
  };
}

function shortestLongitudeDelta(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}
