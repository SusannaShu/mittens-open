/**
 * Location Session API -- Local implementation
 */

import { localApi } from '../localApi';

export interface LocationSession {
  startedAt: string;
  endedAt: string | null;
  motionType: 'stationary' | 'walking' | 'running' | 'cycling' | 'driving' | 'unknown';
  placeName: string | null;
  placeId?: number | null;
  path: [number, number][];
  duration_min: number | null;
}

export const locationSessionApi = localApi.injectEndpoints({
  endpoints: (build) => ({
    getLocationSessions: build.query<LocationSession[], string>({
      queryFn: async () => ({ data: [] }),
    }),
  }),
});

export const { useGetLocationSessionsQuery } = locationSessionApi;
