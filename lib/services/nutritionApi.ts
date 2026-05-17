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
            `INSERT INTO nutrition_logs (logged_at, meal_type, log_name, items, summary_nutrients, source) VALUES (?, ?, ?, ?, ?, 'vision')`,
            [now, mealType, mealName, JSON.stringify(foods), JSON.stringify(summary)]
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
      queryFn: () => {
        try {
          const db = getDb();
          const today = new Date().toLocaleDateString('en-CA');
          const row = db.getFirstSync(
            `SELECT * FROM daily_meal_plans WHERE plan_date = ? ORDER BY created_at DESC LIMIT 1`,
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
          const { getBrain } = require('../brain/selector');
          const brain = await getBrain();
          const db = getDb();
          const today = new Date().toLocaleDateString('en-CA');

          // Gather context: today's logged meals
          const loggedRows = db.getAllSync(
            `SELECT log_name, items FROM nutrition_logs WHERE date(logged_at) = ? ORDER BY logged_at ASC`,
            [today]
          ) as any[];
          const loggedMeals = loggedRows.map((r: any) => r.log_name || 'unnamed meal').join(', ');

          // Gather pantry items
          const pantryRows = db.getAllSync(
            `SELECT item_name, quantity, unit FROM smart_pantry WHERE quantity > 0 ORDER BY item_name`
          ) as any[];
          const pantryList = pantryRows.map((r: any) => `${r.item_name} (${r.quantity} ${r.unit})`).join(', ');

          // Gather profile
          const profile = db.getFirstSync(`SELECT * FROM nutrition_profile WHERE id = 1`) as any;
          const dietInfo = profile?.dietary_preferences || 'none specified';
          const disliked = profile?.disliked_foods || 'none';

          const customConstraint = (args as any)?.customConstraint || '';

          const prompt = `Generate a daily meal plan for the remaining meals today.

Already eaten today: ${loggedMeals || 'nothing yet'}
Pantry available: ${pantryList || 'unknown'}
Dietary preferences: ${dietInfo}
Disliked foods: ${disliked}
${customConstraint ? `Special request: ${customConstraint}` : ''}

Create practical, nutrient-dense meals using pantry items when possible.
Focus on covering common micronutrient gaps (vitamin D, magnesium, potassium, omega-3, iron, zinc).

JSON: {
  "breakfast": {"items": ["food1", "food2"], "prepTip": "quick tip"},
  "lunch": {"items": ["food1", "food2"], "prepTip": "quick tip"},
  "dinner": {"items": ["food1", "food2"], "prepTip": "quick tip"},
  "groceryList": [{"food": "item name", "reason": "covers vitamin D gap"}]
}`;

          const raw = await brain.text(prompt, { temperature: 0.4 });

          // Parse response
          const match = raw.match(/\{[\s\S]*\}/);
          let plan: any = {};
          if (match) {
            plan = JSON.parse(match[0]);
          }

          // Persist to SQLite
          db.runSync(
            `INSERT OR REPLACE INTO daily_meal_plans (plan_date, breakfast, lunch, dinner, snacks, gap_coverage, grocery_list, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [
              today,
              plan.breakfast ? JSON.stringify(plan.breakfast) : null,
              plan.lunch ? JSON.stringify(plan.lunch) : null,
              plan.dinner ? JSON.stringify(plan.dinner) : null,
              plan.snacks ? JSON.stringify(plan.snacks) : null,
              plan.gapCoverage ? JSON.stringify(plan.gapCoverage) : null,
              plan.groceryList ? JSON.stringify(plan.groceryList) : null,
            ]
          );

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
