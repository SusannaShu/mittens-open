/**
 * Nutrient Estimator Service
 *
 * USDA data = lab-measured reference fed INTO AI prompt as context.
 * AI generates estimates ANCHORED on real USDA data, explains adjustments.
 * User sees USDA refs, AI's reasoning, and can edit any value.
 *
 * Pipeline: lookupUSDAAll() -> feed refs into prompt -> AI estimates with reasoning
 */

import { COMMON_FOODS, FoodNutrients, FoodEntry } from '../../data/commonFoods';
import { LocalInferenceService } from '../ai/localInference';

// ──────────── Types ────────────

export type NutrientSource = 'usda' | 'ai';

export interface NutrientValue {
  value: number | null;
  source: NutrientSource | null;
  confidence: number;
  userEdited?: boolean;
}

export type NutrientValues = Record<keyof FoodNutrients, NutrientValue>;

export interface USDAReference {
  fdcId: number;
  name: string;
  category: string;
  score: number;
  per100g: FoodNutrients;
}

/** What AI adjusted from USDA reference */
export interface NutrientAdjustment {
  key: string;
  usdaValue: number | null;
  adjustedValue: number;
  reason: string;
}

export interface NutrientResult {
  nutrients: NutrientValues;
  meta: {
    primarySource: NutrientSource | null;
    usedReference?: USDAReference;
    allReferences: USDAReference[];
    /** AI's adjustments from the USDA reference with reasoning */
    adjustments: NutrientAdjustment[];
    /** AI's overall reasoning */
    reasoning?: string;
    breakdown: { measured: number; estimated: number; unknown: number };
  };
}

export type FlatNutrients = Record<keyof FoodNutrients, number | null>;

const COMPACT_TO_FULL: Record<string, keyof FoodNutrients> = {
  cal: 'calories', pro: 'protein', carb: 'carbs', fat: 'fat',
  fib: 'fiber', water: 'water',
  vA: 'vitamin_a', vC: 'vitamin_c', vD: 'vitamin_d', vE: 'vitamin_e',
  vK: 'vitamin_k', vB6: 'vitamin_b6', vB12: 'vitamin_b12', fol: 'folate',
  ca: 'calcium', fe: 'iron', mg: 'magnesium', k: 'potassium',
  zn: 'zinc', o3: 'omega3',
};

const FULL_TO_COMPACT: Record<string, string> = {};
for (const [k, v] of Object.entries(COMPACT_TO_FULL)) FULL_TO_COMPACT[v] = k;

const ALL_KEYS: (keyof FoodNutrients)[] = [
  'calories', 'protein', 'carbs', 'fat', 'fiber', 'water',
  'vitamin_a', 'vitamin_c', 'vitamin_d', 'vitamin_e', 'vitamin_k',
  'vitamin_b6', 'vitamin_b12', 'folate',
  'calcium', 'iron', 'magnesium', 'potassium', 'zinc', 'omega3',
];

// ──────────── Fuzzy Matching ────────────

function normalizeName(name: string): string {
  let n = name.toLowerCase().trim();
  // Strip parenthetical descriptors like "(Red/Orange)" or "(likely cooking oil)"
  n = n.replace(/\([^)]*\)/g, '').trim();
  // Strip cooking/prep prefixes
  n = n.replace(/^(fresh|raw|organic|dried|frozen|canned|cooked|roasted|grilled|steamed|baked|fried)\s+/g, '');
  n = n.replace(/\s+(sliced|diced|chopped|minced|whole|pieces|chunks)$/g, '');
  // Depluralize
  if (n.endsWith('ies') && n.length > 4) n = n.slice(0, -3) + 'y';
  else if (n.endsWith('es') && n.length > 4) n = n.slice(0, -2);
  else if (n.endsWith('s') && n.length > 3) n = n.slice(0, -1);
  return n;
}

// Words that shouldn't drive matching
const STOP_WORDS = new Set(['likely', 'dark', 'light', 'other', 'red', 'orange', 'green', 'yellow', 'white', 'brown', 'black', 'speck']);

function matchScore(query: string, entry: FoodEntry): number {
  const q = normalizeName(query);
  const qTokens = q.split(/[\s/,]+/).filter(t => t.length > 1 && !STOP_WORDS.has(t));
  if (qTokens.length === 0) return 0;
  let bestScore = 0;

  for (const alias of entry.aliases) {
    const a = alias.toLowerCase();
    // Exact full match
    if (a === q) return 1.0;

    // Query starts the alias: "tofu" matches "tofu, firm" but NOT "mayonnaise, made with tofu"
    if (a.startsWith(q + ',') || a.startsWith(q + ' ')) return 0.95;

    // Alias starts with query (single word primary match)
    if (a.startsWith(q)) return 0.9;

    // Token overlap (handles multi-word and partial matches)
    const aTokens = a.split(/[\s,]+/).filter(t => t.length > 1);
    const overlap = qTokens.filter(qt => aTokens.some(at => at === qt || (at.length > 3 && qt.length > 3 && (at.startsWith(qt) || qt.startsWith(at)))));
    const score = overlap.length / Math.max(qTokens.length, aTokens.length);
    if (score > bestScore) bestScore = score;
  }
  return bestScore;
}

export function lookupUSDAAll(foodName: string, threshold = 0.5, maxResults = 8): USDAReference[] {
  const matches: USDAReference[] = [];
  for (const entry of COMMON_FOODS) {
    const score = matchScore(foodName, entry);
    if (score >= threshold) {
      matches.push({
        fdcId: entry.fdcId, name: entry.name,
        category: entry.category, score, per100g: entry.per100g,
      });
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

export function lookupUSDA(foodName: string, threshold = 0.6): USDAReference | null {
  const all = lookupUSDAAll(foodName, threshold, 1);
  return all.length > 0 ? all[0] : null;
}

// ──────────── Scaling ────────────

export function scaleNutrients(per100g: FoodNutrients, portionGrams: number): FoodNutrients {
  const factor = portionGrams / 100;
  const scaled: any = {};
  for (const [key, value] of Object.entries(per100g)) {
    scaled[key] = value === null ? null : Math.round(value * factor * 100) / 100;
  }
  return scaled as FoodNutrients;
}

// ──────────── AI Prompts ────────────

function buildRefDecisionPrompt(foodName: string, portionG: number, cooking: string, refs: USDAReference[]): string {
  const refLines = refs.slice(0, 5).map(r => `"${r.name}" (score: ${Math.round(r.score * 100)}%)`).join('\n');
  return `Food: "${foodName}" ${portionG}g, ${cooking || 'preparation unknown'}.

Available USDA references:
${refLines}

CRITICAL: If NONE of these references are a highly accurate match for the food, REJECT THEM and output "none".
If one IS a good match, output its exact name.

JSON: {"ref":"which USDA name, or 'none'"}
`;
}

/** Full AI estimation for foods not in USDA */
function buildEstimatePrompt(foodName: string, portionG: number, cooking: string): string {
  return `Estimate nutrients for: ${foodName}, ${portionG}g, ${cooking || 'unknown preparation'}

Provide detailed step-by-step reasoning for macros and key vitamins in the reason field.
JSON: {"nutrients":{"cal":0,"pro":0,"carb":0,"fat":0,"fib":0,"water":0,"vA":0,"vC":0,"vD":0,"vE":0,"vK":0,"vB6":0,"vB12":0,"fol":0,"ca":0,"fe":0,"mg":0,"k":0,"zn":0,"o3":0},"reason":"detailed step-by-step reasoning for estimates"}
Values for THAT portion. cal=kcal pro/carb/fat/fib/water=g vitamins standard units minerals=mg o3=g`;
}

function parseCompactNutrients(compact: Record<string, number>): Partial<Record<keyof FoodNutrients, number>> {
  const result: any = {};
  for (const [key, value] of Object.entries(compact)) {
    const fullKey = COMPACT_TO_FULL[key];
    if (fullKey && typeof value === 'number' && !isNaN(value)) {
      result[fullKey] = value;
    }
  }
  return result;
}

function extractJSON(raw: string): Record<string, any> | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch { /* invalid */ }
  return null;
}

// ──────────── Main Estimator ────────────

/**
 * Estimate nutrients for a single food item.
 *
 * Phase 1: AI decides whether to pick a USDA ref or reject them ("none")
 * Phase 2: If rejected, AI estimates nutrients from scratch
 */
export async function estimateNutrients(
  foodName: string,
  portionG: number,
  cooking: string = '',
  useAI: boolean = true,
): Promise<NutrientResult> {

  const allRefs = lookupUSDAAll(foodName);
  let usedRef: USDAReference | undefined;

  // ── Phase 1: AI Reference Decision ──
  if (allRefs.length > 0 && useAI) {
    try {
      const prompt = buildRefDecisionPrompt(foodName, portionG, cooking, allRefs);
      const raw = await LocalInferenceService.generateLocalResponse(prompt);
      const parsed = extractJSON(raw);
      const refName = String(parsed?.ref || '').toLowerCase().trim();

      if (refName && refName !== 'none') {
        usedRef = allRefs.find(r => r.name.toLowerCase().includes(refName)) || allRefs[0];
      }
    } catch { 
      // If AI fails to decide, fall back to the top match if it's very strong
      if (allRefs[0].score >= 0.75) usedRef = allRefs[0]; 
    }
  } else if (!useAI && allRefs.length > 0 && allRefs[0].score >= 0.75) {
    usedRef = allRefs[0];
  }

  // ── Phase 2A: Use the Chosen Reference ──
  if (usedRef) {
    const scaled = scaleNutrients(usedRef.per100g, portionG);
    const nutrients: Partial<NutrientValues> = {};
    let measured = 0;
    let unknown = 0;

    for (const key of ALL_KEYS) {
      const val = scaled[key];
      if (val !== null) {
        nutrients[key] = { value: val, source: 'usda', confidence: usedRef.score };
        measured++;
      } else {
        nutrients[key] = { value: null, source: null, confidence: 0 };
        unknown++;
      }
    }

    return {
      nutrients: nutrients as NutrientValues,
      meta: {
        primarySource: 'usda',
        usedReference: usedRef,
        allReferences: allRefs,
        adjustments: [], // Bioavailability pass runs later
        breakdown: { measured, estimated: 0, unknown },
      },
    };
  }

  // ── Phase 2B: Full AI Estimation (No reference selected) ──
  if (useAI) {
    try {
      const prompt = buildEstimatePrompt(foodName, portionG, cooking);
      const raw = await LocalInferenceService.generateLocalResponse(prompt);
      const parsed = extractJSON(raw);

      if (parsed?.nutrients) {
        const aiValues = parseCompactNutrients(parsed.nutrients);
        const nutrients: Partial<NutrientValues> = {};
        let estimated = 0;
        let unknown = 0;

        for (const key of ALL_KEYS) {
          const val = aiValues[key];
          if (val !== undefined) {
            nutrients[key] = { value: val, source: 'ai', confidence: 0.5 };
            estimated++;
          } else {
            nutrients[key] = { value: null, source: null, confidence: 0 };
            unknown++;
          }
        }

        return {
          nutrients: nutrients as NutrientValues,
          meta: {
            primarySource: 'ai',
            usedReference: undefined,
            allReferences: allRefs,
            adjustments: [],
            reasoning: parsed.reason || '',
            breakdown: { measured: 0, estimated, unknown },
          },
        };
      }
    } catch { /* AI failed */ }
  }

  // ── Path C: Nothing ──
  const nutrients: Partial<NutrientValues> = {};
  for (const key of ALL_KEYS) {
    nutrients[key] = { value: null, source: null, confidence: 0 };
  }
  return {
    nutrients: nutrients as NutrientValues,
    meta: { primarySource: null, allReferences: allRefs, adjustments: [], breakdown: { measured: 0, estimated: 0, unknown: 20 } },
  };
}

// ──────────── Re-estimate ────────────

export function reEstimateWithReference(
  ref: USDAReference, portionG: number, allRefs: USDAReference[],
): NutrientResult {
  const scaled = scaleNutrients(ref.per100g, portionG);
  const nutrients: Partial<NutrientValues> = {};
  let measured = 0, unknown = 0;

  for (const key of ALL_KEYS) {
    const val = scaled[key];
    if (val !== null) {
      nutrients[key] = { value: val, source: 'usda', confidence: ref.score };
      measured++;
    } else {
      nutrients[key] = { value: null, source: null, confidence: 0 };
      unknown++;
    }
  }

  return {
    nutrients: nutrients as NutrientValues,
    meta: {
      primarySource: 'usda', usedReference: ref, allReferences: allRefs,
      adjustments: [], breakdown: { measured, estimated: 0, unknown },
    },
  };
}

// ──────────── User Edits ────────────

export function applyUserEdits(
  result: NutrientResult,
  edits: Partial<Record<keyof FoodNutrients, number | null>>,
): NutrientResult {
  const updated = { ...result, nutrients: { ...result.nutrients } };
  for (const [key, val] of Object.entries(edits)) {
    const k = key as keyof FoodNutrients;
    if (ALL_KEYS.includes(k)) {
      updated.nutrients[k] = {
        value: val ?? null,
        source: updated.nutrients[k]?.source ?? null,
        confidence: updated.nutrients[k]?.confidence ?? 0,
        userEdited: true,
      };
    }
  }
  return updated;
}

// ──────────── Helpers ────────────

export function flattenNutrients(nutrients: NutrientValues): Record<keyof FoodNutrients, number> {
  const flat: any = {};
  for (const key of ALL_KEYS) flat[key] = nutrients[key]?.value ?? 0;
  return flat;
}

export function flattenNutrientsNullable(nutrients: NutrientValues): FlatNutrients {
  const flat: any = {};
  for (const key of ALL_KEYS) flat[key] = nutrients[key]?.value ?? null;
  return flat;
}

export function averageConfidence(nutrients: NutrientValues): number {
  let sum = 0, count = 0;
  for (const key of ALL_KEYS) {
    const conf = nutrients[key]?.confidence ?? 0;
    if (conf > 0) { sum += conf; count++; }
  }
  return count > 0 ? Math.round((sum / count) * 100) / 100 : 0;
}

export async function estimateNutrientsBatch(
  foods: Array<{ name: string; portion_g: number; cooking?: string }>,
  useAI: boolean = true,
): Promise<NutrientResult[]> {
  const results: NutrientResult[] = [];
  for (const food of foods) {
    results.push(await estimateNutrients(food.name, food.portion_g, food.cooking || '', useAI));
  }
  return results;
}
