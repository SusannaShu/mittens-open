/**
 * Nutrition API -- Local SQLite implementation for Mittens Open.
 * Replaces Strapi cloud endpoints with direct database queries.
 */

import { localApi } from './localApi';
import { getDb } from '../database';
import { DailySummary, WeeklySummary, SnapResponse } from '../types';

export const nutritionApi = localApi.injectEndpoints({
  endpoints: (build) => ({
    getDailySummary: build.query<DailySummary, string | void>({
      queryFn: async (date) => {
        try {
          const db = getDb();
          const targetDate = date || new Date().toLocaleDateString('en-CA');
          const rows = db.getAllSync(`SELECT * FROM nutrition_logs WHERE logged_at LIKE ?`, [`${targetDate}%`]);
          
          const parsedMeals = rows.map((r: any) => ({
            id: r.id,
            loggedAt: r.logged_at,
            mealType: r.meal_type,
            logName: r.log_name,
            items: r.items ? JSON.parse(r.items) : [],
            summaryNutrients: r.summary_nutrients ? JSON.parse(r.summary_nutrients) : {},
            source: r.source,
            entryType: r.entry_type
          }));

          return { 
            data: { 
              date: targetDate, 
              meals: parsedMeals, 
              summary: {}, 
              sunExposure: { totalMinutes: 0 } 
            } 
          };
        } catch (e) {
          return { error: { status: 500, data: String(e) } };
        }
      },
      providesTags: ['DailySummary'],
    }),

    getWeeklySummary: build.query<WeeklySummary, void>({
      queryFn: async () => {
        return { data: { weeklyAverage: {}, days: [] } };
      },
      providesTags: ['WeeklySummary'],
    }),

    getRecommendations: build.query<{ gaps: any[]; recommendations: any[] }, void>({
      queryFn: async () => ({ data: { gaps: [], recommendations: [] } }),
    }),

    logConfirmed: build.mutation<any, any>({
      queryFn: async (args) => {
        const db = getDb();
        db.runSync(
          `INSERT INTO nutrition_logs (logged_at, meal_type, log_name, items, summary_nutrients, source) VALUES (?, ?, ?, ?, ?, ?)`,
          [args.loggedAt || new Date().toISOString(), args.mealType, args.mealName, JSON.stringify(args.foods), '{}', 'manual']
        );
        return { data: { success: true } };
      },
      invalidatesTags: ['DailySummary', 'WeeklySummary'],
    }),

    deleteEntry: build.mutation<any, number>({
      queryFn: async (id) => {
        getDb().runSync(`DELETE FROM nutrition_logs WHERE id = ?`, [id]);
        return { data: { success: true } };
      },
      invalidatesTags: ['DailySummary'],
    }),

    updateEntryDirect: build.mutation<any, any>({
      queryFn: async (args) => {
        getDb().runSync(
          `UPDATE nutrition_logs SET log_name = ?, meal_type = ?, logged_at = ?, items = ? WHERE id = ?`,
          [args.logName, args.mealType, args.loggedAt, JSON.stringify(args.items), args.id]
        );
        return { data: { success: true } };
      },
      invalidatesTags: ['DailySummary'],
    }),

    // Dummy stubs for AI features that require complex local-inference pipelines
    snapMeal: build.mutation<SnapResponse, any>({ queryFn: async () => ({ data: { status: 'failed', items: [] } }) }),
    analyzePhoto: build.mutation<any, any>({ queryFn: async () => ({ data: { foods: [] } }) }),
    analyzeText: build.mutation<any, any>({ queryFn: async () => ({ data: { foods: [] } }) }),
    smartSnap: build.mutation<any, any>({ queryFn: async () => ({ data: { success: false } }) }),
    smartSnapAsync: build.mutation<any, any>({ queryFn: async () => ({ data: { jobId: 'mock', status: 'completed' } }) }),
    chatAsync: build.mutation<any, any>({ queryFn: async () => ({ data: { jobId: 'mock', status: 'completed' } }) }),
    checkJobStatus: build.query<any, string>({ queryFn: async () => ({ data: { status: 'completed' } }) }),
    updateEntry: build.mutation<any, any>({ queryFn: async () => ({ data: { success: false } }) }),
    chatWithMittens: build.mutation<any, any>({ queryFn: async () => ({ data: { reply: "I'm offline in this display version.", itemsLogged: 0, itemsToLog: [] } }) }),
    getNutrientRecs: build.mutation<any, any>({ queryFn: async () => ({ data: { actual: 0, rda: 100, foods: [] } }) }),
    dislikeFood: build.mutation<any, any>({ queryFn: async () => ({ data: { dislikedFoods: [], action: 'noop' } }) }),
    updateSunExposure: build.mutation<any, any>({ queryFn: async () => ({ data: { status: 'ok' } }) }),
    reestimateItem: build.mutation<any, any>({ queryFn: async () => ({ data: { status: 'failed' } }) }),
    getTodayMealPlan: build.query<any, void>({ queryFn: async () => ({ data: { plan: null } }), providesTags: ['MealPlan'] }),
    generateMealPlan: build.mutation<any, void>({ queryFn: async () => ({ data: { plan: null } }) }),
    generateMealPlanAsync: build.mutation<any, any>({ queryFn: async () => ({ data: { success: true, jobId: 'mock', status: 'completed' } }) }),
    checkMealPlanJobStatus: build.query<any, string>({ queryFn: async () => ({ data: { status: 'completed' } }) }),
  }),
});

export const {
  useGetDailySummaryQuery,
  useGetWeeklySummaryQuery,
  useGetRecommendationsQuery,
  useLogConfirmedMutation,
  useSnapMealMutation,
  useAnalyzePhotoMutation,
  useAnalyzeTextMutation,
  useSmartSnapMutation,
  useSmartSnapAsyncMutation,
  useChatAsyncMutation,
  useLazyCheckJobStatusQuery,
  useUpdateEntryMutation,
  useUpdateEntryDirectMutation,
  useDeleteEntryMutation,
  useChatWithMittensMutation,
  useGetNutrientRecsMutation,
  useDislikeFoodMutation,
  useUpdateSunExposureMutation,
  useReestimateItemMutation,
  useGetTodayMealPlanQuery,
  useGenerateMealPlanMutation,
  useGenerateMealPlanAsyncMutation,
  useLazyCheckMealPlanJobStatusQuery,
} = nutritionApi;
