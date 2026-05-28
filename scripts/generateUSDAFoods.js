#!/usr/bin/env node
/**
 * Generate commonFoods.ts from USDA FoodData Central SR Legacy CSV.
 *
 * Key design decisions:
 *   - Only export nutrients that USDA actually measured (null = unknown, 0 = actually zero)
 *   - Average duplicate USDA entries for same food to get best aggregate values
 *   - Combine EPA+DHA+ALA into total omega3, only when at least one is measured
 *   - Vitamin D and K have ~65% coverage, so many foods legitimately show null
 *
 * Usage: node scripts/generateUSDAFoods.js
 *
 * Source: USDA FoodData Central SR Legacy (April 2018)
 * https://fdc.nal.usda.gov/download-datasets.html
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'usda_sr', 'FoodData_Central_sr_legacy_food_csv_2018-04');

// USDA nutrient IDs we want to extract
const NUTRIENT_IDS = {
  1008: 'calories',
  1003: 'protein',
  1005: 'carbs',
  1004: 'fat',
  1079: 'fiber',
  1051: 'water',
  1106: 'vitamin_a',
  1162: 'vitamin_c',
  1114: 'vitamin_d',
  1109: 'vitamin_e',
  1185: 'vitamin_k',
  1175: 'vitamin_b6',
  1178: 'vitamin_b12',
  1177: 'folate',
  1087: 'calcium',
  1089: 'iron',
  1090: 'magnesium',
  1092: 'potassium',
  1095: 'zinc',
  // Omega-3: we sum ALA + EPA + DHA
  1404: 'omega3_ala',
  1278: 'omega3_epa',
  1272: 'omega3_dha',
};

const CATEGORY_MAP = {
  '1':  { name: 'dairy', include: true },
  '2':  { name: 'spice', include: true },
  '3':  { name: 'other', include: false },      // Baby foods
  '4':  { name: 'fat', include: true },
  '5':  { name: 'poultry', include: true },
  '6':  { name: 'soup', include: true },
  '7':  { name: 'processed', include: false },   // Sausages (branded)
  '8':  { name: 'cereal', include: true },
  '9':  { name: 'fruit', include: true },
  '10': { name: 'pork', include: true },
  '11': { name: 'vegetable', include: true },
  '12': { name: 'nut', include: true },
  '13': { name: 'beef', include: true },
  '14': { name: 'beverage', include: true },
  '15': { name: 'seafood', include: true },
  '16': { name: 'legume', include: true },
  '17': { name: 'lamb', include: true },
  '18': { name: 'baked', include: true },
  '19': { name: 'sweet', include: true },
  '20': { name: 'grain', include: true },
  '21': { name: 'fast_food', include: false },
  '22': { name: 'combo', include: false },
  '25': { name: 'snack', include: true },
};

// ------- CSV Parser -------

function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    if (vals.length === headers.length) {
      const row = {};
      for (let j = 0; j < headers.length; j++) row[headers[j]] = vals[j];
      rows.push(row);
    }
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else if (ch !== '\r') current += ch;
  }
  result.push(current.trim());
  return result;
}

// ------- Name Processing -------

function simplifyName(description) {
  return description
    .replace(/\s*\(.*?\)\s*/g, ' ')  // Remove parenthetical info
    .replace(/\s+/g, ' ')
    .trim();
}

/** Generate a short common name for fuzzy matching */
function buildSearchAliases(fullName) {
  const lower = fullName.toLowerCase();
  const aliases = new Set([lower]);

  // Add just the first part before comma (e.g. "Spinach" from "Spinach, raw, baby")
  const firstPart = lower.split(',')[0].trim();
  if (firstPart.length > 2) aliases.add(firstPart);

  // Add without cooking method
  const withoutCooking = lower
    .replace(/,\s*(raw|cooked|boiled|baked|roasted|fried|steamed|grilled|dried|canned|frozen|fresh)\b/gi, '')
    .trim().replace(/,\s*$/, '');
  if (withoutCooking.length > 2 && withoutCooking !== lower) aliases.add(withoutCooking);

  return [...aliases];
}

// ------- Filtering -------

const PRIORITY_KEYWORDS = [
  // Fruits
  'apple', 'banana', 'blueberr', 'strawberr', 'raspberr', 'orange', 'mango', 'watermelon',
  'grape', 'pineapple', 'peach', 'pear', 'cherry', 'kiwi', 'lemon', 'lime', 'avocado',
  'cranberr', 'plum', 'fig', 'date', 'pomegranate', 'papaya', 'coconut', 'grapefruit',
  'blackberr', 'cantaloupe', 'honeydew', 'apricot', 'nectarine', 'tangerine',
  // Vegetables
  'spinach', 'broccoli', 'carrot', 'tomato', 'potato', 'sweet potato', 'kale', 'onion',
  'garlic', 'pepper', 'cucumber', 'mushroom', 'lettuce', 'cabbage', 'celery', 'corn',
  'zucchini', 'squash', 'asparagus', 'green bean', 'pea', 'beet', 'radish', 'turnip',
  'eggplant', 'cauliflower', 'artichoke', 'brussels sprout', 'arugula', 'chard', 'okra',
  'bok choy', 'collard', 'watercress', 'leek', 'ginger', 'turmeric',
  // Protein
  'chicken', 'salmon', 'tuna', 'beef', 'pork', 'shrimp', 'turkey', 'lamb', 'cod', 'tilapia',
  'sardine', 'mackerel', 'trout', 'crab', 'lobster', 'scallop', 'clam', 'mussel', 'oyster',
  'duck', 'bison', 'venison', 'tofu', 'tempeh',
  // Dairy
  'egg', 'milk', 'yogurt', 'cheese', 'butter', 'cream', 'cottage cheese', 'kefir',
  'mozzarella', 'parmesan', 'cheddar', 'ricotta', 'feta', 'goat cheese',
  // Grains
  'rice', 'oat', 'quinoa', 'bread', 'pasta', 'wheat', 'barley', 'buckwheat',
  'millet', 'rye', 'tortilla', 'noodle', 'spaghetti',
  // Nuts & Seeds
  'almond', 'walnut', 'cashew', 'pistachio', 'pecan', 'peanut', 'hazelnut', 'macadamia',
  'brazil nut', 'pine nut', 'sunflower seed', 'pumpkin seed', 'flaxseed', 'chia seed',
  'sesame seed', 'hemp seed',
  // Legumes
  'lentil', 'chickpea', 'black bean', 'kidney bean', 'navy bean', 'pinto bean', 'soybean',
  'edamame', 'hummus', 'lima bean', 'split pea', 'mung bean',
  // Fermented
  'kimchi', 'sauerkraut', 'miso', 'natto',
  // Oils
  'olive oil', 'coconut oil', 'canola oil', 'sesame oil',
  // Beverages
  'coffee', 'tea', 'orange juice', 'apple juice',
  // Other common
  'honey', 'chocolate', 'maple syrup', 'vinegar', 'soy sauce', 'mustard', 'mayonnaise',
  'peanut butter', 'almond butter', 'tahini', 'oatmeal', 'granola', 'popcorn',
  'bagel', 'muffin', 'pancake', 'waffle',
];

function isPriorityFood(description) {
  const lower = description.toLowerCase();
  return PRIORITY_KEYWORDS.some(kw => lower.includes(kw));
}

function isExcluded(description) {
  const lower = description.toLowerCase();
  const excludePatterns = [
    'infant formula', 'baby food', 'restaurant', 'fast food',
    'school lunch', 'meal replacement', 'protein supplement',
    'usda commodity', 'formulated bar',
    'pillsbury', 'archway', 'george weston', 'nabisco', 'kellogg',
    'general mills', 'post ', 'quaker', 'kraft', 'oscar mayer',
    'hormel', 'morningstar', 'campbell', 'healthy choice', 'lean cuisine',
    'stouffer', 'marie callender', 'smart ones', 'banquet',
    'pepperidge farm', 'sara lee', 'jimmy dean', 'bob evans',
    'tyson', 'foster farms', 'perdue', 'applebee', 'mori-nu',
  ];
  return excludePatterns.some(p => lower.includes(p));
}

// ------- Main -------

console.log('Loading USDA data...');

const foods = parseCSV(path.join(DATA_DIR, 'food.csv'));
const nutrientRows = parseCSV(path.join(DATA_DIR, 'food_nutrient.csv'));

// Build nutrient index: fdcId -> { nutrientId -> amount }
// Only store values that are actually measured (present in CSV = measured)
const nutrientsByFood = {};
const targetIds = new Set(Object.keys(NUTRIENT_IDS).map(Number));

for (const row of nutrientRows) {
  const nid = parseInt(row.nutrient_id);
  if (!targetIds.has(nid)) continue;
  const fdcId = row.fdc_id;
  const amount = parseFloat(row.amount);
  if (isNaN(amount)) continue;
  if (!nutrientsByFood[fdcId]) nutrientsByFood[fdcId] = {};
  nutrientsByFood[fdcId][nid] = amount;
}

console.log(`Loaded ${foods.length} foods, indexed ${Object.keys(nutrientsByFood).length} nutrient sets`);

// Build raw entries
const rawEntries = [];

for (const food of foods) {
  if (isExcluded(food.description)) continue;
  if (!isPriorityFood(food.description)) continue;

  const catInfo = CATEGORY_MAP[food.food_category_id];
  if (!catInfo || !catInfo.include) continue;

  const fdcId = food.fdc_id;
  const nutData = nutrientsByFood[fdcId];
  if (!nutData || !nutData[1008]) continue; // Must have calories

  // Build per100g with null for unmeasured values
  const per100g = {};
  const CORE_KEYS = [
    [1008, 'calories'], [1003, 'protein'], [1005, 'carbs'], [1004, 'fat'],
    [1079, 'fiber'], [1051, 'water'],
    [1106, 'vitamin_a'], [1162, 'vitamin_c'], [1114, 'vitamin_d'],
    [1109, 'vitamin_e'], [1185, 'vitamin_k'], [1175, 'vitamin_b6'],
    [1178, 'vitamin_b12'], [1177, 'folate'],
    [1087, 'calcium'], [1089, 'iron'], [1090, 'magnesium'],
    [1092, 'potassium'], [1095, 'zinc'],
  ];

  for (const [nid, key] of CORE_KEYS) {
    per100g[key] = nutData[nid] !== undefined ? round(nutData[nid]) : null;
  }

  // Omega-3: sum ALA + EPA + DHA (only if at least one is measured)
  const ala = nutData[1404];
  const epa = nutData[1278];
  const dha = nutData[1272];
  if (ala !== undefined || epa !== undefined || dha !== undefined) {
    per100g.omega3 = round((ala || 0) + (epa || 0) + (dha || 0));
  } else {
    per100g.omega3 = null;
  }

  const name = simplifyName(food.description);

  rawEntries.push({
    fdcId: parseInt(fdcId),
    name,
    category: catInfo.name,
    aliases: buildSearchAliases(name),
    per100g,
  });
}

console.log(`${rawEntries.length} priority foods selected`);

// ------- Dedup: group by food concept, average duplicates, keep best variants -------

/**
 * Extract base food concept for grouping.
 * "Chicken, broilers or fryers, breast, meat only, cooked, roasted" -> "chicken breast"
 * "Yogurt, plain, whole milk" -> "yogurt plain"
 * "Spinach, raw" -> "spinach"
 */
function getBaseConcept(name) {
  const lower = name.toLowerCase();
  const parts = lower.split(',').map(p => p.trim());

  // Take first 2 meaningful parts
  const meaningful = parts.filter(p => {
    // Skip generic cooking methods and structural modifiers, but PRESERVE essential qualifiers (raw, fresh, dried, canned, frozen, dehydrated, powdered, sweetened, unsweetened)
    return !/^(cooked|boiled|baked|roasted|grilled|fried|steamed|mature seeds|immature seeds|solids and liquids|drained solids|packed in|with salt|without salt|fat free|lowfat|low fat|nonfat|whole|reduced fat|light|fortified|unfortified|unenriched|enriched|unsalted|salted|prepared|unprepared|regular|commercially|homemade|ns as to|from concentrate|not from concentrate|with added|without added|infant|junior|strained|flakes|granulated|condensed|evaporated|dry form|reconstituted)$/i.test(p);
  });

  // Take first 2 parts max
  return meaningful.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
}

const grouped = {};
for (const entry of rawEntries) {
  const key = getBaseConcept(entry.name);
  if (!grouped[key]) grouped[key] = [];
  grouped[key].push(entry);
}

console.log(`${Object.keys(grouped).length} unique food concepts`);

/** Average nutrient values, preserving null only if ALL samples are null */
function averageNutrients(entries) {
  const keys = Object.keys(entries[0].per100g);
  const result = {};
  for (const key of keys) {
    const measured = entries.map(e => e.per100g[key]).filter(v => v !== null);
    if (measured.length === 0) {
      result[key] = null;
    } else {
      result[key] = round(measured.reduce((a, b) => a + b, 0) / measured.length);
    }
  }
  return result;
}

/** Score entry by data completeness */
function completeness(entry) {
  return Object.values(entry.per100g).filter(v => v !== null).length;
}

const deduped = [];
for (const [concept, group] of Object.entries(grouped)) {
  if (concept.length < 3) continue; // Skip garbage entries

  // Sort by completeness (most data first), then shorter name (simpler)
  group.sort((a, b) => completeness(b) - completeness(a) || a.name.length - b.name.length);

  if (group.length === 1) {
    deduped.push(group[0]);
  } else {
    // Take the entry with the most complete data as representative
    const best = { ...group[0] };
    best.per100g = averageNutrients(group);
    // Merge all aliases
    const allAliases = new Set();
    for (const e of group) {
      for (const a of e.aliases) allAliases.add(a);
    }
    best.aliases = [...allAliases];
    deduped.push(best);
  }
}

deduped.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
console.log(`After dedup: ${deduped.length} unique foods (was ${rawEntries.length})`);

// ------- Stats -------

let nullCounts = {};
const NUTRIENT_KEYS = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'water',
  'vitamin_a', 'vitamin_c', 'vitamin_d', 'vitamin_e', 'vitamin_k',
  'vitamin_b6', 'vitamin_b12', 'folate', 'calcium', 'iron', 'magnesium',
  'potassium', 'zinc', 'omega3'];

for (const key of NUTRIENT_KEYS) nullCounts[key] = 0;
for (const entry of deduped) {
  for (const key of NUTRIENT_KEYS) {
    if (entry.per100g[key] === null) nullCounts[key]++;
  }
}
console.log('\nNull counts per nutrient:');
for (const key of NUTRIENT_KEYS) {
  const pct = ((nullCounts[key] / deduped.length) * 100).toFixed(1);
  console.log(`  ${key.padEnd(15)} ${nullCounts[key]} nulls (${pct}%)`);
}

// ------- Generate TypeScript -------

let ts = `/**
 * Common Foods USDA Lookup Table
 *
 * Generated from USDA FoodData Central SR Legacy (April 2018).
 * Source: https://fdc.nal.usda.gov/download-datasets.html
 *
 * ${deduped.length} unique foods with per-100g values for 19 nutrients + water.
 * Auto-generated by scripts/generateUSDAFoods.js -- DO NOT EDIT MANUALLY.
 *
 * IMPORTANT: null means "not measured by USDA" (unknown), 0 means "actually zero".
 * Duplicate USDA samples are averaged into single entries.
 * Omega-3 = ALA + EPA + DHA combined.
 */

export interface FoodNutrients {
  /** kcal */ calories: number | null;
  /** g */   protein: number | null;
  /** g */   carbs: number | null;
  /** g */   fat: number | null;
  /** g */   fiber: number | null;
  /** g */   water: number | null;
  /** mcg RAE */ vitamin_a: number | null;
  /** mg */  vitamin_c: number | null;
  /** mcg */ vitamin_d: number | null;
  /** mg */  vitamin_e: number | null;
  /** mcg */ vitamin_k: number | null;
  /** mg */  vitamin_b6: number | null;
  /** mcg */ vitamin_b12: number | null;
  /** mcg */ folate: number | null;
  /** mg */  calcium: number | null;
  /** mg */  iron: number | null;
  /** mg */  magnesium: number | null;
  /** mg */  potassium: number | null;
  /** mg */  zinc: number | null;
  /** g, ALA+EPA+DHA */ omega3: number | null;
}

export interface FoodEntry {
  /** USDA FDC ID for traceability */
  fdcId: number;
  /** Main display name */
  name: string;
  /** Category (dairy, fruit, vegetable, etc.) */
  category: string;
  /** Aliases for fuzzy matching (lowercase) */
  aliases: string[];
  /** Nutrients per 100g. null = not measured, 0 = actually zero. */
  per100g: FoodNutrients;
}

export const COMMON_FOODS: FoodEntry[] = [\n`;

for (const food of deduped) {
  const aliasStr = food.aliases.map(a => `'${a.replace(/'/g, "\\'")}'`).join(', ');
  const nutValues = NUTRIENT_KEYS.map(k => {
    const v = food.per100g[k];
    return `${k}: ${v === null ? 'null' : v}`;
  }).join(', ');
  ts += `  { fdcId: ${food.fdcId}, name: '${food.name.replace(/'/g, "\\'")}', category: '${food.category}', aliases: [${aliasStr}], per100g: { ${nutValues} } },\n`;
}

ts += `];\n`;

const outPath = path.join(__dirname, '..', 'lib', 'data', 'commonFoods.ts');
fs.writeFileSync(outPath, ts);
console.log(`\nWritten ${deduped.length} foods to ${outPath}`);
console.log(`File size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);

function round(n) { return Math.round(n * 100) / 100; }
