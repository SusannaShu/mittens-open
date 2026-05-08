/**
 * Planned Schedule API — RTK Query endpoints for LMST rhythm blocks.
 * These are projected schedule overlays, NOT activity logs.
 */

import { baseApi } from '../baseApi';

export interface PlannedBlock {
  id: number;
  date: string;
  blockType: 'wake' | 'breakfast' | 'lunch' | 'dinner' | 'bedtime';
  scheduledAt: string;
}

export const plannedScheduleApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** GET /planned-schedules/daily?date=YYYY-MM-DD */
    getPlannedSchedule: build.query<{ date: string; blocks: PlannedBlock[] }, string>({
      query: (date) => `/planned-schedules/daily?date=${date}`,
      providesTags: ['DailySummary'],
    }),

    /** POST /planned-schedules/sync */
    syncPlannedSchedule: build.mutation<
      { status: string; blocks: PlannedBlock[] },
      { date: string; blocks: { blockType: string; scheduledAt: string }[] }
    >({
      query: (body) => ({
        url: '/planned-schedules/sync',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['DailySummary'],
    }),

    /** DELETE /planned-schedules/clear?date=YYYY-MM-DD */
    clearPlannedSchedule: build.mutation<{ status: string }, string>({
      query: (date) => ({
        url: `/planned-schedules/clear?date=${date}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['DailySummary'],
    }),
  }),
});

export const {
  useGetPlannedScheduleQuery,
  useSyncPlannedScheduleMutation,
  useClearPlannedScheduleMutation,
} = plannedScheduleApi;
