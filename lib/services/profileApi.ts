/**
 * profileApi.ts -- Local SQLite-backed profile and pantry API.
 */

import { baseApi } from './baseApi';
import { getDb } from '../database';

function getProfileRow(): any {
  const db = getDb();
  let row = db.getFirstSync('SELECT * FROM nutrition_profile WHERE id = 1');
  if (!row) {
    db.runSync(
      `INSERT OR IGNORE INTO nutrition_profile (id, name, ai_model) VALUES (1, 'Local User', 'gemma-local')`
    );
    row = db.getFirstSync('SELECT * FROM nutrition_profile WHERE id = 1');
  }
  return row || {};
}

function rowToProfile(row: any): any {
  return {
    name: row.name,
    dietaryPreferences: row.dietary_preferences ? JSON.parse(row.dietary_preferences) : [],
    dislikedFoods: row.disliked_foods ? JSON.parse(row.disliked_foods) : [],
    memory: row.memory ? JSON.parse(row.memory) : [],
    aiModel: row.ai_model,
    homeLatitude: row.home_latitude,
    homeLongitude: row.home_longitude,
    homeLabel: row.home_label,
    wakeTimeLmstMinutes: row.wake_time_lmst_minutes,
    sleepHours: row.sleep_hours,
    chronotype: row.chronotype,
    breakfastOffsetMinutes: row.breakfast_offset_minutes,
    dinnerBeforeBedMinutes: row.dinner_before_bed_minutes,
    scheduleMode: row.schedule_mode,
    scheduleTravelMode: row.schedule_travel_mode,
    scheduleEnabled: !!row.schedule_enabled,
    workIntervalMins: row.work_interval_mins,
    travelMode: row.travel_mode,
    bedtimeEnabled: !!row.bedtime_enabled,
    departureAlarmsEnabled: !!row.departure_alarms_enabled,
    proactiveCheckins: !!row.proactive_checkins,
    onboarded: !!row.onboarded,
  };
}

export const profileApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getProfile: build.query<any, void>({
      queryFn: () => {
        try {
          const row = getProfileRow();
          return { data: rowToProfile(row) };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['Profile'],
    }),

    updateProfile: build.mutation<any, any>({
      queryFn: (data) => {
        try {
          const db = getDb();
          getProfileRow(); // ensure row exists

          const fieldMap: Record<string, string> = {
            name: 'name',
            dietaryPreferences: 'dietary_preferences',
            dislikedFoods: 'disliked_foods',
            memory: 'memory',
            aiModel: 'ai_model',
            homeLatitude: 'home_latitude',
            homeLongitude: 'home_longitude',
            homeLabel: 'home_label',
            wakeTimeLmstMinutes: 'wake_time_lmst_minutes',
            sleepHours: 'sleep_hours',
            chronotype: 'chronotype',
            breakfastOffsetMinutes: 'breakfast_offset_minutes',
            dinnerBeforeBedMinutes: 'dinner_before_bed_minutes',
            scheduleMode: 'schedule_mode',
            scheduleTravelMode: 'schedule_travel_mode',
            scheduleEnabled: 'schedule_enabled',
            workIntervalMins: 'work_interval_mins',
            travelMode: 'travel_mode',
            bedtimeEnabled: 'bedtime_enabled',
            departureAlarmsEnabled: 'departure_alarms_enabled',
            proactiveCheckins: 'proactive_checkins',
            onboarded: 'onboarded',
          };

          const sets: string[] = [];
          const vals: any[] = [];

          for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
            if (data[jsKey] !== undefined) {
              sets.push(`${dbCol} = ?`);
              const v = data[jsKey];
              vals.push(
                typeof v === 'object' && v !== null ? JSON.stringify(v) :
                typeof v === 'boolean' ? (v ? 1 : 0) : v
              );
            }
          }

          if (sets.length > 0) {
            sets.push("updated_at = datetime('now')");
            db.runSync(`UPDATE nutrition_profile SET ${sets.join(', ')} WHERE id = 1`, vals);
          }

          const updated = getProfileRow();
          return { data: rowToProfile(updated) };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['Profile'],
    }),

    scanFridge: build.mutation<{ pantry: any[]; nutrientGaps: any[]; grocerySuggestions: any[] }, string>({
      queryFn: () => ({ data: { pantry: [], nutrientGaps: [], grocerySuggestions: [] } }),
      invalidatesTags: ['Pantry'],
    }),

    getPantry: build.query<{ pantry: any[] }, void>({
      queryFn: () => ({ data: { pantry: [] } }),
      providesTags: ['Pantry'],
    }),

    getGroceryList: build.query<{ gaps: any[]; groceryList: any[] }, void>({
      queryFn: () => ({ data: { gaps: [], groceryList: [] } }),
    }),

    addPantryItem: build.mutation<any, { foodName: string; quantity?: string; freshness?: string }>({
      queryFn: () => ({ data: { status: 'ok' } }),
      invalidatesTags: ['Pantry'],
    }),

    deletePantryItem: build.mutation<any, number>({
      queryFn: () => ({ data: { status: 'ok' } }),
      invalidatesTags: ['Pantry'],
    }),

    updatePantryItem: build.mutation<any, { id: number; foodName?: string; quantity?: string; freshness?: string }>({
      queryFn: () => ({ data: { status: 'ok' } }),
      invalidatesTags: ['Pantry'],
    }),
  }),
});

export const {
  useGetProfileQuery,
  useUpdateProfileMutation,
  useScanFridgeMutation,
  useGetPantryQuery,
  useGetGroceryListQuery,
  useAddPantryItemMutation,
  useDeletePantryItemMutation,
  useUpdatePantryItemMutation,
} = profileApi;
