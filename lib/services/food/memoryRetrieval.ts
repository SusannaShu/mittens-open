/**
 * Scoped Memory Retrieval
 *
 * Instead of dumping ALL memory notes into every prompt,
 * fuzzy-match notes against the current context keywords.
 * Used by both local Gemma and cloud API pipelines.
 */

export interface MemoryContext {
  foodNames?: string[];
  mealType?: string;
  activityTypes?: string[];
  currentTime?: string; // "morning" | "afternoon" | "evening" | "night"
}

/** Semantic expansions for keyword matching */
const EXPANSIONS: Record<string, string[]> = {
  breakfast: ['morning', 'cereal', 'oats', 'eggs'],
  lunch: ['midday', 'sandwich', 'salad'],
  dinner: ['evening', 'night', 'supper'],
  snack: ['afternoon', 'treat'],
  work: ['coding', 'desk', 'laptop', 'screen', 'meeting', 'office'],
  run: ['running', 'jog', 'jogging', 'cardio'],
  walk: ['walking', 'stroll', 'hike'],
  workout: ['gym', 'exercise', 'lift', 'weights', 'strength'],
  sun: ['uvb', 'vitamin_d', 'outdoor', 'sunlight', 'tanning'],
  social: ['friends', 'family', 'call', 'hangout', 'party'],
};

/** Strip plurals and common suffixes for fuzzy matching */
function normalize(word: string): string {
  let w = word.toLowerCase().trim();
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'; // blueberries → blueberry
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && w.length > 3) return w.slice(0, -1);
  return w;
}

/**
 * Build a flat keyword set from the current context,
 * including semantic expansions.
 */
function buildKeywords(context: MemoryContext): Set<string> {
  const raw: string[] = [];
  if (context.foodNames) raw.push(...context.foodNames);
  if (context.mealType) raw.push(context.mealType);
  if (context.activityTypes) raw.push(...context.activityTypes);
  if (context.currentTime) raw.push(context.currentTime);

  const expanded: string[] = [];
  for (const r of raw) {
    const lower = r.toLowerCase();
    expanded.push(lower);
    expanded.push(normalize(lower));
    const exps = EXPANSIONS[lower];
    if (exps) expanded.push(...exps);
  }

  return new Set(expanded.filter(Boolean));
}

/**
 * Return only memory notes that keyword-match the current context.
 * NO blanket category inclusions -- every note from every category
 * must match at least one keyword.
 */
export function getRelevantMemory(
  memory: Record<string, string[]> | null | undefined,
  context: MemoryContext
): string[] {
  if (!memory || typeof memory !== 'object') return [];

  const keywords = buildKeywords(context);
  if (keywords.size === 0) return [];

  const relevant: string[] = [];
  const categories = ['health', 'preferences', 'routines', 'activities', 'energy'];

  for (const cat of categories) {
    const notes = memory[cat];
    if (!Array.isArray(notes)) continue;

    for (const note of notes) {
      const lower = note.toLowerCase();
      // Check if any keyword appears as substring in the note
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          relevant.push(note);
          break; // one match is enough
        }
      }
    }
  }

  return relevant;
}

/**
 * Format relevant memory notes into a prompt-ready string.
 * Returns empty string if nothing matches.
 */
export function formatScopedMemory(
  memory: Record<string, string[]> | null | undefined,
  context: MemoryContext
): string {
  const notes = getRelevantMemory(memory, context);
  if (notes.length === 0) return '';
  return notes.join('\n');
}

/**
 * Get time-of-day label from hour (0-23).
 */
export function getTimeOfDay(hour: number): string {
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}
