/**
 * USDA Nutrient Retention Factors, Release 6 (2007)
 *
 * Lab-measured percentage of nutrients retained after cooking.
 * Source: https://www.ars.usda.gov/ARSUserFiles/80400535/Data/retn/retn06.txt
 *
 * Organized by food category + cooking method -> nutrient retention %.
 * When a cooking method isn't in the table, AI interpolates from closest match.
 */

// ──────────── Types ────────────

export interface RetentionEntry {
  /** Retention percentage (0-100). 100 = no loss. */
  [nutrient: string]: number;
}

export interface RetentionRecord {
  food: string;
  cooking: string;
  retention: RetentionEntry;
}

// ──────────── Nutrient ID Mapping ────────────
// USDA uses numeric IDs; we map to our keys

const USDA_ID_TO_KEY: Record<string, string> = {
  '301': 'calcium', '303': 'iron', '304': 'magnesium',
  '306': 'potassium', '309': 'zinc',
  '401': 'vitamin_c', '404': 'vitamin_b1', '405': 'vitamin_b2',
  '406': 'vitamin_b3', '415': 'vitamin_b6', '417': 'folate',
  '418': 'vitamin_b12', '318': 'vitamin_a',
  // Mapped to our tracked set:
};

// ──────────── Retention Data ────────────
// Key: "FOOD_CATEGORY|COOKING_METHOD" (lowercase)
// Values: nutrient key -> retention % (0-100)

const RETENTION_TABLE: Record<string, RetentionEntry> = {
  // ── Eggs ──
  'eggs|baked': {
    calcium: 100, iron: 100, magnesium: 100, potassium: 100, zinc: 100,
    vitamin_c: 80, vitamin_b6: 95, folate: 75, vitamin_b12: 80, vitamin_a: 100,
  },
  'eggs|fried': {
    calcium: 100, iron: 100, magnesium: 100, potassium: 100, zinc: 100,
    vitamin_c: 80, vitamin_b6: 95, folate: 75, vitamin_b12: 85, vitamin_a: 100,
  },
  'eggs|scrambled': {
    calcium: 100, iron: 100, magnesium: 100, potassium: 100, zinc: 100,
    vitamin_c: 80, vitamin_b6: 95, folate: 75, vitamin_b12: 85, vitamin_a: 100,
  },
  'eggs|hard cooked': {
    calcium: 100, iron: 100, magnesium: 100, potassium: 100, zinc: 100,
    vitamin_c: 80, vitamin_b6: 95, folate: 75, vitamin_b12: 85, vitamin_a: 100,
  },
  'eggs|poached': {
    calcium: 100, iron: 100, magnesium: 100, potassium: 100, zinc: 100,
    vitamin_c: 80, vitamin_b6: 85, folate: 75, vitamin_b12: 80, vitamin_a: 100,
  },
  'eggs|reheated': {
    calcium: 100, iron: 100, magnesium: 100, potassium: 100, zinc: 100,
    vitamin_c: 95, vitamin_b6: 95, folate: 95, vitamin_b12: 95, vitamin_a: 100,
  },

  // ── Chicken ──
  'chicken|broiled': {
    calcium: 95, iron: 90, magnesium: 75, potassium: 80, zinc: 100,
    vitamin_c: 80, vitamin_b6: 80, folate: 60, vitamin_b12: 65, vitamin_a: 75,
  },
  'chicken|fried': {
    calcium: 95, iron: 90, magnesium: 75, potassium: 80, zinc: 100,
    vitamin_c: 80, vitamin_b6: 80, folate: 60, vitamin_b12: 65, vitamin_a: 75,
  },
  'chicken|roasted': {
    calcium: 95, iron: 90, magnesium: 75, potassium: 80, zinc: 100,
    vitamin_c: 80, vitamin_b6: 80, folate: 60, vitamin_b12: 65, vitamin_a: 75,
  },
  'chicken|simmered': {
    calcium: 80, iron: 90, magnesium: 65, potassium: 60, zinc: 100,
    vitamin_c: 80, vitamin_b6: 50, folate: 60, vitamin_b12: 50, vitamin_a: 75,
  },
  'chicken|reheated': {
    calcium: 100, iron: 100, magnesium: 100, potassium: 100, zinc: 100,
    vitamin_c: 95, vitamin_b6: 95, folate: 95, vitamin_b12: 95, vitamin_a: 100,
  },

  // ── Turkey ──
  'turkey|roasted': {
    calcium: 100, iron: 95, magnesium: 80, potassium: 75, zinc: 100,
    vitamin_c: 80, vitamin_b6: 70, folate: 60, vitamin_b12: 65, vitamin_a: 75,
  },

  // ── Beef ──
  'beef|broiled': {
    calcium: 100, iron: 100, magnesium: 85, potassium: 85, zinc: 100,
    vitamin_c: 80, vitamin_b6: 75, folate: 65, vitamin_b12: 70, vitamin_a: 80,
  },
  'beef|fried': {
    calcium: 100, iron: 100, magnesium: 85, potassium: 85, zinc: 100,
    vitamin_c: 80, vitamin_b6: 75, folate: 65, vitamin_b12: 70, vitamin_a: 80,
  },
  'beef|roasted': {
    calcium: 100, iron: 100, magnesium: 85, potassium: 85, zinc: 100,
    vitamin_c: 80, vitamin_b6: 75, folate: 65, vitamin_b12: 70, vitamin_a: 80,
  },
  'beef|simmered': {
    calcium: 85, iron: 100, magnesium: 70, potassium: 65, zinc: 100,
    vitamin_c: 80, vitamin_b6: 55, folate: 65, vitamin_b12: 55, vitamin_a: 80,
  },

  // ── Fish ──
  'fish|baked': {
    calcium: 100, iron: 100, magnesium: 100, potassium: 95, zinc: 100,
    vitamin_c: 80, vitamin_b6: 90, folate: 75, vitamin_b12: 80, vitamin_a: 90,
  },
  'fish|broiled': {
    calcium: 100, iron: 100, magnesium: 90, potassium: 85, zinc: 100,
    vitamin_c: 80, vitamin_b6: 80, folate: 70, vitamin_b12: 70, vitamin_a: 85,
  },
  'fish|fried': {
    calcium: 100, iron: 100, magnesium: 90, potassium: 85, zinc: 100,
    vitamin_c: 80, vitamin_b6: 80, folate: 70, vitamin_b12: 70, vitamin_a: 85,
  },
  'fish|poached': {
    calcium: 85, iron: 100, magnesium: 75, potassium: 70, zinc: 100,
    vitamin_c: 80, vitamin_b6: 70, folate: 60, vitamin_b12: 65, vitamin_a: 85,
  },
  'fish|steamed': {
    calcium: 100, iron: 100, magnesium: 95, potassium: 90, zinc: 100,
    vitamin_c: 85, vitamin_b6: 85, folate: 75, vitamin_b12: 75, vitamin_a: 90,
  },

  // ── Vegetables (general) ──
  'vegetables|boiled': {
    calcium: 80, iron: 90, magnesium: 75, potassium: 70, zinc: 90,
    vitamin_c: 50, vitamin_b6: 70, folate: 50, vitamin_b12: 100, vitamin_a: 85,
  },
  'vegetables|steamed': {
    calcium: 95, iron: 95, magnesium: 90, potassium: 90, zinc: 95,
    vitamin_c: 75, vitamin_b6: 85, folate: 70, vitamin_b12: 100, vitamin_a: 90,
  },
  'vegetables|baked': {
    calcium: 95, iron: 100, magnesium: 95, potassium: 90, zinc: 100,
    vitamin_c: 75, vitamin_b6: 85, folate: 65, vitamin_b12: 100, vitamin_a: 90,
  },
  'vegetables|fried': {
    calcium: 95, iron: 90, magnesium: 85, potassium: 80, zinc: 90,
    vitamin_c: 65, vitamin_b6: 80, folate: 60, vitamin_b12: 100, vitamin_a: 85,
  },
  'vegetables|raw': {
    calcium: 100, iron: 100, magnesium: 100, potassium: 100, zinc: 100,
    vitamin_c: 100, vitamin_b6: 100, folate: 100, vitamin_b12: 100, vitamin_a: 100,
  },
  'vegetables|microwaved': {
    calcium: 100, iron: 100, magnesium: 95, potassium: 95, zinc: 100,
    vitamin_c: 80, vitamin_b6: 90, folate: 75, vitamin_b12: 100, vitamin_a: 95,
  },

  // ── Legumes ──
  'legumes|boiled': {
    calcium: 90, iron: 90, magnesium: 85, potassium: 80, zinc: 90,
    vitamin_c: 60, vitamin_b6: 75, folate: 55, vitamin_b12: 100, vitamin_a: 90,
  },
  'legumes|canned': {
    calcium: 85, iron: 85, magnesium: 80, potassium: 75, zinc: 85,
    vitamin_c: 50, vitamin_b6: 70, folate: 50, vitamin_b12: 100, vitamin_a: 85,
  },

  // ── Grains / Cereals ──
  'grains|boiled': {
    calcium: 100, iron: 95, magnesium: 100, potassium: 95, zinc: 100,
    vitamin_c: 80, vitamin_b6: 90, folate: 70, vitamin_b12: 100, vitamin_a: 90,
  },
  'grains|baked': {
    calcium: 100, iron: 100, magnesium: 100, potassium: 100, zinc: 100,
    vitamin_c: 70, vitamin_b6: 85, folate: 65, vitamin_b12: 100, vitamin_a: 85,
  },

  // ── Fruits ──
  'fruits|raw': {
    calcium: 100, iron: 100, magnesium: 100, potassium: 100, zinc: 100,
    vitamin_c: 100, vitamin_b6: 100, folate: 100, vitamin_b12: 100, vitamin_a: 100,
  },
  'fruits|baked': {
    calcium: 95, iron: 100, magnesium: 100, potassium: 95, zinc: 100,
    vitamin_c: 75, vitamin_b6: 85, folate: 70, vitamin_b12: 100, vitamin_a: 90,
  },
  'fruits|boiled': {
    calcium: 85, iron: 95, magnesium: 85, potassium: 80, zinc: 95,
    vitamin_c: 55, vitamin_b6: 75, folate: 55, vitamin_b12: 100, vitamin_a: 85,
  },

  // ── Milk / Dairy ──
  'dairy|heated': {
    calcium: 100, iron: 100, magnesium: 100, potassium: 100, zinc: 100,
    vitamin_c: 85, vitamin_b6: 90, folate: 85, vitamin_b12: 80, vitamin_a: 100,
  },
  'dairy|baked': {
    calcium: 100, iron: 100, magnesium: 100, potassium: 100, zinc: 100,
    vitamin_c: 65, vitamin_b6: 75, folate: 80, vitamin_b12: 55, vitamin_a: 100,
  },

  // ── Cheese ──
  'cheese|baked': {
    calcium: 100, iron: 100, magnesium: 100, potassium: 100, zinc: 100,
    vitamin_c: 65, vitamin_b6: 75, folate: 80, vitamin_b12: 55, vitamin_a: 100,
  },

  // ── Pork ──
  'pork|roasted': {
    calcium: 100, iron: 100, magnesium: 80, potassium: 80, zinc: 100,
    vitamin_c: 80, vitamin_b6: 70, folate: 55, vitamin_b12: 60, vitamin_a: 80,
  },
  'pork|fried': {
    calcium: 100, iron: 100, magnesium: 80, potassium: 80, zinc: 100,
    vitamin_c: 80, vitamin_b6: 70, folate: 55, vitamin_b12: 60, vitamin_a: 80,
  },
  'pork|simmered': {
    calcium: 80, iron: 100, magnesium: 65, potassium: 60, zinc: 100,
    vitamin_c: 80, vitamin_b6: 50, folate: 55, vitamin_b12: 45, vitamin_a: 80,
  },
};

// ──────────── Food Category Mapping ────────────

const FOOD_CATEGORY_KEYWORDS: Record<string, string[]> = {
  eggs: ['egg', 'eggs', 'omelette', 'omelet', 'frittata'],
  chicken: ['chicken', 'poultry'],
  turkey: ['turkey'],
  beef: ['beef', 'steak', 'ground beef', 'hamburger', 'brisket'],
  pork: ['pork', 'ham', 'bacon', 'sausage'],
  fish: ['fish', 'salmon', 'tuna', 'cod', 'tilapia', 'shrimp', 'seafood', 'trout'],
  vegetables: [
    'broccoli', 'spinach', 'kale', 'carrot', 'potato', 'sweet potato',
    'tomato', 'pepper', 'onion', 'garlic', 'cabbage', 'cauliflower',
    'zucchini', 'asparagus', 'green bean', 'pea', 'corn', 'mushroom',
    'lettuce', 'celery', 'cucumber', 'eggplant', 'squash', 'beet',
  ],
  legumes: ['lentil', 'bean', 'chickpea', 'hummus', 'tofu', 'tempeh', 'soy'],
  grains: [
    'rice', 'quinoa', 'oat', 'oatmeal', 'pasta', 'noodle', 'bread',
    'wheat', 'barley', 'cereal', 'couscous', 'bulgur',
  ],
  fruits: [
    'apple', 'banana', 'berry', 'strawberry', 'blueberry', 'raspberry',
    'orange', 'grape', 'mango', 'pineapple', 'watermelon', 'peach',
    'pear', 'cherry', 'plum', 'kiwi', 'avocado', 'lemon', 'lime',
  ],
  dairy: ['milk', 'yogurt', 'kefir', 'cream'],
  cheese: ['cheese', 'mozzarella', 'cheddar', 'parmesan', 'feta', 'brie'],
};

// ──────────── Cooking Method Normalization & Severity ────────────

/** Cooking method severity scale: 0 = raw (no loss), 100 = most destructive */
const COOKING_METHOD_SEVERITY: Record<string, number> = {
  raw: 0,
  steamed: 15,
  microwaved: 20,
  poached: 25,
  boiled: 35,
  simmered: 40,
  baked: 45,
  roasted: 50,
  'hard cooked': 50,
  scrambled: 50,
  heated: 30,
  broiled: 60,
  fried: 70,
  'deep fried': 85,
  canned: 40,
  reheated: 10,
};

/** Map common cooking terms to normalized method + severity */
const COOKING_ALIASES: Record<string, { method: string; severity: number }> = {
  raw: { method: 'raw', severity: 0 },
  fresh: { method: 'raw', severity: 0 },
  uncooked: { method: 'raw', severity: 0 },
  // Light cooking
  steam: { method: 'steamed', severity: 15 },
  steamed: { method: 'steamed', severity: 15 },
  blanch: { method: 'steamed', severity: 10 },
  blanched: { method: 'steamed', severity: 10 },
  microwave: { method: 'microwaved', severity: 20 },
  microwaved: { method: 'microwaved', severity: 20 },
  // Wet heat
  poach: { method: 'poached', severity: 25 },
  poached: { method: 'poached', severity: 25 },
  boil: { method: 'boiled', severity: 35 },
  boiled: { method: 'boiled', severity: 35 },
  simmer: { method: 'simmered', severity: 40 },
  simmered: { method: 'simmered', severity: 40 },
  stew: { method: 'simmered', severity: 45 },
  stewed: { method: 'simmered', severity: 45 },
  braised: { method: 'simmered', severity: 45 },
  braise: { method: 'simmered', severity: 45 },
  // Dry heat
  bake: { method: 'baked', severity: 45 },
  baked: { method: 'baked', severity: 45 },
  roast: { method: 'roasted', severity: 50 },
  roasted: { method: 'roasted', severity: 50 },
  grill: { method: 'broiled', severity: 60 },
  grilled: { method: 'broiled', severity: 60 },
  broil: { method: 'broiled', severity: 60 },
  broiled: { method: 'broiled', severity: 60 },
  // High heat
  sauté: { method: 'fried', severity: 55 },
  saute: { method: 'fried', severity: 55 },
  'stir fry': { method: 'fried', severity: 60 },
  'stir-fried': { method: 'fried', severity: 60 },
  'stir fried': { method: 'fried', severity: 60 },
  'pan-fried': { method: 'fried', severity: 65 },
  'pan fried': { method: 'fried', severity: 65 },
  fry: { method: 'fried', severity: 70 },
  fried: { method: 'fried', severity: 70 },
  'deep fry': { method: 'fried', severity: 85 },
  'deep fried': { method: 'fried', severity: 85 },
  'deep-fried': { method: 'fried', severity: 85 },
  // Misc
  scramble: { method: 'scrambled', severity: 50 },
  scrambled: { method: 'scrambled', severity: 50 },
  'hard boiled': { method: 'hard cooked', severity: 50 },
  'hard-boiled': { method: 'hard cooked', severity: 50 },
  'soft boiled': { method: 'poached', severity: 30 },
  'soft-boiled': { method: 'poached', severity: 30 },
  reheat: { method: 'reheated', severity: 10 },
  reheated: { method: 'reheated', severity: 10 },
  leftover: { method: 'reheated', severity: 10 },
  canned: { method: 'canned', severity: 40 },
  fermented: { method: 'raw', severity: 5 },
  heated: { method: 'heated', severity: 30 },
  cooked: { method: 'baked', severity: 45 }, // generic "cooked" = medium
  cooking: { method: 'baked', severity: 45 },
  seasoning: { method: 'raw', severity: 5 }, // seasoning = minimal cooking
};

// ──────────── Lookup Functions ────────────

/** Detect food category from food name */
export function detectCategory(foodName: string): string | null {
  const lower = foodName.toLowerCase();
  for (const [category, keywords] of Object.entries(FOOD_CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return category;
  }
  return null;
}

/** Normalize cooking method and return severity */
export function normalizeCooking(cooking: string): { method: string; severity: number } {
  const lower = cooking.toLowerCase().trim();
  // Check direct aliases
  for (const [alias, info] of Object.entries(COOKING_ALIASES)) {
    if (lower.includes(alias)) return info;
  }
  // Unknown method: assign medium severity
  return { method: lower, severity: 45 };
}

export interface RetentionResult {
  /** Per-nutrient retention factors (0-1 scale) */
  factors: Record<string, number>;
  /** Which USDA entry was matched */
  matchedEntry: string | null;
  /** True if this is an exact USDA match, false if interpolated */
  isExact: boolean;
  /** Cooking severity (0-100) used for calculation */
  severity: number;
  /** Cooking method description */
  method: string;
}

/**
 * Look up USDA retention factors for a food + cooking method.
 *
 * Returns exact match if available. If not, interpolates between
 * the two closest cooking methods by severity score.
 *
 * Severity scale: 0 (raw) to 100 (deep fried)
 */
export function lookupRetention(foodName: string, cooking: string): RetentionResult | null {
  const category = detectCategory(foodName);
  const { method, severity } = normalizeCooking(cooking);

  if (!category) return null;

  // Try exact match
  const exactKey = `${category}|${method}`;
  if (RETENTION_TABLE[exactKey]) {
    return {
      factors: toDecimal(RETENTION_TABLE[exactKey]),
      matchedEntry: exactKey,
      isExact: true,
      severity,
      method,
    };
  }

  // Collect all entries for this category with their severity scores
  const categoryEntries = Object.entries(RETENTION_TABLE)
    .filter(([k]) => k.startsWith(`${category}|`))
    .map(([key, entry]) => {
      const entryMethod = key.split('|')[1];
      const entrySeverity = COOKING_METHOD_SEVERITY[entryMethod] ?? 45;
      return { key, entry, method: entryMethod, severity: entrySeverity };
    })
    .sort((a, b) => a.severity - b.severity);

  if (categoryEntries.length === 0) return null;

  // Find two closest entries by severity and interpolate
  const below = categoryEntries.filter(e => e.severity <= severity);
  const above = categoryEntries.filter(e => e.severity > severity);
  const lower = below.length > 0 ? below[below.length - 1] : null;
  const upper = above.length > 0 ? above[0] : null;

  let factors: Record<string, number>;
  let matchedEntry: string;

  if (lower && upper) {
    // Interpolate between the two closest methods
    const range = upper.severity - lower.severity;
    const t = range > 0 ? (severity - lower.severity) / range : 0.5;
    const lowerFactors = toDecimal(lower.entry);
    const upperFactors = toDecimal(upper.entry);
    factors = {};
    const allKeys = new Set([...Object.keys(lowerFactors), ...Object.keys(upperFactors)]);
    for (const k of allKeys) {
      const l = lowerFactors[k] ?? 1;
      const u = upperFactors[k] ?? 1;
      factors[k] = Math.round((l + (u - l) * t) * 1000) / 1000;
    }
    matchedEntry = `${lower.key} ↔ ${upper.key} (${Math.round(t * 100)}%)`;
  } else if (lower) {
    factors = toDecimal(lower.entry);
    matchedEntry = lower.key;
  } else if (upper) {
    factors = toDecimal(upper.entry);
    matchedEntry = upper.key;
  } else {
    return null;
  }

  return {
    factors,
    matchedEntry,
    isExact: false,
    severity,
    method,
  };
}

/** Convert percentage (0-100) to decimal (0-1) */
function toDecimal(entry: RetentionEntry): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(entry)) {
    result[k] = v / 100;
  }
  return result;
}

/**
 * Apply retention factors to a nutrient map.
 * Only affects nutrients that have a retention factor.
 */
export function applyRetention(
  nutrients: Record<string, number>,
  factors: Record<string, number>,
): { adjusted: Record<string, number>; changes: Array<{ nutrient: string; before: number; after: number; factor: number }> } {
  const adjusted = { ...nutrients };
  const changes: Array<{ nutrient: string; before: number; after: number; factor: number }> = [];

  for (const [nutrient, factor] of Object.entries(factors)) {
    if (nutrient in adjusted && factor < 1 && adjusted[nutrient] > 0) {
      const before = adjusted[nutrient];
      adjusted[nutrient] = Math.round(before * factor * 100) / 100;
      changes.push({ nutrient, before, after: adjusted[nutrient], factor });
    }
  }

  return { adjusted, changes };
}
