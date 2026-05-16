/**
 * nutritionApi.ts -- Local SQLite-backed nutrition API.
 * Handles meal logging, daily summaries, and meal plans.
 */

import { baseApi } from './baseApi';
import { getDb } from '../database';
import type { DailySummary, WeeklySummary, SnapResponse } from '../types';

export const nutritionApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getDailySummary: build.query<DailySummary, string | void>({
      queryFn: (date) => {
        try {
          const db = getDb();
          const localDate = date ? date.split('&')[0] : new Date().toLocaleDateString('en-CA');
          const rows = db.getAllSync(
            `SELECT * FROM nutrition_logs WHERE date(logged_at) = ? ORDER BY logged_at ASC`,
            [localDate]
          ) as any[];

          const entries = rows.map((r: any) => ({
            id: r.id,
            loggedAt: r.logged_at,
            mealType: r.meal_type,
            logName: r.log_name || r.food_name || 'Meal',
            items: r.items ? JSON.parse(r.items) : [],
            summaryNutrients: r.summary_nutrients ? JSON.parse(r.summary_nutrients) : {},
            source: r.source,
            entryType: r.entry_type,
            imageUris: r.image_uris ? JSON.parse(r.image_uris) : [],
          }));

          return { data: { date: localDate, entries, totals: {} } as any };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['DailySummary'],
    }),

    getWeeklySummary: build.query<WeeklySummary, void>({
      queryFn: () => ({ data: { days: [], averages: {} } as any }),
      providesTags: ['WeeklySummary'],
    }),

    getRecommendations: build.query<{ gaps: any[]; recommendations: any[] }, void>({
      queryFn: () => ({ data: { gaps: [], recommendations: [] } }),
    }),

    logConfirmed: build.mutation<any, { mealName: string; foods: any[]; mealType: string; imageId?: number; imageIds?: number[]; loggedAt?: string; activityConditions?: any }>({
      queryFn: ({ mealName, foods, mealType, loggedAt }) => {
        try {
          const db = getDb();
          const now = loggedAt || new Date().toISOString();
          db.runSync(
            `INSERT INTO nutrition_logs (logged_at, meal_type, log_name, items, source) VALUES (?, ?, ?, ?, 'vision')`,
            [now, mealType, mealName, JSON.stringify(foods)]
          );
          return { data: { status: 'ok' } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['DailySummary', 'WeeklySummary', 'MealPlan'],
    }),

    snapMeal: build.mutation<SnapResponse, { image: string; mealType?: string; imageId?: number | null }>({
      queryFn: () => ({ data: { foods: [] } as any }),
      invalidatesTags: ['DailySummary', 'MealPlan'],
    }),

    analyzePhoto: build.mutation<{ foods: any[] }, { image: string; mode?: 'meal' | 'fridge' }>({
      queryFn: () => ({ data: { foods: [] } }),
    }),

    analyzeText: build.mutation<any, { text: string; imageId?: number; mealType?: string }>({
      queryFn: async ({ text }) => {
        try {
          const { identifyFoods } = require('../pipelines/food/identify');
          const { estimateNutrientsBatch, flattenNutrients } = require('../pipelines/food/nutrients');
          const { analyzeBioavailability } = require('../pipelines/food/bioavailability');

          // Phase 1: Identify foods from text
          const idResult = await identifyFoods([], text);
          
          if (idResult.foods.length === 0) {
            return { data: { foods: [], items: [] } };
          }

          // Phase 2: Estimate nutrients using USDA matching
          const nutrientResults = await estimateNutrientsBatch(idResult.foods);

          // Phase 3: Bioavailability (requires base nutrients map)
          const baseNutrientsMap: Record<string, any> = {};
          nutrientResults.forEach((res: any, idx: number) => {
            baseNutrientsMap[idResult.foods[idx].name] = res.nutrients;
          });
          const bioResult = await analyzeBioavailability([], idResult.foods, baseNutrientsMap);

          // Merge results
          const items = idResult.foods.map((food: any, idx: number) => {
            const nResult = nutrientResults[idx];
            return {
              ...food,
              nutrients: nResult.nutrients, // already flattened by estimateNutrientsBatch locally if we use the right return type, wait, estimateNutrientsBatch returns NutrientResult which has `nutrients: NutrientValues`. No, `estimateNutrients` returns full objects. We should flatten them.
              _rawNutrients: nResult.nutrients,
              meta: nResult.meta,
              bioavailability: bioResult.adjustments.find((a: any) => a.food === food.name),
            };
          });

          // Flatten nutrients for the UI which expects a simple key-value map
          const { flattenNutrientsNullable } = require('./food/nutrientEstimator');
          items.forEach((item: any) => {
            item.nutrients = flattenNutrientsNullable(item._rawNutrients);
          });

          return { 
            data: { 
              foods: items, 
              items,
              mealName: idResult.mealName,
              mealType: idResult.mealType,
              mealNote: bioResult.mealNote
            } 
          };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
    }),

    smartSnap: build.mutation<any, { image: string; extraImages?: string[]; caption?: string; photoTimestamps?: string[] }>({
      queryFn: () => ({ data: { foods: [] } }),
    }),

    smartSnapAsync: build.mutation<{ jobId: string; status: string }, { image: string; extraImages?: string[]; caption?: string; photoTimestamps?: string[] }>({
      queryFn: () => ({ data: { jobId: 'local-noop', status: 'completed' } }),
    }),

    chatAsync: build.mutation<{ jobId: string; status: string }, string | { message: string; replyTo?: { id: string; text: string }; tz?: number }>({
      queryFn: () => ({ data: { jobId: 'local-noop', status: 'completed' } }),
    }),

    checkJobStatus: build.query<{ status: 'processing' | 'completed' | 'failed'; result?: any; error?: string; message?: string }, string>({
      queryFn: () => ({ data: { status: 'completed' as const, result: {} } }),
    }),

    updateEntry: build.mutation<any, { id: number; text: string }>({
      queryFn: ({ id, text }) => {
        try {
          const db = getDb();
          db.runSync(`UPDATE nutrition_logs SET food_name = ?, updated_at = datetime('now') WHERE id = ?`, [text, id]);
          return { data: { status: 'ok' } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['DailySummary', 'MealPlan'],
    }),

    updateEntryDirect: build.mutation<any, { id: number; items?: any[]; logName?: string; mealType?: string; loggedAt?: string }>({
      queryFn: ({ id, items, logName, mealType, loggedAt }) => {
        try {
          const db = getDb();
          const sets: string[] = ["updated_at = datetime('now')"];
          const vals: any[] = [];
          if (items !== undefined) { sets.push('items = ?'); vals.push(JSON.stringify(items)); }
          if (logName !== undefined) { sets.push('log_name = ?'); vals.push(logName); }
          if (mealType !== undefined) { sets.push('meal_type = ?'); vals.push(mealType); }
          if (loggedAt !== undefined) { sets.push('logged_at = ?'); vals.push(loggedAt); }
          vals.push(id);
          db.runSync(`UPDATE nutrition_logs SET ${sets.join(', ')} WHERE id = ?`, vals);
          return { data: { status: 'ok' } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['DailySummary', 'MealPlan'],
    }),

    deleteEntry: build.mutation<any, number>({
      queryFn: (id) => {
        try {
          const db = getDb();
          db.runSync('DELETE FROM nutrition_logs WHERE id = ?', [id]);
          return { data: { status: 'ok' } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['DailySummary', 'MealPlan'],
    }),

    chatWithMittens: build.mutation<any, string | { message: string; replyTo?: { id: string; text: string }; tz?: number }>({
      queryFn: () => ({
        data: {
          reply: 'Chat requires a backend connection. Use local AI models instead.',
          itemsLogged: 0,
          itemsToLog: [],
        },
      }),
      invalidatesTags: ['DailySummary', 'MealPlan'],
    }),

    getNutrientRecs: build.mutation<any, { nutrient: string }>({
      queryFn: ({ nutrient }) => ({
        data: { nutrient, name: nutrient, unit: '', actual: 0, rda: 0, deficit: 0, pct: 0, foods: [] },
      }),
    }),

    dislikeFood: build.mutation<any, { food: string; reason?: string }>({
      queryFn: () => ({ data: { dislikedFoods: [], action: 'added' } }),
    }),

    updateSunExposure: build.mutation<any, { id: number; duration_min?: number; coverage_pct?: number; sunscreen?: boolean }>({
      queryFn: () => ({ data: { status: 'ok', vitamin_d_mcg: 0, reasoning: '' } }),
      invalidatesTags: ['DailySummary'],
    }),

    reestimateItem: build.mutation<any, { itemName: string; nutrient: string }>({
      queryFn: ({ itemName, nutrient }) => ({
        data: {
          status: 'ok',
          itemName,
          nutrient,
          originalValue: 0,
          revisedValue: 0,
          confidence: 'low',
          reasoning: 'Local stub',
          updatedEntries: 0,
          hadImage: false,
        },
      }),
      invalidatesTags: ['DailySummary'],
    }),

    getTodayMealPlan: build.query<{ plan: any | null }, void>({
      queryFn: () => ({ data: { plan: null } }),
      providesTags: ['MealPlan'],
    }),

    generateMealPlan: build.mutation<{ plan: any }, void>({
      queryFn: () => ({ data: { plan: null } }),
      invalidatesTags: ['MealPlan'],
    }),

    generateMealPlanAsync: build.mutation<{ success: boolean; jobId: string; status: string; message: string }, { customConstraint?: string } | void>({
      queryFn: () => ({
        data: { success: false, jobId: 'local-noop', status: 'completed', message: 'Meal plan generation requires a backend.' },
      }),
    }),

    checkMealPlanJobStatus: build.query<{ status: 'processing' | 'completed' | 'failed'; result?: any; error?: string; message?: string }, string>({
      queryFn: () => ({ data: { status: 'completed' as const } }),
    }),
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
