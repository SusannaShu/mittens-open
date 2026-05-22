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
    heightIn: row.height_in,
    heightCm: row.height_cm,
    weightLb: row.weight_lb,
    weightKg: row.weight_kg,
    age: row.age,
    sex: row.sex,
    skinType: row.skin_type,
    preferredUnit: row.preferred_unit,
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
            heightIn: 'height_in',
            heightCm: 'height_cm',
            weightLb: 'weight_lb',
            weightKg: 'weight_kg',
            age: 'age',
            sex: 'sex',
            skinType: 'skin_type',
            preferredUnit: 'preferred_unit',
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
      queryFn: () => {
        try {
          const db = getDb();
          const rows = db.getAllSync(
            'SELECT id, item_name, quantity, unit, freshness, last_seen_at, updated_at FROM smart_pantry WHERE quantity > 0 ORDER BY updated_at DESC'
          ) as any[];
          const pantry = rows.map(r => ({
            id: r.id,
            foodName: r.item_name,
            quantity: r.quantity != null ? (
              (!r.unit || r.unit === 'units' || r.unit === 'whole')
                ? `${r.quantity}`
                : `${r.quantity} ${r.unit}`
            ) : '',
            freshness: r.freshness || 'fresh',
            lastSeenAt: r.last_seen_at,
            updatedAt: r.updated_at,
          }));
          return { data: { pantry } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['Pantry'],
    }),

    getGroceryList: build.query<{ gaps: any[]; groceryList: any[] }, void>({
      queryFn: () => ({ data: { gaps: [], groceryList: [] } }),
    }),

    addPantryItem: build.mutation<any, { foodName: string; quantity?: string; freshness?: string }>({
      queryFn: ({ foodName, quantity, freshness }) => {
        try {
          const db = getDb();
          const now = new Date().toISOString();

          const singularize = (name: string): string => {
            const clean = name.trim().toLowerCase();
            const manualMap: Record<string, string> = {
              'strawberries': 'strawberry',
              'blueberries': 'blueberry',
              'raspberries': 'raspberry',
              'blackberries': 'blackberry',
              'potatoes': 'potato',
              'sweet potatoes': 'sweet potato',
              'tomatoes': 'tomato',
              'avocados': 'avocado',
              'oranges': 'orange',
              'apples': 'apple',
              'bananas': 'banana',
              'carrots': 'carrot',
              'onions': 'onion',
              'cucumbers': 'cucumber',
              'zucchinis': 'zucchini',
              'lemons': 'lemon',
              'limes': 'lime',
              'peaches': 'peach',
              'pears': 'pear',
              'plums': 'plum',
              'peppers': 'pepper',
              'bell peppers': 'bell pepper',
              'mushrooms': 'mushroom',
              'eggs': 'egg',
              'almonds': 'almond',
              'walnuts': 'walnut',
              'nuts': 'nut',
            };
            if (manualMap[clean]) return manualMap[clean];
            if (clean.endsWith('ies')) return clean.slice(0, -3) + 'y';
            if (clean.endsWith('oes')) return clean.slice(0, -2);
            if (clean.endsWith('s') && !clean.endsWith('ss') && !clean.endsWith('us') && !clean.endsWith('is') && !clean.endsWith('as')) {
              return clean.slice(0, -1);
            }
            return clean;
          };

          const sName = singularize(foodName);
          const displayName = sName.charAt(0).toUpperCase() + sName.slice(1);

          const existing = db.getFirstSync(
            'SELECT id, quantity, unit FROM smart_pantry WHERE LOWER(item_name) = ?',
            [sName]
          ) as any;
 
          const parseQuantityAndUnit = (rawQty: string | number | undefined | null): { qty: number; unit: string } => {
            if (rawQty == null) return { qty: 1, unit: 'whole' };
            if (typeof rawQty === 'number') return { qty: rawQty, unit: 'units' };
            const clean = String(rawQty).trim().toLowerCase();
            if (!clean || clean === 'whole') return { qty: 1, unit: 'whole' };
            const match = clean.match(/^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/);
            if (match) {
              const qty = parseFloat(match[1]) || 1;
              const unit = match[2].trim() || 'units';
              return { qty, unit };
            }
            return { qty: 1, unit: clean };
          };
 
          const { qty, unit } = parseQuantityAndUnit(quantity);
 
          if (existing) {
            const existingUnit = existing.unit;
            const finalUnit = (existingUnit && (unit === 'units' || unit === 'whole') && existingUnit !== 'units' && existingUnit !== 'whole')
              ? existingUnit
              : unit;
            db.runSync(
              `UPDATE smart_pantry SET quantity = quantity + ?, unit = ?, freshness = ?, updated_at = ?, last_seen_at = ?, last_added_qty = ? WHERE id = ?`,
              [qty, finalUnit, freshness || 'fresh', now, now, qty, existing.id]
            );
            return { data: { status: 'ok', id: existing.id } };
          }
 
          const result = db.runSync(
            `INSERT INTO smart_pantry (item_name, quantity, unit, freshness, confidence, last_seen_at, updated_at, last_added_qty) VALUES (?, ?, ?, ?, 'high', ?, ?, ?)`,
            [displayName, qty, unit, freshness || 'fresh', now, now, qty]
          );
          return { data: { status: 'ok', id: result.lastInsertRowId } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['Pantry', 'DailySummary'],
    }),

    deletePantryItem: build.mutation<any, number>({
      queryFn: (id) => {
        try {
          const db = getDb();
          db.runSync('DELETE FROM smart_pantry WHERE id = ?', [id]);
          return { data: { status: 'ok' } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['Pantry', 'DailySummary'],
    }),

    updatePantryItem: build.mutation<any, { id: number; foodName?: string; quantity?: string; freshness?: string }>({
      queryFn: ({ id, foodName, quantity, freshness }) => {
        try {
          const db = getDb();
          const sets: string[] = [];
          const vals: any[] = [];

          if (foodName !== undefined) { sets.push('item_name = ?'); vals.push(foodName); }
          if (quantity !== undefined) { sets.push('quantity = ?'); vals.push(parseFloat(quantity) || 0); }
          if (freshness !== undefined) { sets.push('freshness = ?'); vals.push(freshness); }
          sets.push("updated_at = datetime('now')");
          vals.push(id);

          if (sets.length > 1) {
            db.runSync(`UPDATE smart_pantry SET ${sets.join(', ')} WHERE id = ?`, vals);
          }
          return { data: { status: 'ok' } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['Pantry', 'DailySummary'],
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
