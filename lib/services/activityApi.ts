/**
 * Activity API -- Local SQLite implementation for Mittens Open.
 * Replaces Strapi cloud endpoints with direct database queries.
 */

import { localApi } from './localApi';
import { getDb } from '../database';
import { ActivityEntry, DashboardGauges, ActivityPattern } from '../types';

export const activityApi = localApi.injectEndpoints({
  endpoints: (build) => ({
    logActivity: build.mutation<{ status: string; activity: ActivityEntry }, Partial<ActivityEntry>>({
      queryFn: async (args) => {
        try {
          const db = getDb();
          const loggedAt = args.loggedAt || new Date().toISOString();
          db.runSync(
            `INSERT INTO activity_logs (log_name, activity_type, duration_min, intensity, logged_at, outdoors, location, source) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              args.logName || '',
              args.activityType || 'other',
              args.duration_min || 0,
              args.intensity || 'moderate',
              loggedAt,
              args.outdoors ? 1 : 0,
              args.location || null,
              args.source || 'manual'
            ]
          );
          return { data: { status: 'success', activity: { ...args, loggedAt, id: -1 } as ActivityEntry } };
        } catch (e) {
          return { error: { status: 500, data: String(e) } };
        }
      },
      invalidatesTags: ['Activity'],
    }),

    getDailyActivities: build.query<{ date: string; activities: ActivityEntry[]; count: number }, string | void>({
      queryFn: async (date) => {
        try {
          const db = getDb();
          const targetDate = date || new Date().toLocaleDateString('en-CA');
          const rows = db.getAllSync(`SELECT * FROM activity_logs WHERE logged_at LIKE ? ORDER BY logged_at ASC`, [`${targetDate}%`]);
          
          const activities = rows.map((r: any) => ({
            id: r.id,
            logName: r.log_name,
            activityType: r.activity_type,
            duration_min: r.duration_min,
            intensity: r.intensity,
            loggedAt: r.logged_at,
            outdoors: Boolean(r.outdoors),
            location: r.location,
            engagement: r.engagement,
            energy: r.energy,
            source: r.source,
            lifeCategories: r.life_categories ? JSON.parse(r.life_categories) : null,
            meta: r.meta ? JSON.parse(r.meta) : null
          }));
          return { data: { date: targetDate, activities, count: activities.length } };
        } catch (e) {
          return { error: { status: 500, data: String(e) } };
        }
      },
      providesTags: ['Activity'],
    }),

    reflectActivity: build.mutation<{ status: string; activity: ActivityEntry }, any>({
      queryFn: async (args) => {
        try {
          const db = getDb();
          db.runSync(
            `UPDATE activity_logs SET log_name = ?, duration_min = ?, activity_type = ?, location = ?, intensity = ?, engagement = ?, energy = ?, outdoors = ? WHERE id = ?`,
            [
              args.logName, args.duration_min, args.activityType, args.location, args.intensity,
              args.engagement, args.energy, args.outdoors ? 1 : 0, args.id
            ]
          );
          return { data: { status: 'success', activity: args as ActivityEntry } };
        } catch (e) {
          return { error: { status: 500, data: String(e) } };
        }
      },
      invalidatesTags: ['Activity'],
    }),

    getDashboardGauges: build.query<DashboardGauges, number | void>({
      queryFn: async () => ({
        data: { gauges: { work: 0, health: 0, play: 0, love: 0 }, breakdown: {}, period: '7 days' }
      }),
      providesTags: ['Activity'],
    }),

    getActivityPatterns: build.query<{ patterns: ActivityPattern[] }, number | void>({
      queryFn: async () => ({ data: { patterns: [] } }),
    }),

    deleteActivity: build.mutation<{ status: string }, number>({
      queryFn: async (id) => {
        getDb().runSync(`DELETE FROM activity_logs WHERE id = ?`, [id]);
        return { data: { status: 'deleted' } };
      },
      invalidatesTags: ['Activity'],
    }),

    getWeeklyActivities: build.query<{ startDate: string; days: Record<string, ActivityEntry[]> }, string | void>({
      queryFn: async () => ({ data: { startDate: new Date().toLocaleDateString('en-CA'), days: {} } }),
      providesTags: ['Activity'],
    }),
  }),
});

export const {
  useLogActivityMutation,
  useGetDailyActivitiesQuery,
  useReflectActivityMutation,
  useGetDashboardGaugesQuery,
  useGetActivityPatternsQuery,
  useDeleteActivityMutation,
  useGetWeeklyActivitiesQuery,
} = activityApi;
