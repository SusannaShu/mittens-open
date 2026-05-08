/**
 * Failure Log API -- Local implementation
 */

import { localApi } from './localApi';

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

export const failureApi = localApi.injectEndpoints({
  endpoints: (build) => ({
    getFailureLogs: build.query<FailureEntry[], number | void>({
      queryFn: async () => ({ data: [] }),
      providesTags: ['FailureLog'] as any,
    }),

    createFailureLog: build.mutation<{ status: string; failure: FailureEntry }, Partial<FailureEntry>>({
      queryFn: async (args) => ({ data: { status: 'mock', failure: { ...args, id: -1 } as FailureEntry } }),
      invalidatesTags: ['FailureLog'] as any,
    }),

    updateFailureLog: build.mutation<{ status: string; failure: FailureEntry }, { id: number } & Partial<FailureEntry>>({
      queryFn: async (args) => ({ data: { status: 'mock', failure: args as FailureEntry } }),
      invalidatesTags: ['FailureLog'] as any,
    }),

    deleteFailureLog: build.mutation<{ status: string }, number>({
      queryFn: async () => ({ data: { status: 'deleted' } }),
      invalidatesTags: ['FailureLog'] as any,
    }),
  }),
});

export const {
  useGetFailureLogsQuery,
  useCreateFailureLogMutation,
  useUpdateFailureLogMutation,
  useDeleteFailureLogMutation,
} = failureApi;
