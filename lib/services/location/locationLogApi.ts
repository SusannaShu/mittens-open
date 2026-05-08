/**
 * RTK Query API for location logs.
 */

import { baseApi } from '../baseApi';

export interface LocationLog {
  id: number;
  latitude: number | null;
  longitude: number | null;
  eventType: 'enter' | 'exit' | 'significant_change' | 'motion_change';
  placeName: string | null;
  motionType: string | null;
  loggedAt: string;
}

export const locationLogApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getLocationLogs: build.query<LocationLog[], { since?: string; limit?: number }>({
      query: ({ since, limit = 100 }) => {
        const params = new URLSearchParams();
        params.set('_limit', String(limit));
        if (since) params.set('since', since);
        return `/location-logs?${params.toString()}`;
      },
      providesTags: ['LocationLog'],
    }),

    logLocation: build.mutation<LocationLog, Omit<LocationLog, 'id'>>({
      query: (body) => ({ url: '/location-logs', method: 'POST', body }),
      invalidatesTags: ['LocationLog'],
    }),
  }),
});

export const {
  useGetLocationLogsQuery,
  useLogLocationMutation,
} = locationLogApi;
