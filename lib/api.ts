/**
 * api.ts -- Local-only API helpers for mittens-open.
 *
 * In the open-source version there is no remote backend.
 * All data lives in the local SQLite database (lib/database.ts).
 * Functions here wrap SQLite queries so existing callers
 * (components, hooks) keep working without code changes.
 */

import { getDb } from './database';

// ---- Auth stubs (no remote auth in open version) ----

let authToken: string | null = 'local-token';

export function setAuthToken(token: string) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export function getApiBase(): string {
  return 'http://localhost:0'; // never hit -- all calls are local
}

export async function initApiBase(): Promise<void> {
  console.log('[mittens-open] Local-only mode -- no remote API');
}

export function getDevHubTunnelUrl(): string | null {
  return null;
}

// ---- Profile helpers (SQLite-backed) ----

function getProfileRow(): any {
  const db = getDb();
  let row = db.getFirstSync('SELECT * FROM nutrition_profile WHERE id = 1');
  if (!row) {
    db.runSync(
      `INSERT OR IGNORE INTO nutrition_profile (id, name, ai_model, home_latitude, home_longitude, schedule_enabled) VALUES (1, 'Local User', 'gemma-local', 37.7749, -122.4194, 1)`
    );
    row = db.getFirstSync('SELECT * FROM nutrition_profile WHERE id = 1');
  } else if (row.home_latitude == null || row.home_longitude == null) {
    db.runSync(`UPDATE nutrition_profile SET home_latitude = 37.7749, home_longitude = -122.4194, schedule_enabled = 1 WHERE id = 1`);
    row = db.getFirstSync('SELECT * FROM nutrition_profile WHERE id = 1');
  }
  return row;
}

export async function getProfile(): Promise<any> {
  const row = getProfileRow();
  if (!row) return {};
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

export async function updateProfile(data: any): Promise<any> {
  const db = getDb();
  // Ensure row exists
  getProfileRow();

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

  return getProfile();
}

// ---- Nutrition direct-call stubs ----

export async function getDailySummary(_date?: string): Promise<any> {
  return { date: _date || new Date().toLocaleDateString('en-CA'), entries: [], totals: {} };
}

export async function getWeeklySummary(): Promise<any> {
  return { days: [], averages: {} };
}

export async function dislikeFood(food: string, _reason?: string): Promise<any> {
  const profile = await getProfile();
  const list = profile.dislikedFoods || [];
  const exists = list.findIndex((d: any) => d.food === food);
  if (exists >= 0) {
    list.splice(exists, 1);
  } else {
    list.push({ food, reason: _reason || null });
  }
  await updateProfile({ dislikedFoods: list });
  return { dislikedFoods: list, action: exists >= 0 ? 'removed' : 'added' };
}

// ---- Chat stubs ----

export async function login(_id: string, _pw: string) {
  return { jwt: 'local-token', user: { id: 1, username: 'local_user' } };
}

export async function chatWithMittens(_message: string) {
  return { reply: 'Chat is not available in the open-source version.', itemsLogged: 0, itemsToLog: [] };
}

export async function loadMessages(_limit = 100, _start = 0) {
  return { messages: [], total: 0 };
}

export async function saveMessage(_msg: any) {
  return { id: 0 };
}

export async function saveMessageBatch(_msgs: any[]) {
  return { saved: 0 };
}

// ---- Upload / vision stubs ----

export async function uploadImage(_b64: string) { return null; }
export async function uploadLocalImage(_uri: string) { return null; }
export async function snapMeal(_b64: string, _type?: string) { return { foods: [] }; }
export async function analyzePhoto(_b64: string) { return { foods: [] }; }
export async function analyzeText(_text: string) { return { foods: [] }; }
export async function smartSnap(_b64: string) { return { foods: [] }; }
export async function logConfirmed(_name: string, _foods: any[], _type: string) { return {}; }
export async function getRecommendations() { return { gaps: [], recommendations: [] }; }
export async function deleteEntry(_id: number) { return {}; }
export async function updateEntry(_id: number, _text: string) { return {}; }
export async function updateEntryDirect(_id: number, _items: any[]) { return {}; }
export async function scanFridge(_b64: string) { return { pantry: [], nutrientGaps: [], grocerySuggestions: [] }; }
export async function getPantry() { return { pantry: [] }; }
export async function getGroceryList() { return { gaps: [], groceryList: [] }; }
export async function getNutrientRecs(_nutrient: string) { return { nutrient: _nutrient, name: '', unit: '', actual: 0, rda: 0, deficit: 0, pct: 0, foods: [] }; }

export interface BrainProxyResponse { text: string; provider: string; model: string; }
export async function brainText(_prompt: string, _model: string): Promise<BrainProxyResponse> {
  return { text: 'Local-only mode -- no remote AI.', provider: 'local', model: 'none' };
}
export async function brainVision(_prompt: string, _images: string[], _model: string): Promise<BrainProxyResponse> {
  return { text: 'Local-only mode -- no remote AI.', provider: 'local', model: 'none' };
}
