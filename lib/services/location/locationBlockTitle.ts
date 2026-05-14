/**
 * locationBlockTitle.ts -- Generate smart titles for location blocks.
 *
 * Derives human-readable titles from dominant activities within a location session.
 * Examples:
 *   - "Social and work at D12"
 *   - "Work and cook at Home"
 *   - "Walk and bike commute"
 *   - "Work at D12" (single dominant activity)
 */

import type { LocationSession } from './locationSessionApi';

export interface ChildActivity {
  id?: number;
  activity_type: string;
  duration_min: number;
  life_categories?: Record<string, number> | null;
  logged_at?: string;
}

/** Human-friendly labels for activity types */
const ACTIVITY_LABELS: Record<string, string> = {
  work: 'work',
  social: 'social',
  rest: 'rest',
  exercise: 'exercise',
  cooking: 'cook',
  cooking_at_home: 'cook',
  meal_prep: 'cook',
  eating: 'eat',
  eating_at_home: 'eat',
  eating_out: 'eat out',
  errands: 'errands',
  commute: 'commute',
  reading: 'reading',
  scrolling: 'scrolling',
  meditation: 'meditation',
  journal: 'journal',
  drawing: 'drawing',
  walk: 'walk',
  run: 'run',
  bike: 'bike',
  workout: 'workout',
  sun: 'sun',
  nature: 'nature',
  grocery_shopping: 'grocery shopping',
};

/** Motion type labels for trail-based titles */
const MOTION_LABELS: Record<string, string> = {
  walking: 'walk',
  running: 'run',
  cycling: 'bike',
  driving: 'drive',
};

/**
 * Generate a smart title for a location block.
 *
 * For stationary sessions: "{act1} and {act2} at {place}"
 * For trail sessions: "{motion1} and {motion2} commute"
 */
export function generateLocationBlockTitle(
  session: LocationSession,
  childActivities: ChildActivity[],
): string {
  const placeName = session.placeName || 'Unknown';

  // Trail-based: use motion types
  if (session.motionType !== 'stationary') {
    return generateTrailTitle(session);
  }

  // Stationary: use dominant activities
  if (childActivities.length === 0) {
    return `At ${placeName}`;
  }

  // Group by activity_type, sum durations
  const grouped = new Map<string, number>();
  for (const act of childActivities) {
    const key = act.activity_type || 'other';
    grouped.set(key, (grouped.get(key) || 0) + (act.duration_min || 0));
  }

  // Sort by duration descending
  const sorted = [...grouped.entries()].sort((a, b) => b[1] - a[1]);

  // Take top 2
  const labels = sorted
    .slice(0, 2)
    .map(([type]) => ACTIVITY_LABELS[type] || type);

  if (labels.length === 0) {
    return `At ${placeName}`;
  }

  const titlePart = labels.length === 2
    ? `${capitalize(labels[0])} and ${labels[1]}`
    : capitalize(labels[0]);

  return `${titlePart} at ${placeName}`;
}

/**
 * Generate a trail title from motion types.
 * e.g. "Walk and bike commute"
 */
function generateTrailTitle(session: LocationSession): string {
  const motionLabel = MOTION_LABELS[session.motionType] || session.motionType;

  // If we have a destination place, include it
  if (session.placeName) {
    return `${capitalize(motionLabel)} to ${session.placeName}`;
  }

  return `${capitalize(motionLabel)} commute`;
}

/**
 * Query child activities for a location session from the database.
 * Returns activity types and durations for title generation and life design.
 */
export function getChildActivitiesForSession(
  session: LocationSession,
): ChildActivity[] {
  try {
    const { getDb } = require('../../database');
    const db = getDb();

    const startIso = new Date(session.startedAt).toISOString();
    const endIso = session.endedAt
      ? new Date(session.endedAt).toISOString()
      : new Date().toISOString();

    const rows = db.getAllSync(
      `SELECT id, activity_type, duration_min, life_categories, logged_at
       FROM activity_logs
       WHERE source IN ('pendant', 'trail')
         AND logged_at >= ? AND logged_at <= ?
       ORDER BY logged_at ASC`,
      [startIso, endIso],
    ) as any[];

    return rows.map(r => ({
      id: r.id,
      activity_type: r.activity_type,
      duration_min: r.duration_min,
      life_categories: r.life_categories ? JSON.parse(r.life_categories) : null,
      logged_at: r.logged_at,
    }));
  } catch {
    return [];
  }
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
