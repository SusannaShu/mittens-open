/**
 * baseApi.ts -- RTK Query base for mittens-open (local-only).
 *
 * Uses fakeBaseQuery since there is no remote server.
 * Each API slice uses queryFn to run SQLite operations directly.
 */

import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: fakeBaseQuery(),
  tagTypes: [
    'DailySummary',
    'WeeklySummary',
    'Profile',
    'Pantry',
    'Messages',
    'FailureLog',
    'KnownPlace',
    'LocationLog',
    'CalendarEvent',
    'MealPlan',
    'UnifiedCalendar',
    'ActivityTypes',
  ],
  endpoints: () => ({}),
});
