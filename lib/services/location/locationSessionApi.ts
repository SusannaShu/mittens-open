/**
 * Location Session API -- RTK Query for location sessions on the Reflect calendar.
 * Injects into baseApi for shared caching/middleware.
 */

import { baseApi } from '../baseApi';

export interface LocationSession {
  startedAt: string;
  endedAt: string | null; // null = ongoing
  motionType: 'stationary' | 'walking' | 'running' | 'cycling' | 'driving' | 'unknown';
  placeName: string | null;
  placeId?: number | null;
  path: [number, number][]; // [[lat, lon], ...]
  duration_min: number | null; // null = ongoing (compute live)
}

export const locationSessionApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getLocationSessions: build.query<LocationSession[], string>({
      query: (date) => `/location-logs/sessions?date=${date}`,
      transformResponse: (res: { sessions: LocationSession[] }) => res.sessions,
    }),
  }),
});

export const { useGetLocationSessionsQuery } = locationSessionApi;
