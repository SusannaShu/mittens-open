/**
 * locationLogApi.ts -- Local SQLite-backed location logs.
 */

import { baseApi } from '../baseApi';
import { getDb } from '../../database';

export interface LocationLog {
  id: number;
  latitude: number | null;
  longitude: number | null;
  eventType: 'enter' | 'exit' | 'significant_change' | 'motion_change';
  placeName: string | null;
  motionType: string | null;
  loggedAt: string;
}

function rowToLog(r: any): LocationLog {
  return {
    id: r.id,
    latitude: r.latitude,
    longitude: r.longitude,
    eventType: 'significant_change',
    placeName: r.place_name,
    motionType: r.activity_type,
    loggedAt: r.recorded_at,
  };
}

export const locationLogApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getLocationLogs: build.query<LocationLog[], { since?: string; limit?: number }>({
      queryFn: ({ since, limit = 100 }) => {
        try {
          const db = getDb();
          let sql = 'SELECT * FROM location_logs';
          const vals: any[] = [];
          if (since) { sql += ' WHERE recorded_at >= ?'; vals.push(since); }
          sql += ' ORDER BY recorded_at DESC LIMIT ?';
          vals.push(limit);
          const rows = db.getAllSync(sql, vals) as any[];
          return { data: rows.map(rowToLog) };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['LocationLog'],
    }),

    logLocation: build.mutation<LocationLog, Omit<LocationLog, 'id'>>({
      queryFn: (body) => {
        try {
          const db = getDb();
          const result = db.runSync(
            'INSERT INTO location_logs (latitude, longitude, activity_type, place_name) VALUES (?, ?, ?, ?)',
            [body.latitude, body.longitude, body.motionType, body.placeName]
          );
          return { data: { ...body, id: (result as any).lastInsertRowId || 0 } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['LocationLog'],
    }),
  }),
});

export const {
  useGetLocationLogsQuery,
  useLogLocationMutation,
} = locationLogApi;
