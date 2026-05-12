/**
 * locationSessionApi.ts -- Local SQLite-backed location sessions.
 */

import { baseApi } from '../baseApi';
import { getDb } from '../../database';

export interface LocationSession {
  startedAt: string;
  endedAt: string | null;
  motionType: 'stationary' | 'walking' | 'running' | 'cycling' | 'driving' | 'unknown';
  placeName: string | null;
  placeId?: number | null;
  path: [number, number][];
  duration_min: number | null;
}

function rowToSession(r: any): LocationSession {
  return {
    startedAt: r.started_at,
    endedAt: r.ended_at,
    motionType: r.motion_type || 'unknown',
    placeName: r.place_name,
    path: r.trail ? JSON.parse(r.trail) : [],
    duration_min: r.ended_at && r.started_at
      ? Math.round((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 60000)
      : null,
  };
}

export const locationSessionApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getLocationSessions: build.query<LocationSession[], string>({
      queryFn: (date) => {
        try {
          const db = getDb();
          const rows = db.getAllSync(
            "SELECT * FROM location_sessions WHERE date(started_at, 'localtime') = ? OR date(started_at) = ? ORDER BY started_at ASC",
            [date, date]
          ) as any[];
          console.log(`[LocationSessionApi] date=${date}, raw rows (${rows.length}):`);
          rows.forEach((r, i) => {
            const trail = r.trail ? JSON.parse(r.trail) : [];
            console.log(`  [${i}] id=${r.id} motion=${r.motion_type} started=${r.started_at} ended=${r.ended_at} place=${r.place_name} trailPts=${trail.length} dist=${r.distance_m}`);
          });
          const sessions = rows.map(rowToSession);
          console.log(`[LocationSessionApi] mapped sessions (${sessions.length}):`);
          sessions.forEach((s, i) => {
            console.log(`  [${i}] motion=${s.motionType} start=${s.startedAt} end=${s.endedAt} place=${s.placeName} pathPts=${s.path.length} dur=${s.duration_min}min`);
          });
          return { data: sessions };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
    }),
  }),
});

export const { useGetLocationSessionsQuery } = locationSessionApi;
