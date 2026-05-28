/**
 * activityApi.ts -- Local SQLite-backed activity tracking API.
 */

import { baseApi } from './baseApi';
import { getDb } from '../database';
import { HealthPillarService } from './healthPillarService';

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
  originSessionId?: number | null;
  mets?: number | null;
  isNature?: boolean;
  isStrength?: boolean;
  needsReflection?: boolean;
  failure_logs?: any[];
}

export interface BreakdownActivity extends ActivityEntry {
  weight: number;
  weighted_min: number;
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
    originSessionId: r.origin_session_id,
  };
}

function getDefaultWeights(type: string): Record<string, number> {
  const DEFAULTS: Record<string, Record<string, number>> = {
    work:       { work: 1.0 },
    coding:     { work: 0.9, play: 0.1 },
    study:      { work: 0.8, health: 0.1, play: 0.1 },
    exercise:   { health: 0.8, play: 0.2 },
    workout:    { health: 0.9, play: 0.1 },
    yoga:       { health: 0.7, play: 0.2, love: 0.1 },
    meditation: { health: 0.8, play: 0.2 },
    social:     { love: 0.6, play: 0.3, health: 0.1 },
    hangout:    { love: 0.5, play: 0.4, health: 0.1 },
    walk:       { health: 0.6, play: 0.3, love: 0.1 },
    run:        { health: 0.9, play: 0.1 },
    bike:       { health: 0.8, play: 0.2 },
    cooking:    { health: 0.4, play: 0.3, love: 0.3 },
    reading:    { play: 0.6, work: 0.2, health: 0.2 },
    scrolling:  { play: 0.5 },
    sun:        { health: 1.0 },
    rest:       { health: 0.7, play: 0.3 },
    commute:    { work: 1.0 },
    nature:     { health: 0.7, play: 0.3 },
    journal:    { health: 0.5, play: 0.5 },
    drawing:    { play: 1.0 },
    sleep:      { health: 1.0 },
    other:      { play: 0.5, work: 0.3, health: 0.2 },
  };
  return DEFAULTS[type?.toLowerCase()] || DEFAULTS.other;
}

export const activityApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    logActivity: build.mutation<{ status: string; activity: ActivityEntry }, Partial<ActivityEntry>>({
      queryFn: (body) => {
        try {
          const db = getDb();
          const now = body.loggedAt || new Date().toISOString();
          const result = db.runSync(
            `INSERT INTO activity_logs (logged_at, activity_type, log_name, duration_min, intensity, outdoors, location, engagement, energy, mets, is_nature, is_strength, source, aeiou, life_categories, meta, origin_session_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              now,
              body.activityType || 'other',
              body.logName || 'Activity',
              body.duration_min || 30,
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
              body.originSessionId ?? null,
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
            "SELECT * FROM activity_logs WHERE date(logged_at, 'localtime') = ? ORDER BY logged_at ASC",
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
          if (body.isStrength !== undefined) { sets.push('is_strength = ?'); vals.push(body.isStrength ? 1 : 0); }
          if (body.mets !== undefined) { sets.push('mets = ?'); vals.push(body.mets); }
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
      queryFn: async (days) => {
        try {
          const db = getDb();
          const numDays = days || 7;
          const rows = db.getAllSync(
            `SELECT * FROM activity_logs
             WHERE date(logged_at, 'localtime') >= date('now', 'localtime', '-' || ? || ' days')
             ORDER BY logged_at ASC`,
            [numDays]
          ) as any[];

          const DAILY_TARGET = 480; // minutes per day
          const totalTarget = DAILY_TARGET * numDays;
          const categoryMinutes: Record<string, number> = { work: 0, health: 0, play: 0, love: 0 };
          const breakdown: Record<string, BreakdownActivity[]> = { work: [], health: [], play: [], love: [] };

          for (const r of rows) {
            const dur = r.duration_min || 0;
            if (dur <= 0) continue;

            let weights: Record<string, number>;
            if (r.life_categories) {
              try {
                weights = JSON.parse(r.life_categories);
              } catch {
                weights = getDefaultWeights(r.activity_type);
              }
            } else {
              weights = getDefaultWeights(r.activity_type);
            }

            for (const [cat, w] of Object.entries(weights)) {
              if (!(cat in categoryMinutes)) continue;
              const weightedMin = dur * (w as number);
              categoryMinutes[cat] += weightedMin;

              breakdown[cat].push({
                ...rowToActivity(r),
                weight: w as number,
                weighted_min: weightedMin,
              });
            }
          }

          const todayStr = new Date().toLocaleDateString('en-CA');
          const healthPillars = await HealthPillarService.computeForDate(todayStr);

          const healthAvg = healthPillars.length > 0
            ? Math.round(healthPillars.reduce((sum, p) => sum + p.value, 0) / healthPillars.length)
            : 0;

          const gauges = {
            work: Math.min(100, Math.round((categoryMinutes.work / (120 * numDays)) * 100)),
            health: healthAvg,
            play: Math.min(100, Math.round((categoryMinutes.play / (60 * numDays)) * 100)),
            love: Math.min(100, Math.round((categoryMinutes.love / (60 * numDays)) * 100)),
          };

          return {
            data: {
              gauges,
              healthPillars,
              breakdown,
              period: `${numDays}d`,
            },
          };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['DailySummary'],
    }),

    getActivityPatterns: build.query<{ patterns: ActivityPattern[] }, number | void>({
      queryFn: (days) => {
        try {
          const db = getDb();
          const numDays = days || 30;
          const rows = db.getAllSync(
            `SELECT activity_type,
                    COUNT(*) as count,
                    AVG(engagement) as avg_engagement,
                    AVG(energy) as avg_energy
             FROM activity_logs
             WHERE logged_at >= date('now', '-' || ? || ' days')
             GROUP BY activity_type
             ORDER BY count DESC`,
            [numDays]
          ) as any[];

          const patterns: ActivityPattern[] = rows.map((r) => ({
            activityType: r.activity_type || 'other',
            count: r.count,
            avgEngagement: r.avg_engagement != null ? Math.round(r.avg_engagement * 10) / 10 : null,
            avgEnergy: r.avg_energy != null ? Math.round(r.avg_energy * 10) / 10 : null,
          }));

          return { data: { patterns } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['DailySummary'],
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
      queryFn: (startDate) => {
        try {
          const db = getDb();
          const start = startDate || (() => {
            const d = new Date();
            d.setDate(d.getDate() - 6);
            return d.toLocaleDateString('en-CA');
          })();
          const rows = db.getAllSync(
            `SELECT * FROM activity_logs
             WHERE date(logged_at, 'localtime') >= ?
             ORDER BY logged_at ASC`,
            [start]
          ) as any[];

          const days: Record<string, ActivityEntry[]> = {};
          for (const r of rows) {
            const day = r.logged_at ? r.logged_at.substring(0, 10) : start;
            if (!days[day]) days[day] = [];
            days[day].push(rowToActivity(r));
          }

          return { data: { startDate: start, days } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
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
