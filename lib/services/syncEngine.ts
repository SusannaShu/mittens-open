/**
 * syncEngine.ts -- Pushes local SQLite data to Strapi when switching local -> cloud.
 *
 * Processes each table sequentially: messages -> nutrition -> activities -> sleep -> places -> profile.
 * Data only, no images (photos stay as local file URIs).
 * Reports progress via callbacks for the full-screen overlay.
 */

import { getDb, getUnsyncedCounts, markRecordSynced } from '../database';
import { getApiBase, getAuthToken } from '../api';

export interface SyncProgress {
  currentTable: string;
  currentIndex: number;
  totalForTable: number;
  tablesCompleted: number;
  totalTables: number;
  overallPct: number;
}

const TABLE_DISPLAY_NAMES: Record<string, string> = {
  mittens_messages: 'Messages',
  nutrition_logs: 'Meals',
  activity_logs: 'Activities',
  sleep_logs: 'Sleep',
  known_places: 'Places',
  nutrition_profile: 'Profile',
};

const SYNC_TABLES = [
  'mittens_messages',
  'nutrition_logs',
  'activity_logs',
  'sleep_logs',
  'known_places',
  'nutrition_profile',
];

const STRAPI_ENDPOINTS: Record<string, string> = {
  mittens_messages: '/mittens-messages',
  nutrition_logs: '/nutrition-logs',
  activity_logs: '/activity-logs',
  sleep_logs: '/sleep-logs',
  known_places: '/known-places',
  nutrition_profile: '/nutrition-profile',
};

/** Map SQLite row to Strapi-compatible payload. */
function rowToStrapiPayload(tableName: string, row: any): any {
  const parseJson = (val: string | null) => {
    if (!val) return null;
    try { return JSON.parse(val); } catch { return null; }
  };

  switch (tableName) {
    case 'mittens_messages':
      return {
        role: row.role,
        text: row.text,
        photos: parseJson(row.photos),
        activityType: row.activity_type,
        metadata: parseJson(row.metadata),
      };

    case 'nutrition_logs':
      return {
        loggedAt: row.logged_at,
        mealType: row.meal_type,
        logName: row.log_name,
        items: parseJson(row.items) || [],
        summaryNutrients: parseJson(row.summary_nutrients) || {},
        source: row.source,
        entryType: row.entry_type,
        activityMeta: parseJson(row.activity_meta),
        estimationStatus: row.estimation_status,
        // Skip image fields -- data only sync
      };

    case 'activity_logs':
      return {
        logName: row.log_name,
        activityType: row.activity_type,
        duration_min: row.duration_min,
        intensity: row.intensity,
        loggedAt: row.logged_at,
        outdoors: row.outdoors === 1,
        nature: row.nature === 1,
        location: row.location,
        nutrientImpact: parseJson(row.nutrient_impact),
        absorptionMultiplier: row.absorption_multiplier,
        summary: row.summary,
        source: row.source,
        meta: parseJson(row.meta),
      };

    case 'sleep_logs':
      return {
        wentToBed: row.went_to_bed,
        wokeUp: row.woke_up,
        totalMinutes: row.total_minutes,
        quality: row.quality,
        notes: row.notes,
        loggedAt: row.logged_at,
      };

    case 'known_places':
      return {
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        radius_m: row.radius_m,
        placeType: row.place_type,
        icon: row.icon,
        autoDetected: row.auto_detected === 1,
      };

    case 'nutrition_profile':
      return {
        name: row.name,
        dietaryPreferences: row.dietary_preferences,
        dislikedFoods: parseJson(row.disliked_foods),
        memory: parseJson(row.memory),
        aiModel: row.ai_model,
        homeLatitude: row.home_latitude,
        homeLongitude: row.home_longitude,
        homeLabel: row.home_label,
        travelMode: row.travel_mode,
        bedtimeEnabled: row.bedtime_enabled === 1,
        departureAlarmsEnabled: row.departure_alarms_enabled === 1,
        proactiveCheckins: row.proactive_checkins === 1,
        workIntervalMins: row.work_interval_mins,
      };

    default:
      return row;
  }
}

/**
 * Sync all unsynced local data to Strapi.
 * Called when user switches from local -> cloud mode.
 */
export async function syncLocalToCloud(
  onProgress: (progress: SyncProgress) => void,
): Promise<{ success: boolean; synced: Record<string, number>; errors: string[] }> {
  const base = getApiBase();
  const token = getAuthToken();
  const db = getDb();

  if (!base || !token) {
    return { success: false, synced: {}, errors: ['Not authenticated. Please log in first.'] };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const counts = getUnsyncedCounts();
  const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
  if (totalRecords === 0) {
    return { success: true, synced: {}, errors: [] };
  }

  const synced: Record<string, number> = {};
  const errors: string[] = [];
  let overallDone = 0;

  for (let tableIdx = 0; tableIdx < SYNC_TABLES.length; tableIdx++) {
    const tableName = SYNC_TABLES[tableIdx];
    const endpoint = STRAPI_ENDPOINTS[tableName];
    const displayName = TABLE_DISPLAY_NAMES[tableName] || tableName;

    // Profile is PUT (single record), everything else is POST
    const isProfile = tableName === 'nutrition_profile';

    // Get unsynced rows
    const rows = db.getAllSync(
      `SELECT * FROM ${tableName} WHERE synced_at IS NULL ORDER BY ${isProfile ? 'id' : 'created_at'} ASC`
    ) as any[];

    synced[tableName] = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const payload = rowToStrapiPayload(tableName, row);

      onProgress({
        currentTable: displayName,
        currentIndex: i + 1,
        totalForTable: rows.length,
        tablesCompleted: tableIdx,
        totalTables: SYNC_TABLES.length,
        overallPct: Math.round((overallDone / totalRecords) * 100),
      });

      try {
        const method = isProfile ? 'PUT' : 'POST';
        const res = await fetch(`${base}${endpoint}`, {
          method,
          headers,
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          markRecordSynced(tableName, row.id);
          synced[tableName]!++;
        } else {
          const text = await res.text().catch(() => '');
          errors.push(`${displayName} #${row.id}: ${res.status} ${text.substring(0, 100)}`);
        }
      } catch (e: any) {
        errors.push(`${displayName} #${row.id}: ${e.message || 'Network error'}`);
      }

      overallDone++;
    }
  }

  // Final progress
  onProgress({
    currentTable: 'Done',
    currentIndex: 0,
    totalForTable: 0,
    tablesCompleted: SYNC_TABLES.length,
    totalTables: SYNC_TABLES.length,
    overallPct: 100,
  });

  return {
    success: errors.length === 0,
    synced,
    errors,
  };
}

/** Get human-readable sync stats. */
export function getSyncStats(): { total: number; tables: Record<string, number> } {
  const counts = getUnsyncedCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { total, tables: counts };
}
