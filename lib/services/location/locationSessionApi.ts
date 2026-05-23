/**
 * locationSessionApi.ts -- Local SQLite-backed location sessions.
 */

import { baseApi } from '../baseApi';
import { getDb } from '../../database';

export interface LocationSession {
  id: number;
  startedAt: string;
  endedAt: string | null;
  motionType: 'stationary' | 'walking' | 'running' | 'cycling' | 'driving' | 'unknown';
  placeName: string | null;
  placeId?: number | null;
  address?: string | null;
  neighborhood?: string | null;
  path: [number, number][];
  duration_min: number | null;
}

function rowToSession(r: any): LocationSession {
  return {
    id: r.id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    motionType: r.motion_type || 'unknown',
    placeName: r.place_name,
    address: r.address || null,
    neighborhood: r.neighborhood || null,
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
            `SELECT * FROM location_sessions 
             WHERE date(started_at, 'localtime') = ? 
                OR date(started_at) = ? 
                OR date(ended_at, 'localtime') = ? 
                OR date(ended_at) = ? 
                OR ended_at IS NULL 
             ORDER BY started_at ASC`,
            [date, date, date, date]
          ) as any[];
          return { data: rows.map(rowToSession) };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['DailySummary'],
    }),
    deleteLocationSession: build.mutation<{ status: string }, number>({
      queryFn: (id) => {
        try {
          const db = getDb();
          db.runSync('DELETE FROM location_sessions WHERE id = ?', [id]);
          return { data: { status: 'ok' } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['DailySummary'],
    }),
  }),
});

export const { useGetLocationSessionsQuery, useDeleteLocationSessionMutation } = locationSessionApi;
