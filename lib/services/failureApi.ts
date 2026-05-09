/**
 * failureApi.ts -- Local stub for failure log tracking.
 */

import { baseApi } from './baseApi';

export interface FailureEntry {
  id: number;
  loggedAt: string;
  failure: string;
  category: 'screwup' | 'weakness' | 'growth_opportunity';
  insight?: string | null;
  relatedActivityType?: string | null;
  relatedActivityId?: number | null;
  context?: Record<string, any> | null;
}

export const failureApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getFailureLogs: build.query<FailureEntry[], number | void>({
      queryFn: () => ({ data: [] }),
      providesTags: ['FailureLog'],
    }),

    createFailureLog: build.mutation<{ status: string; failure: FailureEntry }, Partial<FailureEntry>>({
      queryFn: (body) => ({
        data: {
          status: 'ok',
          failure: {
            id: Date.now(),
            loggedAt: new Date().toISOString(),
            failure: body.failure || '',
            category: body.category || 'growth_opportunity',
            ...body,
          } as FailureEntry,
        },
      }),
      invalidatesTags: ['FailureLog'],
    }),

    updateFailureLog: build.mutation<{ status: string; failure: FailureEntry }, { id: number } & Partial<FailureEntry>>({
      queryFn: ({ id, ...body }) => ({
        data: { status: 'ok', failure: { id, ...body } as FailureEntry },
      }),
      invalidatesTags: ['FailureLog'],
    }),

    deleteFailureLog: build.mutation<{ status: string }, number>({
      queryFn: () => ({ data: { status: 'ok' } }),
      invalidatesTags: ['FailureLog'],
    }),
  }),
});

export const {
  useGetFailureLogsQuery,
  useCreateFailureLogMutation,
  useUpdateFailureLogMutation,
  useDeleteFailureLogMutation,
} = failureApi;
