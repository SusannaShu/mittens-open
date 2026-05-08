/**
 * Activity API -- activity tracking, reflection, life design.
 * Handles all /activity-log/* endpoints.
 */

import { baseApi } from './baseApi';

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
  engagement?: number | null; // 1-10
  engagementReason?: string | null;
  energy?: number | null; // -5 to +5
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

export const activityApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** POST /activity-log -- log a new activity */
    logActivity: build.mutation<{ status: string; activity: ActivityEntry }, Partial<ActivityEntry>>({
      query: (body) => ({
        url: '/activity-log',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['DailySummary'],
    }),

    /** GET /activity-log/daily?date=YYYY-MM-DD */
    getDailyActivities: build.query<{ date: string; activities: ActivityEntry[]; count: number }, string | void>({
      query: (date) => {
        const localDate = date || new Date().toLocaleDateString('en-CA');
        const tz = new Date().getTimezoneOffset();
        return `/activity-log/daily?date=${localDate}&tz=${tz}`;
      },
      providesTags: ['DailySummary'],
    }),

    /** PUT /activity-log/:id/reflect -- update activity details + reflection */
    reflectActivity: build.mutation<{ status: string; activity: ActivityEntry }, {
      id: number;
      logName?: string;
      duration_min?: number;
      activityType?: string;
      location?: string;
      intensity?: string;
      engagement?: number;
      engagementReason?: string;
      energy?: number;
      energyReason?: string;
      aeiou?: Record<string, string>;
      lifeCategories?: Record<string, number>;
      loggedAt?: string;
      coverage_pct?: number;
      sunscreen?: boolean;
      outdoors?: boolean;
      isNature?: boolean;
    }>({
      query: ({ id, ...body }) => ({
        url: `/activity-log/${id}/reflect`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['DailySummary'],
    }),

    /** GET /activity-log/dashboard?days=7 */
    getDashboardGauges: build.query<DashboardGauges, number | void>({
      query: (days) => `/activity-log/dashboard?days=${days || 7}`,
      providesTags: ['DailySummary'],
    }),

    /** GET /activity-log/patterns?days=30 */
    getActivityPatterns: build.query<{ patterns: ActivityPattern[] }, number | void>({
      query: (days) => `/activity-log/patterns?days=${days || 30}`,
    }),

    /** DELETE /activity-log/:id */
    deleteActivity: build.mutation<{ status: string }, number>({
      query: (id) => ({
        url: `/activity-log/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['DailySummary'],
    }),

    /** GET /activity-log/weekly?startDate=YYYY-MM-DD */
    getWeeklyActivities: build.query<{ startDate: string; days: Record<string, ActivityEntry[]> }, string | void>({
      query: (startDate) => {
        const tz = new Date().getTimezoneOffset();
        const params = startDate ? `startDate=${startDate}&tz=${tz}` : `tz=${tz}`;
        return `/activity-log/weekly?${params}`;
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
