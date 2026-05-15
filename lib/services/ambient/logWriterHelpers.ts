/**
 * ambient/logWriterHelpers.ts -- Shared helpers for the log writer.
 *
 * Contains meal type guesser, nutrient aggregator,
 * and food item dedup/merge logic.
 */

// --- Meal Helpers ---

export function guessMealType(ts: number): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const hour = new Date(ts).getHours();
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 21) return 'dinner';
  return 'snack';
}

export function aggregateNutrients(results: any[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const r of results) {
    if (!r?.nutrients) continue;
    for (const [key, val] of Object.entries(r.nutrients)) {
      if (typeof val === 'number') {
        totals[key] = (totals[key] || 0) + val;
      }
    }
  }
  return totals;
}

/** Merge new food items into existing list by name (case-insensitive dedup) */
export function mergeItems(existing: any[], incoming: any[]): any[] {
  const map = new Map<string, any>();
  for (const item of existing) {
    map.set((item.name || item.n || '').toLowerCase(), item);
  }
  for (const item of incoming) {
    const key = (item.name || item.n || '').toLowerCase();
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}
