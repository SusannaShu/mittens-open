/**
 * database.ts -- SQLite database for local-first mode.
 *
 * Mirrors all Backend collections. JSON columns for complex data.
 * synced_at tracks which records have been pushed to cloud.
 * Uses lazy require to avoid loading native module at app startup.
 */

const DB_NAME = 'mittens.db';

let db: any = null;

/** Get or create the SQLite database instance. */
export function getDb(): any {
  if (!db) {
    const SQLite = require('expo-sqlite');
    db = SQLite.openDatabaseSync(DB_NAME);
  }
  return db;
}

/** Initialize all tables. Call once on app start when in local mode. */
export async function initializeDatabase(): Promise<void> {
  const database = getDb();

  database.execSync(`

    -- Chat messages
    CREATE TABLE IF NOT EXISTS mittens_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('user', 'mittens')),
      text TEXT NOT NULL DEFAULT '',
      photos TEXT,
      activity_type TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- Nutrition logs (meals)
    CREATE TABLE IF NOT EXISTS nutrition_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      logged_at TEXT NOT NULL,
      meal_type TEXT CHECK(meal_type IN ('breakfast','lunch','dinner','snack','drink','activity')),
      food_name TEXT,
      portion_g REAL,
      cooking TEXT,
      nutrients TEXT,
      log_name TEXT,
      items TEXT,
      summary_nutrients TEXT,
      estimation_status TEXT DEFAULT 'complete' CHECK(estimation_status IN ('pending','estimating','partial','complete')),
      source TEXT DEFAULT 'vision' CHECK(source IN ('vision','manual')),
      entry_type TEXT DEFAULT 'food' CHECK(entry_type IN ('food','activity')),
      activity_meta TEXT,
      energy INTEGER,
      eating_context TEXT,
      image_uris TEXT,
      user_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- Activity logs
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      log_name TEXT,
      activity_type TEXT,
      duration_min REAL,
      intensity TEXT CHECK(intensity IN ('low','moderate','high')),
      logged_at TEXT NOT NULL,
      outdoors INTEGER DEFAULT 0,
      is_nature INTEGER DEFAULT 0,
      is_strength INTEGER DEFAULT 0,
      mets REAL,
      location TEXT,
      nutrient_impact TEXT,
      absorption_multiplier REAL DEFAULT 1.0,
      summary TEXT,
      engagement INTEGER,
      energy INTEGER,
      aeiou TEXT,
      life_categories TEXT,
      sub_categories TEXT,
      google_event_id TEXT,
      source TEXT DEFAULT 'manual',
      meta TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- Sleep logs
    CREATE TABLE IF NOT EXISTS sleep_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      went_to_bed TEXT,
      woke_up TEXT,
      total_minutes REAL,
      quality TEXT CHECK(quality IN ('great','good','ok','poor')),
      energy INTEGER,
      morning_light INTEGER DEFAULT 0,
      notes TEXT,
      logged_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- Known places
    CREATE TABLE IF NOT EXISTS known_places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      radius_m REAL DEFAULT 100,
      place_type TEXT DEFAULT 'other',
      icon TEXT,
      auto_detected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- Nutrition profile (single row)
    CREATE TABLE IF NOT EXISTS nutrition_profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      name TEXT,
      dietary_preferences TEXT,
      disliked_foods TEXT,
      memory TEXT,
      ai_model TEXT DEFAULT 'gemma-local',
      home_latitude REAL,
      home_longitude REAL,
      home_label TEXT,
      wake_time_lmst_minutes INTEGER DEFAULT 375,
      sleep_hours REAL DEFAULT 8,
      chronotype TEXT DEFAULT 'intermediate',
      breakfast_offset_minutes INTEGER DEFAULT 30,
      dinner_before_bed_minutes INTEGER DEFAULT 180,
      schedule_mode TEXT DEFAULT 'local_clock',
      schedule_travel_mode TEXT DEFAULT 'home',
      schedule_enabled INTEGER DEFAULT 1,
      work_interval_mins INTEGER DEFAULT 45,
      travel_mode TEXT DEFAULT 'transit',
      bedtime_enabled INTEGER DEFAULT 1,
      departure_alarms_enabled INTEGER DEFAULT 1,
      proactive_checkins INTEGER DEFAULT 1,
      google_calendar_token TEXT,
      gmail_token TEXT,
      onboarded INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- Daily meal plans
    CREATE TABLE IF NOT EXISTS daily_meal_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_date TEXT NOT NULL,
      breakfast TEXT,
      lunch TEXT,
      dinner TEXT,
      snacks TEXT,
      gap_coverage TEXT,
      grocery_list TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- Planned schedules
    CREATE TABLE IF NOT EXISTS planned_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_date TEXT NOT NULL,
      events TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- Location logs
    CREATE TABLE IF NOT EXISTS location_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      speed REAL,
      heading REAL,
      altitude REAL,
      accuracy REAL,
      activity_type TEXT,
      place_name TEXT,
      recorded_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- Location sessions
    CREATE TABLE IF NOT EXISTS location_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      start_lat REAL,
      start_lon REAL,
      end_lat REAL,
      end_lon REAL,
      distance_m REAL,
      motion_type TEXT,
      place_name TEXT,
      trail TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- Calendar events (synced from Google)
    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_event_id TEXT,
      title TEXT,
      start_time TEXT,
      end_time TEXT,
      location TEXT,
      description TEXT,
      all_day INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- Wardrobe items (ported from email order confirmations)
    CREATE TABLE IF NOT EXISTS wardrobe_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      brand TEXT,
      price_amount REAL,
      price_currency TEXT DEFAULT 'USD',
      size TEXT,
      color TEXT,
      category TEXT DEFAULT 'other',
      image_url TEXT,
      order_number TEXT,
      order_date TEXT,
      retailer TEXT,
      status TEXT DEFAULT 'delivered',
      source_email_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- Activity types: user-customizable presets with deterministic metadata
    CREATE TABLE IF NOT EXISTS activity_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      icon TEXT,
      default_life_categories TEXT,
      sub_categories TEXT,
      default_mets REAL,
      is_strength INTEGER DEFAULT 0,
      is_nature INTEGER DEFAULT 0,
      default_intensity TEXT DEFAULT 'moderate',
      default_outdoors INTEGER DEFAULT 0,
      show_in_timer INTEGER DEFAULT 1,
      show_in_manual_log INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      is_built_in INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- Life balance config: user's gauge customization (single row per user)
    CREATE TABLE IF NOT EXISTS life_balance_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      categories TEXT NOT NULL,
      sub_category_definitions TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- People: relationship tracking for AEIOU Users + Life Design Team
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      nickname TEXT,
      team_role TEXT CHECK(team_role IN ('supporter','player','intimate','mentor','collaborator')),
      context TEXT,
      interaction_count INTEGER DEFAULT 0,
      avg_engagement REAL,
      avg_energy REAL,
      last_seen_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- Sync queue: tracks records that need to be pushed to Backend
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id INTEGER NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('create','update','delete')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Saved watch sources (user shortcuts for quick re-fetch)
    CREATE TABLE IF NOT EXISTS watch_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      label TEXT,
      source_type TEXT DEFAULT 'web',
      filter_note TEXT,
      fetch_method TEXT DEFAULT 'auto',
      platform TEXT,
      platform_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Watch result cache (dedup + history)
    CREATE TABLE IF NOT EXISTS watch_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER REFERENCES watch_sources(id),
      item_hash TEXT NOT NULL,
      title TEXT,
      url TEXT,
      summary TEXT,
      image_url TEXT,
      image_local_path TEXT,
      author TEXT,
      published_at TEXT,
      extracted_data TEXT,
      filter_reason TEXT,
      shown_at TEXT DEFAULT (datetime('now'))
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_messages_created ON mittens_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_nutrition_logged ON nutrition_logs(logged_at);
    CREATE INDEX IF NOT EXISTS idx_activity_logged ON activity_logs(logged_at);
    CREATE INDEX IF NOT EXISTS idx_sleep_logged ON sleep_logs(logged_at);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_table ON sync_queue(table_name);
    CREATE INDEX IF NOT EXISTS idx_wardrobe_category ON wardrobe_items(category);
    CREATE INDEX IF NOT EXISTS idx_wardrobe_retailer ON wardrobe_items(retailer);
    CREATE INDEX IF NOT EXISTS idx_watch_items_hash ON watch_items(item_hash);
    CREATE INDEX IF NOT EXISTS idx_watch_items_shown ON watch_items(shown_at);
  `);
}

/** Enqueue a record for sync to cloud. */
export function enqueueSyncRecord(tableName: string, recordId: number, operation: 'create' | 'update' | 'delete'): void {
  const database = getDb();
  database.runSync(
    'INSERT INTO sync_queue (table_name, record_id, operation) VALUES (?, ?, ?)',
    [tableName, recordId, operation]
  );
}

/** Get all pending sync records. */
export function getPendingSyncRecords(): Array<{ id: number; table_name: string; record_id: number; operation: string }> {
  const database = getDb();
  return database.getAllSync(
    'SELECT id, table_name, record_id, operation FROM sync_queue ORDER BY created_at ASC'
  ) as any[];
}

/** Clear sync queue entries after successful push. */
export function clearSyncRecords(ids: number[]): void {
  if (ids.length === 0) return;
  const database = getDb();
  const placeholders = ids.map(() => '?').join(',');
  database.runSync(`DELETE FROM sync_queue WHERE id IN (${placeholders})`, ids);
}

/** Mark a record as synced. */
export function markRecordSynced(tableName: string, recordId: number): void {
  const database = getDb();
  database.runSync(
    `UPDATE ${tableName} SET synced_at = datetime('now') WHERE id = ?`,
    [recordId]
  );
}

/** Get count of unsynced records per table (for progress display). */
export function getUnsyncedCounts(): Record<string, number> {
  const database = getDb();
  const tables = [
    'mittens_messages', 'nutrition_logs', 'activity_logs', 'sleep_logs',
    'known_places', 'nutrition_profile', 'daily_meal_plans',
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const row = database.getFirstSync(`SELECT COUNT(*) as count FROM ${table} WHERE synced_at IS NULL`) as any;
    counts[table] = row?.count || 0;
  }
  return counts;
}

/** Reset database (for debugging). */
export function resetDatabase(): void {
  const database = getDb();
  const tables = [
    'sync_queue', 'mittens_messages', 'nutrition_logs', 'activity_logs',
    'sleep_logs', 'known_places', 'nutrition_profile', 'daily_meal_plans',
    'planned_schedules', 'location_logs', 'location_sessions', 'calendar_events',
  ];
  for (const table of tables) {
    database.runSync(`DELETE FROM ${table}`);
  }
}
