/**
 * RTK Query API for synced calendar events.
 */

import { baseApi } from './baseApi';

export interface CalendarEvent {
  id: number;
  googleEventId: string;
  summary: string;
  location: string | null;
  startTime: string;
  endTime: string | null;
  description: string | null;
  calendarId: string;
  isVirtual: boolean;
  meetingLink: string | null;
  date: string;
}

export const calendarEventApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getTodayEvents: build.query<{ date: string; events: CalendarEvent[] }, string | void>({
      query: (tz) => `/calendar-events/today${tz ? `?tz=${tz}` : ''}`,
      providesTags: ['CalendarEvent'],
    }),

    getCalendarEvents: build.query<CalendarEvent[], { date?: string; startTime_gte?: string; startTime_lte?: string }>({
      query: (params) => {
        const qs = new URLSearchParams();
        if (params.date) qs.set('date', params.date);
        if (params.startTime_gte) qs.set('startTime_gte', params.startTime_gte);
        if (params.startTime_lte) qs.set('startTime_lte', params.startTime_lte);
        return `/calendar-events?${qs.toString()}`;
      },
      providesTags: ['CalendarEvent'],
    }),

    syncCalendar: build.mutation<{ status: string; count: number }, void>({
      query: () => ({ url: `/calendar-events/sync?tz=${new Date().getTimezoneOffset()}`, method: 'POST' }),
      invalidatesTags: ['CalendarEvent'],
    }),

    storeCalendarToken: build.mutation<{ status: string }, { accessToken: string; refreshToken?: string; expiresAt?: string }>({
      query: (body) => ({ url: '/calendar-events/token', method: 'POST', body }),
    }),

    deleteCalendarEvent: build.mutation<{ status: string }, number>({
      query: (id) => ({ url: `/calendar-events/${id}`, method: 'DELETE' }),
      invalidatesTags: ['CalendarEvent'],
    }),
  }),
});

export const {
  useGetTodayEventsQuery,
  useGetCalendarEventsQuery,
  useSyncCalendarMutation,
  useStoreCalendarTokenMutation,
  useDeleteCalendarEventMutation,
} = calendarEventApi;
