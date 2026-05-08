/**
 * Failure Log API -- Stanford Life Design failure tracking.
 * Handles all /failure-log/* endpoints.
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
    /** GET /failure-log */
    getFailureLogs: build.query<FailureEntry[], number | void>({
      query: (limit) => `/failure-log?_limit=${limit || 50}`,
      providesTags: ['FailureLog'],
    }),

    /** POST /failure-log */
    createFailureLog: build.mutation<{ status: string; failure: FailureEntry }, Partial<FailureEntry>>({
      query: (body) => ({
        url: '/failure-log',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['FailureLog'],
    }),

    /** PUT /failure-log/:id */
    updateFailureLog: build.mutation<{ status: string; failure: FailureEntry }, { id: number } & Partial<FailureEntry>>({
      query: ({ id, ...body }) => ({
        url: `/failure-log/${id}`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['FailureLog'],
    }),

    /** DELETE /failure-log/:id */
    deleteFailureLog: build.mutation<{ status: string }, number>({
      query: (id) => ({
        url: `/failure-log/${id}`,
        method: 'DELETE',
      }),
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
