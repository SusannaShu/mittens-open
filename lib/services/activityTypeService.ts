import { getDb, enqueueSyncRecord } from '../database';
import { ActivityTypeModel } from '../pipelines/types';

/**
 * Service for managing user-customizable Activity Types locally.
 * Includes fallback to default built-in types if the local database is empty.
 */

const BUILT_IN_TYPES: ActivityTypeModel[] = [
  { key: 'walk',       label: 'Walk',       icon: 'walking',     defaultLifeCategories: { health: 0.7, play: 0.3 }, subCategories: ['movement'],                  defaultMets: 3.5, isStrength: false, isNature: false, defaultIntensity: 'moderate', defaultOutdoors: true,  showInTimer: true, showInManualLog: true, sortOrder: 0,  isBuiltIn: true },
  { key: 'run',        label: 'Run',        icon: 'running',     defaultLifeCategories: { health: 0.9, play: 0.1 }, subCategories: ['movement'],                  defaultMets: 8.0, isStrength: false, isNature: false, defaultIntensity: 'high',     defaultOutdoors: true,  showInTimer: true, showInManualLog: true, sortOrder: 1,  isBuiltIn: true },
  { key: 'bike',       label: 'Bike',       icon: 'bike',        defaultLifeCategories: { health: 0.8, play: 0.2 }, subCategories: ['movement'],                  defaultMets: 6.0, isStrength: false, isNature: false, defaultIntensity: 'moderate', defaultOutdoors: true,  showInTimer: true, showInManualLog: true, sortOrder: 2,  isBuiltIn: true },
  { key: 'workout',    label: 'Workout',    icon: 'dumbbell',    defaultLifeCategories: { health: 0.9, play: 0.1 }, subCategories: ['movement'],                  defaultMets: 5.0, isStrength: true,  isNature: false, defaultIntensity: 'high',     defaultOutdoors: false, showInTimer: true, showInManualLog: true, sortOrder: 3,  isBuiltIn: true },
  { key: 'sun',        label: 'Sun',        icon: 'sun',         defaultLifeCategories: { health: 1.0 },            subCategories: ['touch_grass', 'circadian'],   defaultMets: 1.0, isStrength: false, isNature: true,  defaultIntensity: 'low',      defaultOutdoors: true,  showInTimer: true, showInManualLog: true, sortOrder: 4,  isBuiltIn: true },
  { key: 'work',       label: 'Work',       icon: 'monitor',     defaultLifeCategories: { work: 1.0 },              subCategories: [],                            defaultMets: 1.3, isStrength: false, isNature: false, defaultIntensity: 'moderate', defaultOutdoors: false, showInTimer: true, showInManualLog: true, sortOrder: 5,  isBuiltIn: true },
  { key: 'social',     label: 'Social',     icon: 'users',       defaultLifeCategories: { love: 0.6, play: 0.4 },   subCategories: [],                            defaultMets: 1.5, isStrength: false, isNature: false, defaultIntensity: 'moderate', defaultOutdoors: false, showInTimer: true, showInManualLog: true, sortOrder: 6,  isBuiltIn: true },
  { key: 'rest',       label: 'Rest',       icon: 'moon',        defaultLifeCategories: { health: 0.7, play: 0.3 }, subCategories: [],                            defaultMets: 1.0, isStrength: false, isNature: false, defaultIntensity: 'low',      defaultOutdoors: false, showInTimer: true, showInManualLog: true, sortOrder: 7,  isBuiltIn: true },
  { key: 'cooking',    label: 'Cooking',    icon: 'utensils',    defaultLifeCategories: { health: 0.8, play: 0.2 }, subCategories: [],                            defaultMets: 2.0, isStrength: false, isNature: false, defaultIntensity: 'moderate', defaultOutdoors: false, showInTimer: true, showInManualLog: true, sortOrder: 8,  isBuiltIn: true },
  { key: 'commute',    label: 'Commute',    icon: 'car',         defaultLifeCategories: { work: 1.0 },              subCategories: [],                            defaultMets: 1.3, isStrength: false, isNature: false, defaultIntensity: 'low',      defaultOutdoors: false, showInTimer: true, showInManualLog: true, sortOrder: 9,  isBuiltIn: true },
  { key: 'nature',     label: 'Nature',     icon: 'tree',        defaultLifeCategories: { health: 0.7, play: 0.3 }, subCategories: ['touch_grass'],                defaultMets: 2.5, isStrength: false, isNature: true,  defaultIntensity: 'moderate', defaultOutdoors: true,  showInTimer: true, showInManualLog: true, sortOrder: 10, isBuiltIn: true },
  { key: 'meditation', label: 'Meditation', icon: 'wind',        defaultLifeCategories: { health: 0.5, play: 0.5 }, subCategories: ['brain_hygiene'],              defaultMets: 1.0, isStrength: false, isNature: false, defaultIntensity: 'low',      defaultOutdoors: false, showInTimer: true, showInManualLog: true, sortOrder: 11, isBuiltIn: true },
  { key: 'journal',    label: 'Journal',    icon: 'book-open',   defaultLifeCategories: { health: 0.5, play: 0.5 }, subCategories: ['brain_hygiene'],              defaultMets: 1.0, isStrength: false, isNature: false, defaultIntensity: 'low',      defaultOutdoors: false, showInTimer: true, showInManualLog: true, sortOrder: 12, isBuiltIn: true },
  { key: 'reading',    label: 'Reading',    icon: 'book',        defaultLifeCategories: { play: 0.7, work: 0.3 },   subCategories: [],                            defaultMets: 1.3, isStrength: false, isNature: false, defaultIntensity: 'low',      defaultOutdoors: false, showInTimer: true, showInManualLog: true, sortOrder: 13, isBuiltIn: true },
  { key: 'drawing',    label: 'Drawing',    icon: 'pen-tool',    defaultLifeCategories: { play: 1.0 },              subCategories: [],                            defaultMets: 1.5, isStrength: false, isNature: false, defaultIntensity: 'low',      defaultOutdoors: false, showInTimer: true, showInManualLog: true, sortOrder: 14, isBuiltIn: true },
  { key: 'scrolling',  label: 'Scrolling',  icon: 'smartphone',  defaultLifeCategories: { play: 0.5, rest: 0.5 },   subCategories: ['brain_hygiene_neg'],          defaultMets: 1.0, isStrength: false, isNature: false, defaultIntensity: 'low',      defaultOutdoors: false, showInTimer: true, showInManualLog: true, sortOrder: 15, isBuiltIn: true },
  { key: 'other',      label: 'Other',      icon: 'circle',      defaultLifeCategories: { work: 1.0 },              subCategories: [],                            defaultMets: 1.5, isStrength: false, isNature: false, defaultIntensity: 'moderate', defaultOutdoors: false, showInTimer: true, showInManualLog: true, sortOrder: 16, isBuiltIn: true },
];

function parseJson(val: string | null | undefined): any {
  if (!val) return undefined;
  try { return JSON.parse(val); } catch { return undefined; }
}

export class ActivityTypeService {
  /**
   * Ensure built-in types exist in the local SQLite database.
   */
  static async seedDefaults(): Promise<void> {
    const db = getDb();
    const countRow = db.getFirstSync('SELECT COUNT(*) as count FROM activity_types WHERE is_built_in = 1') as any;
    if (countRow && countRow.count > 0) return;

    for (const type of BUILT_IN_TYPES) {
      db.runSync(
        `INSERT OR IGNORE INTO activity_types (
          key, label, icon, default_life_categories, sub_categories,
          default_mets, is_strength, is_nature, default_intensity,
          default_outdoors, show_in_timer, show_in_manual_log,
          sort_order, is_built_in
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          type.key, type.label, type.icon || null,
          type.defaultLifeCategories ? JSON.stringify(type.defaultLifeCategories) : null,
          type.subCategories ? JSON.stringify(type.subCategories) : null,
          type.defaultMets || null,
          type.isStrength ? 1 : 0,
          type.isNature ? 1 : 0,
          type.defaultIntensity,
          type.defaultOutdoors ? 1 : 0,
          type.showInTimer ? 1 : 0,
          type.showInManualLog ? 1 : 0,
          type.sortOrder,
          1
        ]
      );
    }
  }

  /**
   * Get all activity types
   */
  static async getAll(): Promise<ActivityTypeModel[]> {
    const db = getDb();
    const rows = db.getAllSync('SELECT * FROM activity_types ORDER BY sort_order ASC') as any[];
    return rows.map(r => this.rowToModel(r));
  }

  /**
   * Get a single activity type by key
   */
  static async getByKey(key: string): Promise<ActivityTypeModel | null> {
    const db = getDb();
    const row = db.getFirstSync('SELECT * FROM activity_types WHERE key = ?', [key]) as any;
    if (!row) {
      // Fallback: check if it's a built-in type that hasn't been seeded yet
      const fallback = BUILT_IN_TYPES.find(t => t.key === key);
      return fallback || null;
    }
    return this.rowToModel(row);
  }

  /**
   * Update an activity type (user can edit built-ins or own)
   */
  static async update(key: string, updates: Partial<ActivityTypeModel>): Promise<void> {
    const db = getDb();
    const existing = db.getFirstSync('SELECT id FROM activity_types WHERE key = ?', [key]) as any;
    if (!existing) throw new Error(`Activity type not found: ${key}`);

    const id = existing.id;
    const sets: string[] = [];
    const vals: any[] = [];

    const fieldMap: Record<string, string> = {
      label: 'label',
      icon: 'icon',
      defaultLifeCategories: 'default_life_categories',
      subCategories: 'sub_categories',
      defaultMets: 'default_mets',
      isStrength: 'is_strength',
      isNature: 'is_nature',
      defaultIntensity: 'default_intensity',
      defaultOutdoors: 'default_outdoors',
      showInTimer: 'show_in_timer',
      showInManualLog: 'show_in_manual_log',
      sortOrder: 'sort_order',
    };

    for (const [k, val] of Object.entries(updates)) {
      if (k === 'key' || k === 'isBuiltIn') continue; // cannot update these this way
      const col = fieldMap[k];
      if (!col) continue;

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
      vals.push(id);
      db.runSync(`UPDATE activity_types SET ${sets.join(', ')} WHERE id = ?`, vals);
      enqueueSyncRecord('activity_types', id, 'update');
    }
  }

  /**
   * Create a new custom activity type
   */
  static async create(data: Partial<ActivityTypeModel> & { key: string; label: string }): Promise<void> {
    const db = getDb();
    const existing = db.getFirstSync('SELECT id FROM activity_types WHERE key = ?', [data.key]) as any;
    if (existing) throw new Error(`Activity type already exists: ${data.key}`);

    const maxOrder = db.getFirstSync('SELECT MAX(sort_order) as m FROM activity_types') as any;
    const sortOrder = (maxOrder?.m ?? 0) + 1;

    db.runSync(
      `INSERT INTO activity_types (
        key, label, icon, default_life_categories, sub_categories,
        default_mets, is_strength, is_nature, default_intensity,
        default_outdoors, show_in_timer, show_in_manual_log,
        sort_order, is_built_in
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.key, data.label, data.icon || 'circle',
        data.defaultLifeCategories ? JSON.stringify(data.defaultLifeCategories) : null,
        data.subCategories ? JSON.stringify(data.subCategories) : null,
        data.defaultMets || 1.5,
        data.isStrength ? 1 : 0,
        data.isNature ? 1 : 0,
        data.defaultIntensity || 'moderate',
        data.defaultOutdoors ? 1 : 0,
        data.showInTimer !== false ? 1 : 0,
        data.showInManualLog !== false ? 1 : 0,
        sortOrder,
        0
      ]
    );

    const row = db.getFirstSync('SELECT id FROM activity_types WHERE key = ?', [data.key]) as any;
    if (row) {
      enqueueSyncRecord('activity_types', row.id, 'create');
    }
  }

  /**
   * Delete a custom activity type (cannot delete built-ins)
   */
  static async delete(key: string): Promise<void> {
    const db = getDb();
    const row = db.getFirstSync('SELECT id, is_built_in FROM activity_types WHERE key = ?', [key]) as any;
    if (!row) throw new Error(`Activity type not found: ${key}`);
    if (row.is_built_in === 1) throw new Error('Cannot delete built-in activity types');

    db.runSync('DELETE FROM activity_types WHERE id = ?', [row.id]);
    enqueueSyncRecord('activity_types', row.id, 'delete');
  }

  private static rowToModel(row: any): ActivityTypeModel {
    return {
      key: row.key,
      label: row.label,
      icon: row.icon,
      defaultLifeCategories: parseJson(row.default_life_categories),
      subCategories: parseJson(row.sub_categories),
      defaultMets: row.default_mets,
      isStrength: row.is_strength === 1,
      isNature: row.is_nature === 1,
      defaultIntensity: row.default_intensity,
      defaultOutdoors: row.default_outdoors === 1,
      showInTimer: row.show_in_timer === 1,
      showInManualLog: row.show_in_manual_log === 1,
      sortOrder: row.sort_order,
      isBuiltIn: row.is_built_in === 1,
    };
  }
}
