/**
 * activityPresetService.ts -- User-defined activity presets.
 *
 * Presets store activity templates with pre-set life design weights.
 * Example: "making mittens" -> { work: 0.8, love: 0.4, play: 0.6 }
 *
 * Used for quick activity updates via voice ("I'm working on mittens")
 * or pendant button press.
 */

import { getDb } from '../database';

// --- Types ---

export interface ActivityPreset {
  id: number;
  name: string;
  activityType: string | null;
  lifeCategories: Record<string, number>;
  icon: string;
  createdAt: string;
}

// --- Public API ---

/** Get all presets ordered by most recently created */
export function getAllPresets(): ActivityPreset[] {
  try {
    const db = getDb();
    const rows = db.getAllSync(
      'SELECT * FROM activity_presets ORDER BY created_at DESC',
    ) as any[];
    return rows.map(rowToPreset);
  } catch {
    return [];
  }
}

/** Get a preset by exact name (case-insensitive) */
export function getPresetByName(name: string): ActivityPreset | null {
  try {
    const db = getDb();
    const row = db.getFirstSync(
      'SELECT * FROM activity_presets WHERE LOWER(name) = LOWER(?)',
      [name],
    ) as any;
    return row ? rowToPreset(row) : null;
  } catch {
    return null;
  }
}

/** Fuzzy-match a preset name from user input */
export function matchPreset(input: string): ActivityPreset | null {
  const presets = getAllPresets();
  if (presets.length === 0) return null;

  const normalized = input.toLowerCase().trim();

  // Exact match first
  const exact = presets.find(p => p.name.toLowerCase() === normalized);
  if (exact) return exact;

  // Substring match: "working on mittens" matches "making mittens"
  const words = normalized.split(/\s+/).filter(w => w.length > 2);
  let bestMatch: ActivityPreset | null = null;
  let bestScore = 0;

  for (const preset of presets) {
    const pName = preset.name.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (pName.includes(word)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = preset;
    }
  }

  // Require at least 1 word match
  return bestScore >= 1 ? bestMatch : null;
}

/** Create a new preset */
export function createPreset(opts: {
  name: string;
  activityType?: string;
  lifeCategories: Record<string, number>;
  icon?: string;
}): ActivityPreset | null {
  try {
    const db = getDb();
    const result = db.runSync(
      `INSERT INTO activity_presets (name, activity_type, life_categories, icon)
       VALUES (?, ?, ?, ?)`,
      [
        opts.name,
        opts.activityType || null,
        JSON.stringify(opts.lifeCategories),
        opts.icon || 'circle',
      ],
    );
    const id = result?.lastInsertRowId;
    if (!id) return null;

    console.log(`[Presets] Created "${opts.name}" (#${id})`);
    return getPresetById(id);
  } catch (err: any) {
    console.warn('[Presets] Create failed:', err?.message);
    return null;
  }
}

/** Delete a preset by ID */
export function deletePreset(id: number): boolean {
  try {
    const db = getDb();
    db.runSync('DELETE FROM activity_presets WHERE id = ?', [id]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply a preset to an existing activity log.
 * Updates title, activity_type, and life_categories.
 * Emits TTS readout.
 */
export function applyPresetToLog(
  logId: number,
  preset: ActivityPreset,
): boolean {
  try {
    const db = getDb();
    db.runSync(
      `UPDATE activity_logs SET
        log_name = ?, activity_type = ?,
        life_categories = ?, updated_at = datetime('now')
      WHERE id = ?`,
      [
        preset.name,
        preset.activityType || 'custom',
        JSON.stringify(preset.lifeCategories),
        logId,
      ],
    );

    // TTS readout
    try {
      const { speak } = require('./voice/ttsService');
      speak('Updated activity title!');
    } catch { /* TTS not available */ }

    console.log(`[Presets] Applied "${preset.name}" to log #${logId}`);
    return true;
  } catch (err: any) {
    console.warn('[Presets] Apply failed:', err?.message);
    return false;
  }
}

// --- Helpers ---

function getPresetById(id: number): ActivityPreset | null {
  try {
    const db = getDb();
    const row = db.getFirstSync(
      'SELECT * FROM activity_presets WHERE id = ?',
      [id],
    ) as any;
    return row ? rowToPreset(row) : null;
  } catch {
    return null;
  }
}

function rowToPreset(row: any): ActivityPreset {
  return {
    id: row.id,
    name: row.name,
    activityType: row.activity_type,
    lifeCategories: row.life_categories
      ? JSON.parse(row.life_categories)
      : { work: 1.0 },
    icon: row.icon || 'circle',
    createdAt: row.created_at,
  };
}
