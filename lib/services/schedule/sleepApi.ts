/**
 * Sleep API -- Local SQLite implementation.
 */

import { localApi } from '../localApi';
import { getDb } from '../../database';

export interface SleepEntry {
  id: number;
  sleepStart: string | null;
  sleepEnd: string | null;
  totalMinutes: number | null;
  quality: 'poor' | 'fair' | 'good' | 'great' | null;
  source: 'manual' | 'inferred' | 'health_kit';
  notes: string | null;
  energy: number | null;
  environment: string | null;
  created_at: string;
}

export const sleepApi = localApi.injectEndpoints({
  endpoints: (build) => ({
    logSleep: build.mutation<SleepEntry, any>({
      queryFn: async (args) => {
        try {
          const db = getDb();
          db.runSync(
            `INSERT INTO sleep_logs (went_to_bed, woke_up, total_minutes, quality, notes, energy, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [args.sleepStart, args.sleepEnd, args.totalMinutes, args.quality, args.notes, args.energy, new Date().toISOString()]
          );
          return { data: { ...args, id: -1 } };
        } catch (e) {
          return { error: { status: 500, data: String(e) } };
        }
      },
      invalidatesTags: ['Sleep'],
    }),

    getSleepLogs: build.query<SleepEntry[], any>({
      queryFn: async () => {
        try {
          const db = getDb();
          const rows = db.getAllSync(`SELECT * FROM sleep_logs ORDER BY logged_at DESC LIMIT 7`);
          const logs = rows.map((r: any) => ({
            id: r.id,
            sleepStart: r.went_to_bed,
            sleepEnd: r.woke_up,
            totalMinutes: r.total_minutes,
            quality: r.quality,
            notes: r.notes,
            energy: r.energy,
            created_at: r.logged_at
          }));
          return { data: logs };
        } catch (e) {
          return { error: { status: 500, data: String(e) } };
        }
      },
      providesTags: ['Sleep'],
    }),

    updateSleepLog: build.mutation<SleepEntry, any>({
      queryFn: async (args) => {
        const { id, ...updates } = args;
        // In local mode, we just stub the update
        return { data: { id, ...updates } };
      },
      invalidatesTags: ['Sleep'],
    }),

    deleteSleepLog: build.mutation<{ status: string }, number>({
      queryFn: async (id) => {
        getDb().runSync(`DELETE FROM sleep_logs WHERE id = ?`, [id]);
        return { data: { status: 'deleted' } };
      },
      invalidatesTags: ['Sleep'],
    }),
  }),
});

export const {
  useLogSleepMutation,
  useGetSleepLogsQuery,
  useUpdateSleepLogMutation,
  useDeleteSleepLogMutation,
} = sleepApi;
