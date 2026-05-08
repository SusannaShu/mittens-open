/**
 * Planned Schedule API — Local implementation
 */

import { localApi } from '../localApi';

export interface PlannedBlock {
  id: number;
  date: string;
  blockType: 'wake' | 'breakfast' | 'lunch' | 'dinner' | 'bedtime';
  scheduledAt: string;
}

export const plannedScheduleApi = localApi.injectEndpoints({
  endpoints: (build) => ({
    getPlannedSchedule: build.query<{ date: string; blocks: PlannedBlock[] }, string>({
      queryFn: async (date) => ({ data: { date, blocks: [] } }),
      providesTags: ['DailySummary'],
    }),

    syncPlannedSchedule: build.mutation<
      { status: string; blocks: PlannedBlock[] },
      { date: string; blocks: { blockType: string; scheduledAt: string }[] }
    >({
      queryFn: async () => ({ data: { status: 'mocked', blocks: [] } }),
      invalidatesTags: ['DailySummary'],
    }),

    clearPlannedSchedule: build.mutation<{ status: string }, string>({
      queryFn: async () => ({ data: { status: 'cleared' } }),
      invalidatesTags: ['DailySummary'],
    }),
  }),
});

export const {
  useGetPlannedScheduleQuery,
  useSyncPlannedScheduleMutation,
  useClearPlannedScheduleMutation,
} = plannedScheduleApi;
