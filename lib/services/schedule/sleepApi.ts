/**
 * sleepApi.ts -- Local SQLite-backed sleep log tracking.
 */

import { baseApi } from '../baseApi';
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

function rowToSleep(r: any): SleepEntry {
  return {
    id: r.id,
    sleepStart: r.went_to_bed,
    sleepEnd: r.woke_up,
    totalMinutes: r.total_minutes,
    quality: r.quality,
    source: 'manual',
    notes: r.notes,
    energy: r.energy,
    environment: null,
    created_at: r.created_at,
  };
}

export const sleepApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    logSleep: build.mutation<SleepEntry, {
      sleepStart?: string;
      sleepEnd?: string;
      totalMinutes?: number;
      quality?: string;
      source?: string;
      notes?: string;
      energy?: number;
      environment?: string;
    }>({
      queryFn: (body) => {
        try {
          const db = getDb();
          const now = new Date().toISOString();
          const result = db.runSync(
            `INSERT INTO sleep_logs (went_to_bed, woke_up, total_minutes, quality, energy, notes, logged_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              body.sleepStart || null,
              body.sleepEnd || null,
              body.totalMinutes || null,
              body.quality || null,
              body.energy ?? null,
              body.notes || null,
              now,
            ]
          );
          const id = (result as any).lastInsertRowId || 0;
          const row = db.getFirstSync('SELECT * FROM sleep_logs WHERE id = ?', [id]);
          return { data: row ? rowToSleep(row) : { id, ...body } as any };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['DailySummary'],
    }),

    getSleepLogs: build.query<SleepEntry[], { limit?: number; sleepStart_gte?: string; sleepEnd_lte?: string } | void>({
      queryFn: (params) => {
        try {
          const db = getDb();
          let sql = 'SELECT * FROM sleep_logs WHERE 1=1';
          const vals: any[] = [];
          if (params && typeof params === 'object') {
            if (params.sleepStart_gte) { sql += ' AND went_to_bed >= ?'; vals.push(params.sleepStart_gte); }
            if (params.sleepEnd_lte) { sql += ' AND woke_up <= ?'; vals.push(params.sleepEnd_lte); }
          }
          sql += ' ORDER BY logged_at DESC LIMIT ?';
          vals.push((params && typeof params === 'object' && params.limit) || 7);
          const rows = db.getAllSync(sql, vals) as any[];
          return { data: rows.map(rowToSleep) };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['DailySummary'],
    }),

    updateSleepLog: build.mutation<SleepEntry, { id: number } & Partial<SleepEntry>>({
      queryFn: ({ id, ...body }) => {
        try {
          const db = getDb();
          const sets: string[] = ["updated_at = datetime('now')"];
          const vals: any[] = [];
          if (body.sleepStart !== undefined) { sets.push('went_to_bed = ?'); vals.push(body.sleepStart); }
          if (body.sleepEnd !== undefined) { sets.push('woke_up = ?'); vals.push(body.sleepEnd); }
          if (body.totalMinutes !== undefined) { sets.push('total_minutes = ?'); vals.push(body.totalMinutes); }
          if (body.quality !== undefined) { sets.push('quality = ?'); vals.push(body.quality); }
          if (body.energy !== undefined) { sets.push('energy = ?'); vals.push(body.energy); }
          if (body.notes !== undefined) { sets.push('notes = ?'); vals.push(body.notes); }
          vals.push(id);
          db.runSync(`UPDATE sleep_logs SET ${sets.join(', ')} WHERE id = ?`, vals);
          const row = db.getFirstSync('SELECT * FROM sleep_logs WHERE id = ?', [id]);
          return { data: row ? rowToSleep(row) : { id } as any };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['DailySummary'],
    }),

    deleteSleepLog: build.mutation<{ status: string }, number>({
      queryFn: (id) => {
        try {
          const db = getDb();
          db.runSync('DELETE FROM sleep_logs WHERE id = ?', [id]);
          return { data: { status: 'ok' } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['DailySummary'],
    }),
  }),
});

export const {
  useLogSleepMutation,
  useGetSleepLogsQuery,
  useUpdateSleepLogMutation,
  useDeleteSleepLogMutation,
} = sleepApi;
