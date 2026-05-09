/**
 * plannedScheduleApi.ts -- Local SQLite-backed planned schedule blocks.
 */

import { baseApi } from '../baseApi';
import { getDb } from '../../database';

export interface PlannedBlock {
  id: number;
  date: string;
  blockType: 'wake' | 'breakfast' | 'lunch' | 'dinner' | 'bedtime';
  scheduledAt: string;
}

export const plannedScheduleApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getPlannedSchedule: build.query<{ date: string; blocks: PlannedBlock[] }, string>({
      queryFn: (date) => {
        try {
          const db = getDb();
          const row = db.getFirstSync(
            'SELECT * FROM planned_schedules WHERE schedule_date = ?',
            [date]
          ) as any;
          if (!row || !row.events) {
            return { data: { date, blocks: [] } };
          }
          const blocks = JSON.parse(row.events) as PlannedBlock[];
          return { data: { date, blocks } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['DailySummary'],
    }),

    syncPlannedSchedule: build.mutation<
      { status: string; blocks: PlannedBlock[] },
      { date: string; blocks: { blockType: string; scheduledAt: string }[] }
    >({
      queryFn: ({ date, blocks }) => {
        try {
          const db = getDb();
          // Upsert: delete existing then insert
          db.runSync('DELETE FROM planned_schedules WHERE schedule_date = ?', [date]);
          const fullBlocks = blocks.map((b, i) => ({
            id: i + 1,
            date,
            blockType: b.blockType,
            scheduledAt: b.scheduledAt,
          }));
          db.runSync(
            'INSERT INTO planned_schedules (schedule_date, events) VALUES (?, ?)',
            [date, JSON.stringify(fullBlocks)]
          );
          return { data: { status: 'ok', blocks: fullBlocks as PlannedBlock[] } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['DailySummary'],
    }),

    clearPlannedSchedule: build.mutation<{ status: string }, string>({
      queryFn: (date) => {
        try {
          const db = getDb();
          db.runSync('DELETE FROM planned_schedules WHERE schedule_date = ?', [date]);
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
  useGetPlannedScheduleQuery,
  useSyncPlannedScheduleMutation,
  useClearPlannedScheduleMutation,
} = plannedScheduleApi;
