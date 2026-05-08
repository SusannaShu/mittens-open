/**
 * Sleep API -- sleep log tracking.
 * Handles all /sleep-logs endpoints.
 */

import { baseApi } from '../baseApi';

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

export const sleepApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** POST /sleep-logs -- log a new sleep entry */
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
      query: (body) => ({
        url: '/sleep-logs',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['DailySummary'],
    }),

    /** GET /sleep-logs */
    getSleepLogs: build.query<SleepEntry[], { limit?: number; sleepStart_gte?: string; sleepEnd_lte?: string } | void>({
      query: (params) => {
        const qs = new URLSearchParams();
        if (params && typeof params === 'object') {
          if (params.limit) qs.set('_limit', String(params.limit));
          if (params.sleepStart_gte) qs.set('sleepStart_gte', params.sleepStart_gte);
          if (params.sleepEnd_lte) qs.set('sleepEnd_lte', params.sleepEnd_lte);
        } else {
          qs.set('_limit', '7');
        }
        return `/sleep-logs?${qs.toString()}`;
      },
      providesTags: ['DailySummary'],
    }),

    /** PUT /sleep-logs/:id */
    updateSleepLog: build.mutation<SleepEntry, { id: number } & Partial<SleepEntry>>({
      query: ({ id, ...body }) => ({
        url: `/sleep-logs/${id}`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['DailySummary'],
    }),

    /** DELETE /sleep-logs/:id */
    deleteSleepLog: build.mutation<{ status: string }, number>({
      query: (id) => ({
        url: `/sleep-logs/${id}`,
        method: 'DELETE',
      }),
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
