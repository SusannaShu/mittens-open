/**
 * LocalDataProvider -- SQLite-backed DataProvider implementation.
 *
 * Mirrors all Backend CRUD operations using local SQLite.
 * Every write enqueues a sync record for cloud push.
 */

import { DataProvider, MealInput, DailySummaryResult, SyncManifest } from './dataProvider';
import { MealEntry, NutrientValues, NutrientGap, FoodRecommendation } from '../types';
import { getDb, enqueueSyncRecord } from '../database';
import { NUTRIENT_STORAGE } from '../data/nutrientStorage';

// RDA values for gap calculation (subset for MVP, matches backend rda-calculator)
const RDA: Record<string, { name: string; unit: string; rda: number; ul?: number }> = {
  calories:    { name: 'Calories',     unit: 'kcal', rda: 2133 },
  protein:     { name: 'Protein',      unit: 'g',    rda: 95 },
  carbs:       { name: 'Carbohydrates', unit: 'g',   rda: 236 },
  fat:         { name: 'Total Fat',    unit: 'g',    rda: 59 },
  fiber:       { name: 'Fiber',        unit: 'g',    rda: 25 },
  vitamin_a:   { name: 'Vitamin A',    unit: 'mcg',  rda: 700, ul: 3000 },
  vitamin_c:   { name: 'Vitamin C',    unit: 'mg',   rda: 75, ul: 2000 },
  vitamin_d:   { name: 'Vitamin D',    unit: 'mcg',  rda: 15, ul: 100 },
  vitamin_e:   { name: 'Vitamin E',    unit: 'mg',   rda: 15, ul: 1000 },
  vitamin_k:   { name: 'Vitamin K',    unit: 'mcg',  rda: 90 },
  vitamin_b6:  { name: 'Vitamin B6',   unit: 'mg',   rda: 1.3, ul: 100 },
  vitamin_b12: { name: 'Vitamin B12',  unit: 'mcg',  rda: 2.4 },
  folate:      { name: 'Folate',       unit: 'mcg',  rda: 400, ul: 1000 },
  calcium:     { name: 'Calcium',      unit: 'mg',   rda: 1000, ul: 2500 },
  iron:        { name: 'Iron',         unit: 'mg',   rda: 18, ul: 45 },
  magnesium:   { name: 'Magnesium',    unit: 'mg',   rda: 310 },
  potassium:   { name: 'Potassium',    unit: 'mg',   rda: 2600 },
  zinc:        { name: 'Zinc',         unit: 'mg',   rda: 8, ul: 40 },
  omega3:      { name: 'Omega-3',      unit: 'g',    rda: 1.1 },
};

function parseJson(val: string | null | undefined): any {
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

const VALID_MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'activity']);

function sanitizeMealType(raw: string | null | undefined): string {
  if (raw && VALID_MEAL_TYPES.has(raw.toLowerCase())) return raw.toLowerCase();
  const hour = new Date().getHours();
  if (hour < 10) return 'breakfast';
  if (hour < 14) return 'lunch';
  if (hour < 20) return 'dinner';
  return 'snack';
}

export class LocalDataProvider implements DataProvider {
  // ─── Messages ───

  async loadMessages(limit = 100, start = 0): Promise<{ messages: any[]; total: number }> {
    const db = getDb();
    const totalRow = db.getFirstSync('SELECT COUNT(*) as count FROM mittens_messages') as any;
    const total = totalRow?.count || 0;

    const rows = db.getAllSync(
      'SELECT * FROM mittens_messages ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, start]
    ) as any[];

    const messages = rows.map(row => ({
      id: row.id,
      role: row.role,
      text: row.text,
      photos: parseJson(row.photos),
      activityType: row.activity_type,
      metadata: parseJson(row.metadata),
      created_at: row.created_at,
    }));

    return { messages, total };
  }

  async saveMessage(msg: { role: 'user' | 'mittens'; text: string; photos?: string[]; activityType?: string; metadata?: any }): Promise<{ id: number }> {
    const db = getDb();
    const result = db.runSync(
      'INSERT INTO mittens_messages (role, text, photos, activity_type, metadata) VALUES (?, ?, ?, ?, ?)',
      [msg.role, msg.text, msg.photos ? JSON.stringify(msg.photos) : null, msg.activityType || null, msg.metadata ? JSON.stringify(msg.metadata) : null]
    );
    const id = result.lastInsertRowId;
    enqueueSyncRecord('mittens_messages', id, 'create');
    return { id };
  }

  async saveMessageBatch(messages: Array<{ role: 'user' | 'mittens'; text: string; photos?: string[]; activityType?: string; metadata?: any }>): Promise<{ saved: number }> {
    for (const msg of messages) {
      await this.saveMessage(msg);
    }
    return { saved: messages.length };
  }

  async deleteMessagesSince(id: number): Promise<void> {
    const db = getDb();
    const rows = db.getAllSync('SELECT id FROM mittens_messages WHERE id >= ?', [id]) as any[];
    db.runSync('DELETE FROM mittens_messages WHERE id >= ?', [id]);
    for (const row of rows) {
      enqueueSyncRecord('mittens_messages', row.id, 'delete');
    }
  }

  async getRecentMessages(limit: number): Promise<any[]> {
    const db = getDb();
    const rows = db.getAllSync(
      'SELECT * FROM mittens_messages ORDER BY created_at DESC LIMIT ?',
      [limit]
    ) as any[];
    return rows.map(row => ({
      id: row.id,
      role: row.role,
      text: row.text,
      photos: parseJson(row.photos),
      createdAt: row.created_at,
      timestamp: row.created_at,
    }));
  }

  async updateMessage(id: number, updates: { metadata?: any }): Promise<void> {
    const db = getDb();
    if (updates.metadata) {
      // Merge with existing metadata
      const row = db.getFirstSync('SELECT metadata FROM mittens_messages WHERE id = ?', [id]) as any;
      const existing = parseJson(row?.metadata) || {};
      const merged = { ...existing, ...updates.metadata };
      db.runSync('UPDATE mittens_messages SET metadata = ? WHERE id = ?', [JSON.stringify(merged), id]);
    }
  }

  // ─── Nutrition ───

  async logMeal(meal: MealInput): Promise<{ id: number }> {
    const db = getDb();
    const now = new Date().toISOString();
    const loggedAt = meal.loggedAt || now;
    const summaryNutrients = this.computeMealNutrients(meal.items || []);

    const result = db.runSync(
      `INSERT INTO nutrition_logs (logged_at, meal_type, log_name, items, summary_nutrients, source, entry_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'food', ?, ?)`,
      [loggedAt, sanitizeMealType(meal.mealType), meal.logName || null, JSON.stringify(meal.items), JSON.stringify(summaryNutrients), meal.source || 'manual', now, now]
    );
    const id = result.lastInsertRowId;
    enqueueSyncRecord('nutrition_logs', id, 'create');
    return { id };
  }

  async getMeal(id: number): Promise<MealEntry> {
    const db = getDb();
    const row = db.getFirstSync('SELECT * FROM nutrition_logs WHERE id = ?', [id]) as any;
    if (!row) throw new Error(`Meal ${id} not found`);
    return this.rowToMealEntry(row);
  }

  async updateMeal(id: number, updates: Partial<MealEntry>): Promise<void> {
    const db = getDb();
    const sets: string[] = [];
    const vals: any[] = [];

    if (updates.items !== undefined) { sets.push('items = ?'); vals.push(JSON.stringify(updates.items)); }
    if (updates.logName !== undefined) { sets.push('log_name = ?'); vals.push(updates.logName || null); }
    if (updates.mealType !== undefined) { sets.push('meal_type = ?'); vals.push(updates.mealType || null); }
    if (updates.summaryNutrients !== undefined) { sets.push('summary_nutrients = ?'); vals.push(JSON.stringify(updates.summaryNutrients)); }
    sets.push("updated_at = datetime('now')");
    vals.push(id);

    if (sets.length > 1) {
      db.runSync(`UPDATE nutrition_logs SET ${sets.join(', ')} WHERE id = ?`, vals);
      enqueueSyncRecord('nutrition_logs', id, 'update');
    }
  }

  async deleteMeal(id: number): Promise<void> {
    const db = getDb();
    db.runSync('DELETE FROM nutrition_logs WHERE id = ?', [id]);
    enqueueSyncRecord('nutrition_logs', id, 'delete');
  }

  async getDailyMeals(date: string): Promise<MealEntry[]> {
    const db = getDb();
    const rows = db.getAllSync(
      `SELECT * FROM nutrition_logs WHERE date(logged_at, 'localtime') = ? AND entry_type = 'food' ORDER BY logged_at ASC`,
      [date]
    ) as any[];
    return rows.map(r => this.rowToMealEntry(r));
  }

  async getDailySummary(date: string): Promise<DailySummaryResult> {
    const meals = await this.getDailyMeals(date);
    const totals = this.sumNutrients(meals.map(m => m.summaryNutrients));
    
    // Aggregate activity nutrient impacts (such as Vitamin D from outdoor sun exposure) into today's totals
    const activities = await this.getDailyActivities(date);
    for (const act of activities) {
      try {
        const impact = typeof act.nutrient_impact === 'string'
          ? parseJson(act.nutrient_impact)
          : act.nutrient_impact;
        if (impact) {
          for (const [key, val] of Object.entries(impact)) {
            if (typeof val === 'number') {
              totals[key] = (totals[key] || 0) + val;
            }
          }
        }
      } catch (err) {
        console.error('Failed to parse activity nutrient impact', err);
      }
    }

    const gaps = this.computeGaps(totals, date);
    const recommendations = this.computeRecommendations(gaps);
    const pantry = this.getPantryItems();

    // Build storedSources for nutrients with rolling windows
    const storedSources: Record<string, any[]> = {};
    for (const gap of gaps) {
      if (gap.period === 'stored' && gap.avgDays) {
        const rolling = this.getRollingNutrientData(gap.nutrient, date, gap.avgDays);
        if (rolling.sources.length > 0) {
          storedSources[gap.nutrient] = rolling.sources;
        }
      }
    }

    return { date, meals, totals, gaps, recommendations, pantry, storedSources };
  }

  private getPantryItems(): any[] {
    try {
      const db = getDb();
      const rows = db.getAllSync(
        'SELECT id, item_name, quantity, unit, freshness, last_seen_at, updated_at FROM smart_pantry WHERE quantity > 0 ORDER BY updated_at DESC'
      ) as any[];
      return rows.map(r => ({
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
    } catch {
      return [];
    }
  }

  // ─── Activities ───

  async logActivity(data: any): Promise<{ id: number }> {
    const db = getDb();
    const now = new Date().toISOString();
    const result = db.runSync(
      `INSERT INTO activity_logs (log_name, activity_type, duration_min, intensity, logged_at, outdoors, nature, location, nutrient_impact, absorption_multiplier, summary, source, meta, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.logName || data.activityType || 'Activity',
        data.activityType || 'other',
        data.duration_min || 30,
        data.intensity || 'moderate',
        data.loggedAt || now,
        data.outdoors ? 1 : 0,
        data.nature ? 1 : 0,
        data.location || null,
        data.nutrientImpact ? JSON.stringify(data.nutrientImpact) : null,
        data.absorptionMultiplier || 1.0,
        data.summary || null,
        data.source || 'manual',
        data.meta ? JSON.stringify(data.meta) : null,
        now, now,
      ]
    );
    const id = result.lastInsertRowId;
    enqueueSyncRecord('activity_logs', id, 'create');
    return { id };
  }

  async updateActivity(id: number, data: any): Promise<void> {
    const db = getDb();
    db.runSync(
      `UPDATE activity_logs SET
        log_name = ?, activity_type = ?, duration_min = ?, intensity = ?,
        outdoors = ?, nature = ?, nutrient_impact = ?, summary = ?,
        meta = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        data.logName || data.activityType,
        data.activityType || 'other',
        data.duration_min || 30,
        data.intensity || 'moderate',
        data.outdoors ? 1 : 0,
        data.nature ? 1 : 0,
        data.nutrientImpact ? JSON.stringify(data.nutrientImpact) : null,
        data.summary || null,
        data.meta ? JSON.stringify(data.meta) : null,
        id,
      ]
    );
    enqueueSyncRecord('activity_logs', id, 'update');
  }

  async deleteActivity(id: number): Promise<void> {
    const db = getDb();
    db.runSync('DELETE FROM activity_logs WHERE id = ?', [id]);
    enqueueSyncRecord('activity_logs', id, 'delete');
  }

  async getDailyActivities(date: string): Promise<any[]> {
    const db = getDb();
    return db.getAllSync(
      'SELECT * FROM activity_logs WHERE date(logged_at, \'localtime\') = ? ORDER BY logged_at ASC',
      [date]
    ) as any[];
  }

  // ─── Sleep ───

  async logSleep(data: any): Promise<{ id: number }> {
    const db = getDb();
    const now = new Date().toISOString();
    const result = db.runSync(
      `INSERT INTO sleep_logs (went_to_bed, woke_up, total_minutes, quality, notes, logged_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.wentToBed, data.wokeUp, data.totalMinutes, data.quality || 'ok', data.notes || null, data.loggedAt || now, now, now]
    );
    const id = result.lastInsertRowId;
    enqueueSyncRecord('sleep_logs', id, 'create');
    return { id };
  }

  async updateSleep(id: number, data: any): Promise<void> {
    const db = getDb();
    db.runSync(
      `UPDATE sleep_logs SET went_to_bed = ?, woke_up = ?, total_minutes = ?, quality = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
      [data.wentToBed, data.wokeUp, data.totalMinutes, data.quality, data.notes || null, id]
    );
    enqueueSyncRecord('sleep_logs', id, 'update');
  }

  async deleteSleep(id: number): Promise<void> {
    const db = getDb();
    db.runSync('DELETE FROM sleep_logs WHERE id = ?', [id]);
    enqueueSyncRecord('sleep_logs', id, 'delete');
  }

  // ─── Profile ───

  async getProfile(): Promise<any> {
    const db = getDb();
    let row = db.getFirstSync('SELECT * FROM nutrition_profile WHERE id = 1') as any;
    if (!row) {
      db.runSync('INSERT OR IGNORE INTO nutrition_profile (id) VALUES (1)');
      row = db.getFirstSync('SELECT * FROM nutrition_profile WHERE id = 1') as any;
    }
    return {
      ...row,
      dislikedFoods: parseJson(row?.disliked_foods) || [],
      memory: parseJson(row?.memory) || {},
      dietaryPreferences: row?.dietary_preferences || '',
      googleCalendarToken: parseJson(row?.google_calendar_token),
      aiModel: row?.ai_model || 'gemma-local',
      homeLatitude: row?.home_latitude,
      homeLongitude: row?.home_longitude,
      homeLabel: row?.home_label,
      wakeTimeLmstMinutes: row?.wake_time_lmst_minutes,
      sleepHours: row?.sleep_hours,
      chronotype: row?.chronotype,
      breakfastOffsetMinutes: row?.breakfast_offset_minutes,
      dinnerBeforeBedMinutes: row?.dinner_before_bed_minutes,
      scheduleMode: row?.schedule_mode,
      scheduleTravelMode: row?.schedule_travel_mode,
      scheduleEnabled: row?.schedule_enabled === 1,
      workIntervalMins: row?.work_interval_mins,
      travelMode: row?.travel_mode,
      bedtimeEnabled: row?.bedtime_enabled !== 0,
      departureAlarmsEnabled: row?.departure_alarms_enabled !== 0,
      proactiveCheckins: row?.proactive_checkins !== 0,
      onboarded: row?.onboarded === 1,
    };
  }

  async updateProfile(updates: any): Promise<void> {
    const db = getDb();
    // Ensure row exists
    db.runSync('INSERT OR IGNORE INTO nutrition_profile (id) VALUES (1)');

    const fieldMap: Record<string, string> = {
      name: 'name',
      dietaryPreferences: 'dietary_preferences',
      dislikedFoods: 'disliked_foods',
      memory: 'memory',
      aiModel: 'ai_model',
      homeLatitude: 'home_latitude',
      homeLongitude: 'home_longitude',
      homeLabel: 'home_label',
      travelMode: 'travel_mode',
      bedtimeEnabled: 'bedtime_enabled',
      departureAlarmsEnabled: 'departure_alarms_enabled',
      proactiveCheckins: 'proactive_checkins',
      workIntervalMins: 'work_interval_mins',
    };

    const sets: string[] = [];
    const vals: any[] = [];

    for (const [key, val] of Object.entries(updates)) {
      const col = fieldMap[key] || key;
      if (typeof val === 'object' && val !== null) {
        sets.push(`${col} = ?`);
        vals.push(JSON.stringify(val));
      } else if (typeof val === 'boolean') {
        sets.push(`${col} = ?`);
        vals.push(val ? 1 : 0);
      } else {
        sets.push(`${col} = ?`);
        vals.push(val);
      }
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      db.runSync(`UPDATE nutrition_profile SET ${sets.join(', ')} WHERE id = 1`, vals);
      enqueueSyncRecord('nutrition_profile', 1, 'update');
    }
  }

  // ─── Sync ───

  async getUnsyncedRecords(): Promise<SyncManifest[]> {
    const db = getDb();
    const tables = ['mittens_messages', 'nutrition_logs', 'activity_logs', 'sleep_logs', 'known_places'];
    const manifests: SyncManifest[] = [];

    for (const table of tables) {
      const rows = db.getAllSync(`SELECT id FROM ${table} WHERE synced_at IS NULL`) as any[];
      if (rows.length > 0) {
        manifests.push({
          table,
          ids: rows.map(r => r.id),
          lastSyncedAt: null,
        });
      }
    }
    return manifests;
  }

  async markSynced(table: string, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    db.runSync(`UPDATE ${table} SET synced_at = datetime('now') WHERE id IN (${placeholders})`, ids);
  }

  // ─── Helpers ───

  private rowToMealEntry(row: any): MealEntry {
    return {
      id: row.id,
      loggedAt: row.logged_at,
      logName: row.log_name || '',
      mealType: row.meal_type,
      items: parseJson(row.items) || [],
      summaryNutrients: parseJson(row.summary_nutrients) || {},
      source: row.source || 'manual',
      entryType: row.entry_type || 'food',
      activityMeta: parseJson(row.activity_meta),
      imageUrl: null,
    };
  }

  private computeMealNutrients(items: any[]): NutrientValues {
    const totals: NutrientValues = {};
    for (const item of items) {
      const nutrients = item.nutrients || {};
      for (const [key, val] of Object.entries(nutrients)) {
        if (typeof val === 'number') {
          totals[key] = (totals[key] || 0) + val;
        }
      }
    }
    return totals;
  }

  private sumNutrients(nutrientsList: NutrientValues[]): NutrientValues {
    const totals: NutrientValues = {};
    for (const nutrients of nutrientsList) {
      for (const [key, val] of Object.entries(nutrients)) {
        if (typeof val === 'number') {
          totals[key] = (totals[key] || 0) + val;
        }
      }
    }
    return totals;
  }

  /**
   * Retrieve rolling nutrient data over a multi-day window.
   * Used for 'stored' nutrients (fat-soluble vitamins, minerals with body reserves)
   * to compute daily average intake instead of single-day snapshots.
   */
  private getRollingNutrientData(nutrient: string, date: string, days: number): { avgDaily: number; total: number; daysWithData: number; sources: any[] } {
    const db = getDb();
    const rows = db.getAllSync(
      `SELECT logged_at, summary_nutrients, items FROM nutrition_logs
       WHERE date(logged_at, 'localtime') >= date(?, '-' || ? || ' days')
         AND date(logged_at, 'localtime') <= ?
         AND entry_type = 'food'
         AND deleted_at IS NULL`,
      [date, days.toString(), date]
    ) as any[];

    let total = 0;
    const daySet = new Set<string>();
    const sources: any[] = [];

    for (const row of rows) {
      const nutrients = parseJson(row.summary_nutrients) || {};
      const amount = nutrients[nutrient] || 0;
      if (amount > 0) {
        total += amount;
        const d = row.logged_at?.slice(0, 10);
        if (d) daySet.add(d);

        // Track sources for storedSources display
        try {
          const items = parseJson(row.items) || [];
          for (const item of items) {
            const itemAmount = item.nutrients?.[nutrient] || 0;
            if (itemAmount > 0) {
              const dayNum = Math.ceil((new Date(date).getTime() - new Date(row.logged_at).getTime()) / 86400000);
              sources.push({
                name: item.name || item.foodName || 'Unknown',
                value: itemAmount,
                days: dayNum || 0,
                nutrient_source: item.nutrient_source || 'ai_estimate',
              });
            }
          }
        } catch {}
      }
    }

    // Also check activity_logs for vitamin D from sun exposure
    if (nutrient === 'vitamin_d') {
      const actRows = db.getAllSync(
        `SELECT logged_at, nutrient_impact, log_name FROM activity_logs
         WHERE date(logged_at, 'localtime') >= date(?, '-' || ? || ' days')
           AND date(logged_at, 'localtime') <= ?
           AND nutrient_impact IS NOT NULL`,
        [date, days.toString(), date]
      ) as any[];
      for (const act of actRows) {
        try {
          const impact = parseJson(act.nutrient_impact) || {};
          if (impact.vitamin_d > 0) {
            total += impact.vitamin_d;
            const d = act.logged_at?.slice(0, 10);
            if (d) daySet.add(d);
            sources.push({
              name: act.log_name || 'Sun exposure',
              value: impact.vitamin_d,
              days: Math.ceil((new Date(date).getTime() - new Date(act.logged_at).getTime()) / 86400000) || 0,
              nutrient_source: 'activity',
            });
          }
        } catch {}
      }
    }

    return {
      total,
      avgDaily: daySet.size > 0 ? total / days : 0,
      daysWithData: daySet.size,
      sources: sources.sort((a, b) => b.value - a.value).slice(0, 10),
    };
  }

  private computeGaps(totals: NutrientValues, date: string): NutrientGap[] {
    const gaps: NutrientGap[] = [];
    for (const [key, rdaInfo] of Object.entries(RDA)) {
      const storage = NUTRIENT_STORAGE[key];
      let intake = totals[key] || 0;
      let period: 'daily' | 'stored' = 'daily';
      let avgDays: number | null = null;

      // For stored nutrients with multi-day windows, use rolling average
      // when enough historical data exists
      if (storage?.period === 'stored' && storage.rollingDays > 1) {
        const rolling = this.getRollingNutrientData(key, date, storage.rollingDays);
        if (rolling.daysWithData >= storage.rollingDays) {
          intake = rolling.avgDaily;
          period = 'stored';
          avgDays = storage.rollingDays;
        }
        // else: not enough data, fall back to today-only
      }

      const pct = rdaInfo.rda > 0 ? Math.round((intake / rdaInfo.rda) * 100) : 100;
      const ulPct = rdaInfo.ul ? Math.round((intake / rdaInfo.ul) * 100) : null;

      let status: NutrientGap['status'] = 'good';
      if (ulPct && ulPct > 100) status = 'excess';
      else if (pct < 50) status = 'low';
      else if (pct < 80) status = 'moderate';
      else if (pct > 120 && rdaInfo.ul) status = 'high';

      gaps.push({
        nutrient: key,
        name: rdaInfo.name,
        unit: rdaInfo.unit,
        rda: rdaInfo.rda,
        ul: rdaInfo.ul || null,
        intake,
        actual: intake,
        pct,
        ulPct: ulPct || null,
        status,
        period,
        avgDays,
      });
    }
    return gaps.sort((a, b) => a.pct - b.pct);
  }

  private computeRecommendations(gaps: NutrientGap[]): FoodRecommendation[] {
    // Simple recommendation engine (full version would use USDA data)
    const FOOD_SOURCES: Record<string, Array<{ food: string; portion: string; amount: number }>> = {
      vitamin_d: [
        { food: 'Salmon (3 oz)', portion: '85g', amount: 14.2 },
        { food: 'Egg yolk', portion: '1 large', amount: 1.1 },
      ],
      iron: [
        { food: 'Beef (3 oz)', portion: '85g', amount: 2.6 },
        { food: 'Spinach (1 cup cooked)', portion: '180g', amount: 6.4 },
      ],
      calcium: [
        { food: 'Yogurt (1 cup)', portion: '245g', amount: 415 },
        { food: 'Milk (1 cup)', portion: '240ml', amount: 300 },
      ],
      magnesium: [
        { food: 'Dark chocolate (1 oz)', portion: '28g', amount: 50 },
        { food: 'Almonds (1 oz)', portion: '28g', amount: 80 },
      ],
      vitamin_c: [
        { food: 'Bell pepper (1 medium)', portion: '120g', amount: 152 },
        { food: 'Orange (1 medium)', portion: '130g', amount: 70 },
      ],
      potassium: [
        { food: 'Banana (1 medium)', portion: '118g', amount: 422 },
        { food: 'Sweet potato (1 medium)', portion: '130g', amount: 541 },
      ],
    };

    const recs: FoodRecommendation[] = [];
    for (const gap of gaps) {
      if (gap.pct >= 80) continue; // Only recommend for deficits
      const sources = FOOD_SOURCES[gap.nutrient];
      if (sources && sources.length > 0) {
        const top = sources[0];
        recs.push({
          food: top.food,
          portion: top.portion,
          amountPerServing: top.amount,
          helpsWith: gap.name,
          gapPct: gap.pct,
          deficit: gap.rda - gap.intake,
          unit: gap.unit,
          nutrientKey: gap.nutrient,
          allSources: sources,
        });
      }
    }
    return recs.slice(0, 6); // Top 6 recommendations
  }
}
