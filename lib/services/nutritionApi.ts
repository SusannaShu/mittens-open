/**
 * Nutrition API -- meals, daily/weekly summaries, food analysis.
 * Handles all /nutrition-log/* endpoints.
 */

import { baseApi } from './baseApi';
import { DailySummary, WeeklySummary, SnapResponse, SupplementRec, BioavailabilityNote, SolverMetadata } from '../types';

export const nutritionApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** GET /nutrition-log/daily */
    getDailySummary: build.query<DailySummary, string | void>({
      query: (date) => {
        const localDate = date || new Date().toLocaleDateString('en-CA');
        const tz = new Date().getTimezoneOffset(); // minutes from UTC (e.g. 240 for EDT)
        return `/nutrition-log/daily?date=${localDate}&tz=${tz}`;
      },
      providesTags: ['DailySummary'],
    }),

    /** GET /nutrition-log/weekly */
    getWeeklySummary: build.query<WeeklySummary, void>({
      query: () => '/nutrition-log/weekly',
      providesTags: ['WeeklySummary'],
    }),

    /** GET /nutrition-log/recs */
    getRecommendations: build.query<{ gaps: any[]; recommendations: any[] }, void>({
      query: () => '/nutrition-log/recs',
    }),

    /** POST /nutrition-log/log -- confirm analyzed items */
    logConfirmed: build.mutation<any, { mealName: string; foods: any[]; mealType: string; imageId?: number; imageIds?: number[]; loggedAt?: string; activityConditions?: any }>({
      query: ({ mealName, foods, mealType, imageId, imageIds, loggedAt, activityConditions }) => ({
        url: '/nutrition-log/log',
        method: 'POST',
        body: { mealName, foods, mealType, source: 'vision', imageId, imageIds, loggedAt, activityConditions },
      }),
      invalidatesTags: ['DailySummary', 'WeeklySummary', 'MealPlan'],
    }),

    /** POST /nutrition-log/snap */
    snapMeal: build.mutation<SnapResponse, { image: string; mealType?: string; imageId?: number | null }>({
      query: (body) => ({
        url: '/nutrition-log/snap',
        method: 'POST',
        body: { image: body.image, mealType: body.mealType, imageId: body.imageId },
      }),
      invalidatesTags: ['DailySummary', 'MealPlan'],
    }),

    /** POST /nutrition-log/analyze (photo only, no logging) */
    analyzePhoto: build.mutation<{ foods: any[] }, { image: string; mode?: 'meal' | 'fridge' }>({
      query: ({ image, mode = 'meal' }) => ({
        url: '/nutrition-log/analyze',
        method: 'POST',
        body: { image, mode },
      }),
    }),

    /** POST /nutrition-log/analyze-text */
    analyzeText: build.mutation<any, { text: string; imageId?: number; mealType?: string }>({
      query: (body) => ({
        url: '/nutrition-log/analyze-text',
        method: 'POST',
        body,
      }),
    }),

    /** POST /nutrition-log/smart-snap */
    smartSnap: build.mutation<any, { image: string; extraImages?: string[]; caption?: string; photoTimestamps?: string[] }>({
      query: ({ image, extraImages, caption, photoTimestamps }) => ({
        url: '/nutrition-log/smart-snap',
        method: 'POST',
        body: { image, extraImages, caption, photoTimestamps },
      }),
    }),

    /** POST /nutrition-log/smart-snap-async -- returns jobId, processes in background */
    smartSnapAsync: build.mutation<{ jobId: string; status: string }, { image: string; extraImages?: string[]; caption?: string; photoTimestamps?: string[] }>({
      query: ({ image, extraImages, caption, photoTimestamps }) => ({
        url: '/nutrition-log/smart-snap-async',
        method: 'POST',
        body: { image, extraImages, caption, photoTimestamps },
      }),
    }),

    chatAsync: build.mutation<{ jobId: string; status: string }, string | { message: string; replyTo?: { id: string; text: string }; tz?: number }>({
      query: (arg) => ({
        url: '/nutrition-log/chat-async',
        method: 'POST',
        body: typeof arg === 'string'
          ? { message: arg, tz: new Date().getTimezoneOffset() }
          : { ...arg, tz: new Date().getTimezoneOffset() },
      }),
    }),

    /** GET /nutrition-log/job-status/:jobId -- poll for any async job result */
    checkJobStatus: build.query<{
      status: 'processing' | 'completed' | 'failed';
      result?: any;
      error?: string;
      message?: string;
    }, string>({
      query: (jobId) => `/nutrition-log/job-status/${jobId}`,
    }),

    /** PUT /nutrition-log/:id -- AI re-analyze from text */
    updateEntry: build.mutation<any, { id: number; text: string }>({
      query: ({ id, text }) => ({
        url: `/nutrition-log/${id}`,
        method: 'PUT',
        body: { text },
      }),
      invalidatesTags: ['DailySummary', 'MealPlan'],
    }),

    /** PUT /nutrition-log/:id -- direct inline item edits */
    updateEntryDirect: build.mutation<any, { id: number; items?: any[]; logName?: string; mealType?: string; loggedAt?: string }>({
      query: ({ id, items, logName, mealType, loggedAt }) => ({
        url: `/nutrition-log/${id}`,
        method: 'PUT',
        body: { items, logName, mealType, loggedAt },
      }),
      invalidatesTags: ['DailySummary', 'MealPlan'],
    }),

    /** DELETE /nutrition-log/:id */
    deleteEntry: build.mutation<any, number>({
      query: (id) => ({
        url: `/nutrition-log/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['DailySummary', 'MealPlan'],
    }),

    chatWithMittens: build.mutation<{
      reply: string;
      itemsLogged: number;
      itemsToLog: any[];
      sunExposure?: { detected: boolean; logId: number | null };
      sunExposureUpdate?: { duration_min?: number; coverage_pct?: number; sunscreen?: boolean } | null;
      activityDetection?: { detected: boolean; subtype: string; logId: number | null; summary: string | null } | null;
      failureLog?: any;
      dataFetched?: string[] | null;
    }, string | { message: string; replyTo?: { id: string; text: string }; tz?: number }>({
      query: (arg) => ({
        url: '/nutrition-log/chat',
        method: 'POST',
        body: typeof arg === 'string'
          ? { message: arg, tz: new Date().getTimezoneOffset() }
          : { ...arg, tz: new Date().getTimezoneOffset() },
      }),
      invalidatesTags: ['DailySummary', 'MealPlan'],
    }),

    /** POST /nutrition-log/nutrient-recs -- lazy-loaded per-nutrient AI recommendations */
    getNutrientRecs: build.mutation<{
      nutrient: string;
      name: string;
      unit: string;
      actual: number;
      rda: number;
      deficit: number;
      pct: number;
      foods: Array<{ food: string; portion: string; amount: number; note?: string; servingsNeeded?: number; source: string; type?: string }>;
      tip?: string;
      supplementNote?: string;
      source: string;
    }, { nutrient: string }>({
      query: ({ nutrient }) => ({
        url: '/nutrition-log/nutrient-recs',
        method: 'POST',
        body: { nutrient },
      }),
    }),

    /** POST /nutrition-log/dislike -- toggle food dislike with optional reason */
    dislikeFood: build.mutation<
      { dislikedFoods: Array<{ food: string; reason?: string | null }>; action: string },
      { food: string; reason?: string }
    >({
      query: ({ food, reason }) => ({
        url: '/nutrition-log/dislike',
        method: 'POST',
        body: { food, reason },
      }),
    }),

    /** PUT /nutrition-log/sun/:id -- update sun exposure with refined data */
    updateSunExposure: build.mutation<
      { status: string; vitamin_d_mcg: number; reasoning: string },
      { id: number; duration_min?: number; coverage_pct?: number; sunscreen?: boolean }
    >({
      query: ({ id, ...body }) => ({
        url: `/nutrition-log/sun/${id}`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['DailySummary'],
    }),

    /** POST /nutrition-log/reestimate-item -- flag + re-estimate a specific item's nutrient */
    reestimateItem: build.mutation<{
      status: string;
      itemName: string;
      nutrient: string;
      originalValue: number;
      revisedValue: number;
      confidence: string;
      reasoning: string;
      message?: string;
      updatedEntries: number;
      hadImage: boolean;
    }, { itemName: string; nutrient: string }>({
      query: (body) => ({
        url: '/nutrition-log/reestimate-item',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['DailySummary'],
    }),
    getTodayMealPlan: build.query<{
      plan: {
        id: number;
        date: string;
        breakfast: { items: string[]; nutrients?: Record<string, number>; prepTip?: string; fromPantry?: Array<{ food: string; pantryItem: string; usedPortion: string }>; fromStore?: Array<{ food: string; forNutrients: any[] }> } | null;
        lunch: { items: string[]; nutrients?: Record<string, number>; prepTip?: string; fromPantry?: Array<{ food: string; pantryItem: string; usedPortion: string }>; fromStore?: Array<{ food: string; forNutrients: any[] }> } | null;
        dinner: { items: string[]; nutrients?: Record<string, number>; prepTip?: string; fromPantry?: Array<{ food: string; pantryItem: string; usedPortion: string }>; fromStore?: Array<{ food: string; forNutrients: any[] }> } | null;
        groceryList: Array<{ food: string; portion: string; forMeals?: string[]; forNutrients: Array<{ nutrient: string; name: string; currentPct?: number }> }>;
        gapCoverage: Record<string, { name: string; currentPct: number; afterPlanPct: number; planAdds?: number; unit: string; rda?: number; status: string }> | null;
        uncoveredGaps?: Array<{ nutrient: string; name: string; afterPlanPct: number }>;
        supplements?: SupplementRec[];
        bioavailabilityNotes?: BioavailabilityNote[];
        solverMetadata?: SolverMetadata | null;
        generatedAt: string;
      } | null;
    }, void>({
      query: () => '/daily-meal-plan/today',
      providesTags: ['MealPlan'],
    }),

    /** POST /daily-meal-plan/generate (synchronous, kept for backward compat) */
    generateMealPlan: build.mutation<{
      plan: {
        id: number;
        date: string;
        breakfast: any;
        lunch: any;
        dinner: any;
        groceryList: any[];
        gapCoverage: Record<string, any> | null;
        uncoveredGaps?: any[];
        supplements?: SupplementRec[];
        bioavailabilityNotes?: BioavailabilityNote[];
        solverMetadata?: SolverMetadata | null;
        generatedAt: string;
      };
    }, void>({
      query: () => ({
        url: '/daily-meal-plan/generate',
        method: 'POST',
      }),
      invalidatesTags: ['MealPlan'],
    }),

    /** POST /daily-meal-plan/generate-async -- returns jobId immediately */
    generateMealPlanAsync: build.mutation<{
      success: boolean;
      jobId: string;
      status: string;
      message: string;
    }, { customConstraint?: string } | void>({
      query: (body) => ({
        url: '/daily-meal-plan/generate-async',
        method: 'POST',
        body: body || {},
      }),
    }),

    /** GET /daily-meal-plan/status/:jobId -- poll for async result */
    checkMealPlanJobStatus: build.query<{
      status: 'processing' | 'completed' | 'failed';
      result?: { plan: any };
      error?: string;
      message?: string;
    }, string>({
      query: (jobId) => `/daily-meal-plan/status/${jobId}`,
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

