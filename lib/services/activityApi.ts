/**
 * activityApi.ts -- Local SQLite-backed activity tracking API.
 */

import { baseApi } from './baseApi';
import { getDb } from '../database';

export interface HealthPillarImpact {
  pillarId: string;
  delta: number;
  unit: string;
  reason: string;
  citationKey: string | null;
}

export interface ImpactLedger {
  lifeCategories?: Record<string, number>;
  lifeCategoryReasons?: Record<string, string>;
  aeiou?: Record<string, string>;
  healthPillars?: HealthPillarImpact[];
  nutrientImpact?: Record<string, number>;
  nutrientReasons?: Record<string, string>;
  mets?: number | null;
  metsSource?: string | null;
  aiReasoning?: string;
  computedAt?: string;
  userOverrides?: Record<string, any>;
}

export interface ActivityEntry {
  id: number;
  loggedAt: string;
  endedAt?: string | null;
  activityType: string;
  logName: string;
  duration_min?: number;
  intensity?: 'low' | 'moderate' | 'high';
  outdoors?: boolean;
  location?: string | null;
  nutrientImpact?: Record<string, number>;
  absorptionMultiplier?: number;
  engagement?: number | null;
  engagementReason?: string | null;
  energy?: number | null;
  energyReason?: string | null;
  aeiou?: Record<string, string> | null;
  lifeCategory?: 'work' | 'health' | 'play' | 'love';
  lifeCategories?: Record<string, number> | null;
  impactLedger?: ImpactLedger | null;
  source?: string;
  notes?: string | null;
  meta?: Record<string, any>;
  image?: Array<{ id: number; url: string }> | null;
  googleEventId?: string | null;
  mets?: number | null;
  isNature?: boolean;
  isStrength?: boolean;
  needsReflection?: boolean;
  failure_logs?: any[];
}

export interface BreakdownActivity {
  id: number;
  logName: string;
  activityType: string;
  duration_min: number;
  weight: number;
  weighted_min: number;
  loggedAt: string;
  engagement: number | null;
  energy: number | null;
}

export interface PillarContributor {
  activityId: number;
  logName: string;
  activityType: string;
  loggedAt: string;
  delta: number;
  unit: string;
  reason: string;
  citationKey: string | null;
}

export interface DashboardGauges {
  gauges: { work: number; health: number; play: number; love: number };
  healthPillars?: any[];
  breakdown: Record<string, BreakdownActivity[]>;
  pillarContributors?: Record<string, PillarContributor[]>;
  period: string;
}

export interface ActivityPattern {
  activityType: string;
  count: number;
  avgEngagement: number | null;
  avgEnergy: number | null;
}

function rowToActivity(r: any): ActivityEntry {
  return {
    id: r.id,
    loggedAt: r.logged_at,
    activityType: r.activity_type || 'other',
    logName: r.log_name || 'Activity',
    duration_min: r.duration_min,
    intensity: r.intensity,
    outdoors: !!r.outdoors,
    location: r.location,
    engagement: r.engagement,
    energy: r.energy,
    aeiou: r.aeiou ? JSON.parse(r.aeiou) : null,
    lifeCategories: r.life_categories ? JSON.parse(r.life_categories) : null,
    source: r.source,
    mets: r.mets,
    isNature: !!r.is_nature,
    isStrength: !!r.is_strength,
    meta: r.meta ? JSON.parse(r.meta) : undefined,
    googleEventId: r.google_event_id,
  };
}

export const activityApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    logActivity: build.mutation<{ status: string; activity: ActivityEntry }, Partial<ActivityEntry>>({
      queryFn: (body) => {
        try {
          const db = getDb();
          const now = body.loggedAt || new Date().toISOString();
          const result = db.runSync(
            `INSERT INTO activity_logs (logged_at, activity_type, log_name, duration_min, intensity, outdoors, location, engagement, energy, mets, is_nature, is_strength, source, aeiou, life_categories, meta)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              now,
              body.activityType || 'other',
              body.logName || 'Activity',
              body.duration_min || 0,
              body.intensity || 'moderate',
              body.outdoors ? 1 : 0,
              body.location || null,
              body.engagement ?? null,
              body.energy ?? null,
              body.mets ?? null,
              body.isNature ? 1 : 0,
              body.isStrength ? 1 : 0,
              body.source || 'manual',
              body.aeiou ? JSON.stringify(body.aeiou) : null,
              body.lifeCategories ? JSON.stringify(body.lifeCategories) : null,
              body.meta ? JSON.stringify(body.meta) : null,
            ]
          );
          const id = (result as any).lastInsertRowId || 0;
          const row = db.getFirstSync('SELECT * FROM activity_logs WHERE id = ?', [id]);
          return { data: { status: 'ok', activity: row ? rowToActivity(row) : { ...body, id } as any } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['DailySummary'],
    }),

    getDailyActivities: build.query<{ date: string; activities: ActivityEntry[]; count: number }, string | void>({
      queryFn: (date) => {
        try {
          const db = getDb();
          const localDate = date || new Date().toLocaleDateString('en-CA');
          const rows = db.getAllSync(
            'SELECT * FROM activity_logs WHERE date(logged_at) = ? ORDER BY logged_at ASC',
            [localDate]
          ) as any[];
          return {
            data: {
              date: localDate,
              activities: rows.map(rowToActivity),
              count: rows.length,
            },
          };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['DailySummary'],
    }),

    reflectActivity: build.mutation<{ status: string; activity: ActivityEntry }, any>({
      queryFn: ({ id, ...body }) => {
        try {
          const db = getDb();
          const existing = db.getFirstSync('SELECT * FROM activity_logs WHERE id = ?', [id]) as any;
          if (!existing) throw new Error('Activity not found');

          const sets: string[] = ["updated_at = datetime('now')"];
          const vals: any[] = [];
          let duration = body.duration_min !== undefined ? body.duration_min : existing.duration_min;
          let outdoors = body.outdoors !== undefined ? (body.outdoors ? 1 : 0) : existing.outdoors;
          let isNature = body.isNature !== undefined ? (body.isNature ? 1 : 0) : existing.is_nature;

          if (body.logName !== undefined) { sets.push('log_name = ?'); vals.push(body.logName); }
          if (body.duration_min !== undefined) { sets.push('duration_min = ?'); vals.push(body.duration_min); }
          if (body.loggedAt !== undefined) { sets.push('logged_at = ?'); vals.push(body.loggedAt); }
          if (body.activityType !== undefined) { sets.push('activity_type = ?'); vals.push(body.activityType); }
          if (body.engagement !== undefined) { sets.push('engagement = ?'); vals.push(body.engagement); }
          if (body.energy !== undefined) { sets.push('energy = ?'); vals.push(body.energy); }
          if (body.intensity !== undefined) { sets.push('intensity = ?'); vals.push(body.intensity); }
          if (body.location !== undefined) { sets.push('location = ?'); vals.push(body.location); }
          if (body.outdoors !== undefined) { sets.push('outdoors = ?'); vals.push(body.outdoors ? 1 : 0); }
          if (body.isNature !== undefined) { sets.push('is_nature = ?'); vals.push(body.isNature ? 1 : 0); }
          if (body.aeiou !== undefined) { sets.push('aeiou = ?'); vals.push(body.aeiou ? JSON.stringify(body.aeiou) : null); }
          if (body.lifeCategories !== undefined) { sets.push('life_categories = ?'); vals.push(body.lifeCategories ? JSON.stringify(body.lifeCategories) : null); }
          if (body.meta !== undefined) { sets.push('meta = ?'); vals.push(body.meta ? JSON.stringify(body.meta) : null); }

          let nutrientImpact = existing.nutrient_impact ? JSON.parse(existing.nutrient_impact) : {};
          if (outdoors || isNature) {
             nutrientImpact.vitamin_d = (duration || 0) * 1.5;
             sets.push('nutrient_impact = ?');
             vals.push(JSON.stringify(nutrientImpact));
          } else if (nutrientImpact.vitamin_d !== undefined) {
             delete nutrientImpact.vitamin_d;
             sets.push('nutrient_impact = ?');
             vals.push(Object.keys(nutrientImpact).length > 0 ? JSON.stringify(nutrientImpact) : null);
          }
          vals.push(id);
          db.runSync(`UPDATE activity_logs SET ${sets.join(', ')} WHERE id = ?`, vals);
          const row = db.getFirstSync('SELECT * FROM activity_logs WHERE id = ?', [id]);
          return { data: { status: 'ok', activity: row ? rowToActivity(row) : { id } as any } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['DailySummary'],
    }),

    getDashboardGauges: build.query<DashboardGauges, number | void>({
      queryFn: () => ({
        data: {
          gauges: { work: 0, health: 0, play: 0, love: 0 },
          breakdown: {},
          period: '7d',
        },
      }),
      providesTags: ['DailySummary'],
    }),

    getActivityPatterns: build.query<{ patterns: ActivityPattern[] }, number | void>({
      queryFn: () => ({ data: { patterns: [] } }),
    }),

    deleteActivity: build.mutation<{ status: string }, number>({
      queryFn: (id) => {
        try {
          const db = getDb();
          db.runSync('DELETE FROM activity_logs WHERE id = ?', [id]);
          return { data: { status: 'ok' } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['DailySummary'],
    }),

    getWeeklyActivities: build.query<{ startDate: string; days: Record<string, ActivityEntry[]> }, string | void>({
      queryFn: () => ({ data: { startDate: '', days: {} } }),
      providesTags: ['DailySummary'],
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
