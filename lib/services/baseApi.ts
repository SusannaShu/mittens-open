import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { getAuthToken, setAuthToken, getApiBase } from '../api';

// Dynamic base query: resolves getApiBase() on each request so the tunnel URL
// (resolved async during initApiBase) is picked up even though this module loads first.
const rawBaseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, extraOptions) => {
  const dynamicBaseQuery = fetchBaseQuery({
    baseUrl: getApiBase(),
    prepareHeaders: (headers) => {
      const token = getAuthToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      headers.set('Content-Type', 'application/json');
      return headers;
    },
  });
  return dynamicBaseQuery(args, api, extraOptions);
};

// Wrap base query to handle sliding-window token refresh
const baseQueryWithRefresh: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, extraOptions) => {
  const result = await rawBaseQuery(args, api, extraOptions);

  // Check for refreshed token in response header
  const meta = result.meta as any;
  if (meta?.response?.headers) {
    const refreshedToken = meta.response.headers.get('X-Refreshed-Token');
    if (refreshedToken) {
      setAuthToken(refreshedToken);
    }
  }

  return result;
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithRefresh,
  tagTypes: ['DailySummary', 'WeeklySummary', 'Profile', 'Pantry', 'Messages', 'FailureLog', 'KnownPlace', 'LocationLog', 'CalendarEvent', 'MealPlan', 'UnifiedCalendar', 'DevTask', 'QueueStatus'],
  endpoints: () => ({}),
});
