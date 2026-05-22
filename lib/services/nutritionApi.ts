/**
 * nutritionApi.ts -- Local SQLite-backed nutrition API.
 * Handles meal logging, daily summaries, and meal plans.
 */

import { baseApi } from './baseApi';
import { getDb } from '../database';
import type { DailySummary, WeeklySummary, SnapResponse } from '../types';

const VALID_MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'activity']);
function sanitizeMealType(raw: string | null | undefined): string {
  if (raw && VALID_MEAL_TYPES.has(raw.toLowerCase())) return raw.toLowerCase();
  const hour = new Date().getHours();
  if (hour < 10) return 'breakfast';
  if (hour < 14) return 'lunch';
  if (hour < 20) return 'dinner';
  return 'snack';
}

export const nutritionApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getDailySummary: build.query<DailySummary, string | void>({
      queryFn: async (date) => {
        try {
          const localDate = date ? date.split('&')[0] : new Date().toLocaleDateString('en-CA');
          const { LocalDataProvider } = require('../providers/localDataProvider');
          const provider = new LocalDataProvider();
          const summary = await provider.getDailySummary(localDate);
          return { data: summary as any };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['DailySummary', 'Pantry'],
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
          let summary = {};
          if (foods && Array.isArray(foods)) {
            const acc: Record<string, number> = {};
            foods.forEach(food => {
               if (food.nutrients) {
                  Object.keys(food.nutrients).forEach(key => {
                    acc[key] = (acc[key] || 0) + (food.nutrients[key] || 0);
                  });
               }
            });
            summary = acc;
          }

          const result = db.runSync(
            `INSERT INTO nutrition_logs (logged_at, meal_type, log_name, items, summary_nutrients, source, entry_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'vision', 'food', ?, ?)`,
            [now, sanitizeMealType(mealType), mealName, JSON.stringify(foods), JSON.stringify(summary), now, now]
          );
          return { data: { status: 'ok', ids: [result.lastInsertRowId] } };
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

    analyzeText: build.mutation<any, { text?: string; mealType?: string; manualUsdaFoods?: any[] }>({
      queryFn: async ({ text, mealType, manualUsdaFoods }) => {
        try {
          const { identifyFoods } = require('../pipelines/food/identify');
          const { estimateNutrientsBatch, flattenNutrients } = require('../pipelines/food/nutrients');
          const { analyzeBioavailability } = require('../pipelines/food/bioavailability');

          let foodsToProcess: any[] = [];
          let mealName = 'Meal';
          let mealTypeStr = mealType || 'snack';

          // Phase 1: Identify foods from text
          if (text) {
            const idResult = await identifyFoods([], text);
            foodsToProcess = idResult.foods;
            mealName = idResult.mealName;
            mealTypeStr = idResult.mealType || mealTypeStr;
          }

          // Inject manual USDA foods directly into the pipeline
          if (manualUsdaFoods && manualUsdaFoods.length > 0) {
            const manualMapped = manualUsdaFoods.map((f: any) => ({
              name: f.customName || f.name,
              portion_g: f.amountGram || 100,
              household_portion: f.amountGram ? `${f.amountGram}g` : '100g',
              cooking: '',
            }));
            foodsToProcess = [...foodsToProcess, ...manualMapped];
            if (!text) {
              mealName = manualMapped.map((f: any) => f.name).slice(0, 3).join(', ');
            }
          }
          
          if (foodsToProcess.length === 0) {
            return { data: { foods: [], items: [] } };
          }

          // Phase 2: Estimate nutrients using USDA matching
          const nutrientResults = await estimateNutrientsBatch(foodsToProcess);

          // Phase 3: Bioavailability (requires base nutrients map)
          const baseNutrientsMap: Record<string, any> = {};
          nutrientResults.forEach((res: any, idx: number) => {
            baseNutrientsMap[foodsToProcess[idx].name] = res.nutrients;
          });
          const bioResult = await analyzeBioavailability([], foodsToProcess, baseNutrientsMap);

          // Merge results
          const items = foodsToProcess.map((food: any, idx: number) => {
            const nResult = nutrientResults[idx];
            return {
              ...food,
              nutrients: nResult.nutrients,
              meta: nResult.meta,
              bioavailability: bioResult.adjustments.find((a: any) => a.food === food.name),
            };
          });

          return { 
            data: { 
              foods: items, 
              items,
              mealName,
              mealType: mealTypeStr,
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
      queryFn: async ({ image, extraImages, caption }) => {
        try {
          const { identifyFoods } = require('../pipelines/food/identify');
          const { estimateNutrientsBatch, flattenNutrients } = require('../pipelines/food/nutrients');
          const { analyzeBioavailability } = require('../pipelines/food/bioavailability');

          // Collect all image URIs
          const images = [image, ...(extraImages || [])];

          // Phase 1: Identify foods from photo(s)
          const idResult = await identifyFoods(images, caption || '');
          if (idResult.foods.length === 0) {
            return { data: { jobId: 'local-photo', status: 'completed', result: { foods: [], items: [] } } };
          }

          // Phase 2: Estimate nutrients
          const nutrientResults = await estimateNutrientsBatch(idResult.foods);

          // Phase 3: Bioavailability
          const baseNutrientsMap: Record<string, any> = {};
          nutrientResults.forEach((res: any, idx: number) => {
            baseNutrientsMap[idResult.foods[idx].name] = res.nutrients;
          });
          const bioResult = await analyzeBioavailability(images, idResult.foods, baseNutrientsMap);

          // Merge results
          const items = idResult.foods.map((food: any, idx: number) => {
            const nResult = nutrientResults[idx];
            return {
              ...food,
              nutrients: nResult.nutrients,
              meta: nResult.meta,
              bioavailability: bioResult.adjustments.find((a: any) => a.food === food.name),
            };
          });

          const result = {
            foods: items,
            items,
            mealName: idResult.mealName,
            mealType: idResult.mealType,
            mealNote: bioResult.mealNote,
            imageUrl: image,
          };

          return { data: { jobId: 'local-photo', status: 'completed', result } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
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
          if (items !== undefined) { 
            sets.push('items = ?'); 
            vals.push(JSON.stringify(items)); 
            const acc: Record<string, number> = {};
            items.forEach(food => {
               if (food.nutrients) {
                  Object.keys(food.nutrients).forEach(key => {
                    acc[key] = (acc[key] || 0) + (food.nutrients[key] || 0);
                  });
               }
            });
            sets.push('summary_nutrients = ?');
            vals.push(JSON.stringify(acc));
          }
          if (logName !== undefined) { sets.push('log_name = ?'); vals.push(logName); }
          if (mealType !== undefined) { sets.push('meal_type = ?'); vals.push(sanitizeMealType(mealType)); }
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
      queryFn: ({ nutrient }) => {
        try {
          const { COMMON_FOODS } = require('../../data/commonFoods');
          const RDA_MAP: Record<string, { name: string; unit: string; rda: number }> = {
            vitamin_d: { name: 'Vitamin D', unit: 'mcg', rda: 15 },
            iron: { name: 'Iron', unit: 'mg', rda: 18 },
            calcium: { name: 'Calcium', unit: 'mg', rda: 1000 },
            magnesium: { name: 'Magnesium', unit: 'mg', rda: 310 },
            vitamin_c: { name: 'Vitamin C', unit: 'mg', rda: 75 },
            potassium: { name: 'Potassium', unit: 'mg', rda: 2600 },
            vitamin_a: { name: 'Vitamin A', unit: 'mcg', rda: 700 },
            zinc: { name: 'Zinc', unit: 'mg', rda: 8 },
            omega3: { name: 'Omega-3', unit: 'g', rda: 1.1 },
            folate: { name: 'Folate', unit: 'mcg', rda: 400 },
            vitamin_b12: { name: 'Vitamin B12', unit: 'mcg', rda: 2.4 },
            vitamin_b6: { name: 'Vitamin B6', unit: 'mg', rda: 1.3 },
            vitamin_e: { name: 'Vitamin E', unit: 'mg', rda: 15 },
            vitamin_k: { name: 'Vitamin K', unit: 'mcg', rda: 90 },
            protein: { name: 'Protein', unit: 'g', rda: 95 },
            fiber: { name: 'Fiber', unit: 'g', rda: 25 },
          };
          const rdaInfo = RDA_MAP[nutrient] || { name: nutrient, unit: '', rda: 0 };

          const scored = COMMON_FOODS
            .filter((f: any) => f.per100g && (f.per100g[nutrient] || 0) > 0)
            .map((f: any) => ({
              name: f.name,
              group: f.group,
              amount: f.per100g[nutrient],
              per100g: f.per100g,
            }))
            .sort((a: any, b: any) => b.amount - a.amount)
            .slice(0, 6);

          return {
            data: {
              nutrient,
              name: rdaInfo.name,
              unit: rdaInfo.unit,
              rda: rdaInfo.rda,
              foods: scored,
              source: 'usda',
            },
          };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
    }),

    dislikeFood: build.mutation<any, { food: string; reason?: string }>({
      queryFn: ({ food, reason }) => {
        try {
          const db = getDb();
          const row = db.getFirstSync('SELECT disliked_foods FROM nutrition_profile WHERE id = 1') as any;
          let list: Array<{ food: string; reason?: string }> = [];
          try { list = JSON.parse(row?.disliked_foods || '[]'); } catch {}
          if (!Array.isArray(list)) list = [];
          const idx = list.findIndex(d => d.food?.toLowerCase() === food.toLowerCase());
          let action: string;
          if (idx >= 0) {
            list.splice(idx, 1);
            action = 'removed';
          } else {
            list.push({ food, reason });
            action = 'added';
          }
          db.runSync('UPDATE nutrition_profile SET disliked_foods = ? WHERE id = 1', [JSON.stringify(list)]);
          return { data: { dislikedFoods: list, action } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['MealPlan'],
    }),

    updateSunExposure: build.mutation<any, { id: number; duration_min?: number; coverage_pct?: number; sunscreen?: boolean }>({
      queryFn: ({ id, duration_min, coverage_pct, sunscreen }) => {
        try {
          const db = getDb();
          const { estimateVitaminDSynthesis } = require('../../services/vitaminDSynthesis');

          // Get profile for skin type
          const profile = db.getFirstSync('SELECT skin_type FROM nutrition_profile WHERE id = 1') as any;
          const skinType = profile?.skin_type || 'fitzpatrick-4';

          // Get UV from the activity itself or current weather
          const activity = db.getFirstSync('SELECT * FROM activity_logs WHERE id = ?', [id]) as any;
          let uvIndex = 0;
          if (activity?.meta) {
            try { uvIndex = JSON.parse(activity.meta)?.uv || 0; } catch {}
          }
          if (!uvIndex) {
            // Fallback: latest weather data
            const weather = db.getFirstSync(
              `SELECT meta FROM weather_cache ORDER BY fetched_at DESC LIMIT 1`
            ) as any;
            if (weather?.meta) {
              try { uvIndex = JSON.parse(weather.meta)?.uv || 0; } catch {}
            }
          }

          const dur = duration_min || activity?.duration_min || 15;
          const synthesis = estimateVitaminDSynthesis({
            durationMin: dur,
            uvIndex,
            skinType,
            bodyCoverage: (coverage_pct || 25) / 100,
            sunscreen: sunscreen ?? false,
          });

          // Update the activity's nutrient_impact
          const nutrientImpact = { vitamin_d: synthesis.mcg };
          db.runSync(
            `UPDATE activity_logs SET nutrient_impact = ?, duration_min = ? WHERE id = ?`,
            [JSON.stringify(nutrientImpact), dur, id]
          );

          return {
            data: {
              status: 'ok',
              vitamin_d_mcg: synthesis.mcg,
              vitamin_d_iu: synthesis.iu,
              reasoning: synthesis.explanation,
            },
          };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
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
      queryFn: () => {
        try {
          const db = getDb();
          const today = new Date().toLocaleDateString('en-CA');
          const row = db.getFirstSync(
            `SELECT * FROM daily_meal_plans WHERE plan_date = ? ORDER BY id DESC LIMIT 1`,
            [today]
          ) as any;
          if (!row) return { data: { plan: null } };
          const plan: any = {};
          if (row.breakfast) plan.breakfast = JSON.parse(row.breakfast);
          if (row.lunch) plan.lunch = JSON.parse(row.lunch);
          if (row.dinner) plan.dinner = JSON.parse(row.dinner);
          if (row.snacks) plan.snacks = JSON.parse(row.snacks);
          if (row.gap_coverage) plan.gapCoverage = JSON.parse(row.gap_coverage);
          if (row.grocery_list) plan.groceryList = JSON.parse(row.grocery_list);
          if (row.bioavailability_notes) plan.bioavailabilityNotes = JSON.parse(row.bioavailability_notes);
          if (row.solver_metadata) plan.solverMetadata = JSON.parse(row.solver_metadata);
          if (row.supplements) plan.supplements = JSON.parse(row.supplements);
          if (row.vitamin_d_rec) plan.vitaminDRec = JSON.parse(row.vitamin_d_rec);
          return { data: { plan } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['MealPlan'],
    }),

    generateMealPlan: build.mutation<{ plan: any }, void>({
      queryFn: () => ({ data: { plan: null } }),
      invalidatesTags: ['MealPlan'],
    }),

    generateMealPlanAsync: build.mutation<{ success: boolean; jobId: string; status: string; message: string }, { customConstraint?: string } | void>({
      queryFn: async (args) => {
        try {
          const { LocalDataProvider } = require('../providers/localDataProvider');
          const provider = new LocalDataProvider();
          const today = new Date().toLocaleDateString('en-CA');
          const summary = await provider.getDailySummary(today);

          const { generateMealPlanPipeline } = require('../pipelines/food/mealPlanPipeline');
          const customConstraint = (args as any)?.customConstraint || '';
          
          await generateMealPlanPipeline('local-user', summary.gaps, customConstraint);

          return {
            data: { success: true, jobId: 'local-meal-plan', status: 'completed', message: 'Meal plan generated' },
          };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['MealPlan'],
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
