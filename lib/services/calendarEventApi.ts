/**
 * calendarEventApi.ts -- Local SQLite-backed calendar events.
 */

import { baseApi } from './baseApi';
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

function rowToEvent(r: any): CalendarEvent {
  return {
    id: r.id,
    googleEventId: r.google_event_id || '',
    summary: r.title || '',
    location: r.location,
    startTime: r.start_time || '',
    endTime: r.end_time,
    description: r.description,
    calendarId: '',
    isVirtual: false,
    meetingLink: null,
    date: r.start_time ? r.start_time.split('T')[0] : '',
  };
}

export const calendarEventApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getTodayEvents: build.query<{ date: string; events: CalendarEvent[] }, string | void>({
      queryFn: () => {
        try {
          const db = getDb();
          const today = new Date().toLocaleDateString('en-CA');
          const rows = db.getAllSync(
            'SELECT * FROM calendar_events WHERE date(start_time) = ? ORDER BY start_time ASC',
            [today]
          ) as any[];
          return { data: { date: today, events: rows.map(rowToEvent) } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['CalendarEvent'],
    }),

    getCalendarEvents: build.query<CalendarEvent[], { date?: string; startTime_gte?: string; startTime_lte?: string }>({
      queryFn: (params) => {
        try {
          const db = getDb();
          let sql = 'SELECT * FROM calendar_events WHERE 1=1';
          const vals: any[] = [];
          if (params.date) { sql += ' AND date(start_time) = ?'; vals.push(params.date); }
          if (params.startTime_gte) { sql += ' AND start_time >= ?'; vals.push(params.startTime_gte); }
          if (params.startTime_lte) { sql += ' AND start_time <= ?'; vals.push(params.startTime_lte); }
          sql += ' ORDER BY start_time ASC';
          const rows = db.getAllSync(sql, vals) as any[];
          return { data: rows.map(rowToEvent) };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['CalendarEvent'],
    }),

    syncCalendar: build.mutation<{ status: string; count: number }, void>({
      queryFn: () => ({ data: { status: 'no_token', count: 0 } }),
      invalidatesTags: ['CalendarEvent'],
    }),

    storeCalendarToken: build.mutation<{ status: string }, { accessToken: string; refreshToken?: string; expiresAt?: string }>({
      queryFn: () => ({ data: { status: 'ok' } }),
    }),

    deleteCalendarEvent: build.mutation<{ status: string }, number>({
      queryFn: (id) => {
        try {
          const db = getDb();
          db.runSync('DELETE FROM calendar_events WHERE id = ?', [id]);
          return { data: { status: 'ok' } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
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
