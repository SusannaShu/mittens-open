/**
 * RTK Query API for calendar events -- Local SQLite implementation.
 */

import { localApi } from './localApi';
import { getDb } from '../database';

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

export const calendarEventApi = localApi.injectEndpoints({
  endpoints: (build) => ({
    getTodayEvents: build.query<{ date: string; events: CalendarEvent[] }, string | void>({
      queryFn: async () => {
        try {
          const db = getDb();
          const targetDate = new Date().toLocaleDateString('en-CA');
          const rows = db.getAllSync(`SELECT * FROM calendar_events WHERE start_time LIKE ? ORDER BY start_time ASC`, [`${targetDate}%`]);
          const events = rows.map((r: any) => ({
            id: r.id,
            googleEventId: r.google_event_id,
            summary: r.title,
            location: r.location,
            startTime: r.start_time,
            endTime: r.end_time,
            description: r.description,
            calendarId: 'primary',
            isVirtual: false,
            meetingLink: null,
            date: targetDate
          }));
          return { data: { date: targetDate, events } };
        } catch (e) {
          return { error: { status: 500, data: String(e) } };
        }
      },
      providesTags: ['CalendarEvent'],
    }),

    getCalendarEvents: build.query<CalendarEvent[], any>({
      queryFn: async () => ({ data: [] }),
      providesTags: ['CalendarEvent'],
    }),

    syncCalendar: build.mutation<{ status: string; count: number }, void>({
      queryFn: async () => ({ data: { status: 'mocked', count: 0 } }),
      invalidatesTags: ['CalendarEvent'],
    }),

    storeCalendarToken: build.mutation<{ status: string }, any>({
      queryFn: async () => ({ data: { status: 'mocked' } }),
    }),

    deleteCalendarEvent: build.mutation<{ status: string }, number>({
      queryFn: async (id) => {
        getDb().runSync(`DELETE FROM calendar_events WHERE id = ?`, [id]);
        return { data: { status: 'deleted' } };
      },
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
