import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';

/**
 * localApi -- replaces baseApi for Mittens Open.
 * Uses fakeBaseQuery so endpoints can define their own queryFn
 * that talks directly to the local SQLite database instead of fetch.
 */
export const localApi = createApi({
  reducerPath: 'api',
  baseQuery: fakeBaseQuery(),
  tagTypes: ['DailySummary', 'WeeklySummary', 'MealPlan', 'Activity', 'CalendarEvent', 'Sleep', 'LocationLog'],
  endpoints: () => ({}),
});
