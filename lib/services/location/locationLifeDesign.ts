import { type ChildActivity } from './locationBlockTitle';

/** Activity type -> default Life Design category weights (from activityTypeService) */
const ACTIVITY_LIFE_DESIGN: Record<string, Record<string, number>> = {
  walk:       { health: 0.7, play: 0.3 },
  run:        { health: 0.9, play: 0.1 },
  bike:       { health: 0.8, play: 0.2 },
  workout:    { health: 0.9, play: 0.1 },
  sun:        { health: 1.0 },
  work:       { work: 1.0 },
  social:     { love: 0.6, play: 0.4 },
  rest:       { health: 0.7, play: 0.3 },
  cooking:    { health: 0.8, play: 0.2 },
  cooking_at_home: { health: 0.8, play: 0.2 },
  meal_prep:  { health: 0.8, play: 0.2 },
  eating:     { health: 0.5, play: 0.5 },
  eating_at_home: { health: 0.5, play: 0.5 },
  eating_out: { love: 0.3, play: 0.4, health: 0.3 },
  commute:    { work: 1.0 },
  nature:     { health: 0.7, play: 0.3 },
  meditation: { health: 0.5, play: 0.5 },
  journal:    { health: 0.5, play: 0.5 },
  reading:    { play: 0.7, work: 0.3 },
  drawing:    { play: 1.0 },
  scrolling:  { play: 0.5 },
  exercise:   { health: 0.9, play: 0.1 },
  errands:    { work: 0.7, health: 0.3 },
  grocery_shopping: { health: 0.5, work: 0.5 },
  other:      { work: 1.0 },
};

/**
 * Calculate Life Design weights from child activity durations.
 *
 * Uses the *stored* life_categories per child (set by the per-capture
 * pipeline and correctable by the user) when available.
 * Falls back to defaults from ACTIVITY_LIFE_DESIGN when no stored values exist.
 * Returns proportional weights summing to ~1.0.
 */
export function calculateLocationLifeDesign(
  childActivities: ChildActivity[],
): Record<string, number> {
  if (childActivities.length === 0) {
    return { work: 0, health: 0, play: 0, love: 0 };
  }

  const totalMin = childActivities.reduce((sum, a) => sum + (a.duration_min || 0), 0);
  if (totalMin === 0) {
    return { work: 0, health: 0, play: 0, love: 0 };
  }

  const result: Record<string, number> = { work: 0, health: 0, play: 0, love: 0 };

  for (const act of childActivities) {
    const dur = act.duration_min || 0;
    if (dur === 0) continue;

    const proportion = dur / totalMin;

    // Prefer stored life_categories (user-correctable) over defaults
    const categoryWeights = act.life_categories
      || ACTIVITY_LIFE_DESIGN[act.activity_type]
      || ACTIVITY_LIFE_DESIGN.other;

    for (const [category, weight] of Object.entries(categoryWeights)) {
      result[category] = (result[category] || 0) + proportion * (weight as number);
    }
  }

  // Round to 2 decimal places
  for (const key of Object.keys(result)) {
    result[key] = Math.round(result[key] * 100) / 100;
  }

  return result;
}

/**
 * Generate an AEIOU Activity narrative summary from child activities.
 * e.g. "worked for 45min, socialized for 20min, rested for 15min"
 */
export function generateActivityNarrative(
  childActivities: ChildActivity[],
): string {
  if (childActivities.length === 0) return '';

  // Group by activity_type, sum durations
  const grouped = new Map<string, number>();
  for (const act of childActivities) {
    const key = act.activity_type || 'other';
    grouped.set(key, (grouped.get(key) || 0) + (act.duration_min || 0));
  }

  // Sort by duration descending
  const sorted = [...grouped.entries()].sort((a, b) => b[1] - a[1]);

  const PAST_TENSE: Record<string, string> = {
    work: 'worked', social: 'socialized', rest: 'rested',
    exercise: 'exercised', cooking: 'cooked', cooking_at_home: 'cooked',
    meal_prep: 'cooked', eating: 'ate', eating_at_home: 'ate',
    eating_out: 'ate out', commute: 'commuted', reading: 'read',
    scrolling: 'scrolled', meditation: 'meditated', journal: 'journaled',
    drawing: 'drew', walk: 'walked', run: 'ran', bike: 'biked',
    workout: 'worked out', sun: 'sunbathed', nature: 'touched grass',
    errands: 'ran errands', grocery_shopping: 'grocery shopped',
  };

  return sorted
    .filter(([, dur]) => dur > 0)
    .map(([type, dur]) => {
      const verb = PAST_TENSE[type] || type;
      return `${verb} for ${Math.round(dur)}min`;
    })
    .join(', ');
}

/**
 * Aggregate AEIOU fields from multiple child activity records.
 * Union-merges all values per AEIOU dimension.
 */
export function aggregateAEIOU(
  childAeious: Array<Record<string, string> | null>,
): Record<string, string> {
  const result: Record<string, Set<string>> = {
    activity: new Set(),
    environment: new Set(),
    interactions: new Set(),
    objects: new Set(),
    users: new Set(),
  };

  for (const aeiou of childAeious) {
    if (!aeiou) continue;
    for (const [key, value] of Object.entries(aeiou)) {
      const normalKey = key.toLowerCase();
      if (result[normalKey] && value) {
        // Split by comma and trim each item
        const items = value.split(',').map(s => s.trim()).filter(Boolean);
        items.forEach(item => result[normalKey].add(item));
      }
    }
  }

  const merged: Record<string, string> = {};
  for (const [key, valueSet] of Object.entries(result)) {
    if (valueSet.size > 0) {
      merged[key] = [...valueSet].join(', ');
    }
  }
  return merged;
}
