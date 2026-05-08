/**
 * RTK Query API for location logs -- Local SQLite implementation.
 */

import { localApi } from '../localApi';
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

export const locationLogApi = localApi.injectEndpoints({
  endpoints: (build) => ({
    getLocationLogs: build.query<LocationLog[], any>({
      queryFn: async () => {
        try {
          const db = getDb();
          const rows = db.getAllSync(`SELECT * FROM location_logs ORDER BY recorded_at DESC LIMIT 100`);
          return { data: rows.map((r: any) => ({
            id: r.id,
            latitude: r.latitude,
            longitude: r.longitude,
            eventType: 'significant_change',
            placeName: r.place_name,
            motionType: r.activity_type,
            loggedAt: r.recorded_at
          }))};
        } catch(e) {
          return { error: { status: 500, data: String(e) } };
        }
      },
      providesTags: ['LocationLog'],
    }),

    logLocation: build.mutation<LocationLog, Omit<LocationLog, 'id'>>({
      queryFn: async (args) => {
        const db = getDb();
        db.runSync(
          `INSERT INTO location_logs (latitude, longitude, activity_type, place_name, recorded_at) VALUES (?, ?, ?, ?, ?)`,
          [args.latitude, args.longitude, args.motionType, args.placeName, args.loggedAt]
        );
        return { data: { ...args, id: -1 } as LocationLog };
      },
      invalidatesTags: ['LocationLog'],
    }),
  }),
});

export const {
  useGetLocationLogsQuery,
  useLogLocationMutation,
} = locationLogApi;
