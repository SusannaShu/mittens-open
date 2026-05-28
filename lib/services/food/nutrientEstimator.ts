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
  return n;
}

/**
 * Stem a single token to a canonical form for comparison.
 * Handles common English plural patterns so "strawberry" ↔ "strawberries" match.
 */
function stemToken(t: string): string {
  if (t.length <= 3) return t;
  // berries → berry, cherries → cherry, etc.
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y';
  // tomatoes → tomato, potatoes → potato
  if (t.endsWith('oes') && t.length > 5) return t.slice(0, -2);
  // peaches → peach, bunches → bunch
  if (t.endsWith('ches') || t.endsWith('shes') || t.endsWith('sses') || t.endsWith('xes') || t.endsWith('zes'))
    return t.slice(0, -2);
  // leaves → leaf (irregular handled below), olives → olive
  if (t.endsWith('ves') && t.length > 5) return t.slice(0, -1);
  // general -es: oranges → orange, grapes → grape
  if (t.endsWith('es') && t.length > 4) return t.slice(0, -1);
  // general -s: carrots → carrot, apples → apple
  if (t.endsWith('s') && !t.endsWith('ss') && t.length > 3) return t.slice(0, -1);
  return t;
}

// Words that shouldn't drive matching (removed 'orange' — it's a valid food name)
const STOP_WORDS = new Set(['likely', 'other', 'speck', 'the', 'and', 'with', 'for', 'from']);

// Color words: don't filter from query, but give them reduced weight in scoring
const COLOR_WORDS = new Set(['red', 'orange', 'green', 'yellow', 'white', 'brown', 'black', 'dark', 'light', 'golden', 'purple']);

/**
 * Map everyday food names to USDA-style search terms.
 * Searched BEFORE the normal fuzzy lookup to handle naming mismatches.
 */
const FOOD_SYNONYMS: Record<string, string[]> = {
  'sandwich bread': ['bread, white', 'bread, wheat', 'bread, whole-wheat'],
  'white bread': ['bread, white'],
  'wheat bread': ['bread, wheat'],
  'whole wheat bread': ['bread, whole-wheat'],
  'multigrain bread': ['bread, multi-grain'],
  'sourdough': ['bread, french or vienna'],
  'toast': ['bread, white', 'bread, wheat'],
  'oj': ['orange juice'],
  'orange juice': ['orange juice, raw'],
  'apple juice': ['apple juice, canned or bottled'],
  'chicken breast': ['chicken, broilers or fryers, breast'],
  'chicken thigh': ['chicken, broilers or fryers, thigh'],
  'ground beef': ['beef, ground'],
  'steak': ['beef, top sirloin'],
  'bacon': ['pork, cured, bacon'],
  'ham': ['pork, cured, ham'],
  'hot dog': ['frankfurter, beef'],
  'french fries': ['potatoes, french fried'],
  'fries': ['potatoes, french fried'],
  'mashed potatoes': ['potatoes, mashed'],
  'sweet potato': ['sweet potato, raw'],
  'bell pepper': ['peppers, sweet'],
  'green beans': ['beans, snap, green'],
  'corn on the cob': ['corn, sweet, yellow'],
  'peanut butter': ['peanut butter, smooth'],
  'cream cheese': ['cream cheese'],
  'sour cream': ['cream, sour'],
  'cottage cheese': ['cheese, cottage'],
  'mac and cheese': ['macaroni and cheese'],
  'grilled cheese': ['cheese sandwich'],
  'pb&j': ['peanut butter, smooth'],
  'oatmeal': ['cereals, oats, instant'],
  'granola': ['cereals, granola'],
  'scrambled eggs': ['egg, whole, cooked, scrambled'],
  'hard boiled egg': ['egg, whole, cooked, hard-boiled'],
  'fried egg': ['egg, whole, cooked, fried'],
  'sunny side up': ['egg, whole, cooked, fried'],
  'walnut': ['nuts, walnuts, english'],
  'walnuts': ['nuts, walnuts, english'],
  'almond': ['nuts, almonds'],
  'almonds': ['nuts, almonds'],
  'cashew': ['nuts, cashew nuts, raw'],
  'cashews': ['nuts, cashew nuts, raw'],
  'pecan': ['nuts, pecans'],
  'pecans': ['nuts, pecans'],
};

/**
 * Check if two tokens match, accounting for plurals/stems.
 * Returns: 1.0 for exact/stem match, 0.8 for prefix match, 0 for no match.
 */
function tokenMatch(qt: string, at: string): number {
  // Exact match
  if (qt === at) return 1.0;
  // Stemmed match: strawberry ↔ strawberries
  const qStem = stemToken(qt);
  const aStem = stemToken(at);
  if (qStem === aStem) return 1.0;
  // Prefix match (one starts with the other, both long enough)
  if (qt.length > 3 && at.length > 3) {
    if (at.startsWith(qt) || qt.startsWith(at)) return 0.8;
    if (aStem.startsWith(qStem) || qStem.startsWith(aStem)) return 0.8;
  }
  return 0;
}

function matchScore(query: string, entry: FoodEntry): number {
  const q = normalizeName(query);
  const qStemmed = stemToken(q);
  const qTokens = q.split(/[\s/,]+/).filter(t => t.length > 1 && !STOP_WORDS.has(t));
  if (qTokens.length === 0) return 0;

  // Separate color tokens from substantive tokens for weighted scoring
  const qSubstantive = qTokens.filter(t => !COLOR_WORDS.has(t));
  const qColors = qTokens.filter(t => COLOR_WORDS.has(t));

  let bestScore = 0;

  for (const alias of entry.aliases) {
    const a = alias.toLowerCase();
    const aStemmed = stemToken(a.split(/[\s,]+/)[0] || a); // stem the primary word

    // Exact full match (including stemmed)
    if (a === q || a === qStemmed) return 1.0;

    // Stemmed primary word matches: "strawberry" → alias "strawberries" (stemmed: "strawberry")
    // Only for single-token aliases to avoid false matches on compound names
    const aWords = a.split(/[\s,]+/).filter(t => t.length > 1);
    if (aWords.length === 1 && qTokens.length === 1) {
      if (stemToken(aWords[0]) === stemToken(qTokens[0])) {
        bestScore = Math.max(bestScore, 0.98);
        continue;
      }
    }

    // Query starts the alias: "tofu" matches "tofu, firm" but NOT "mayonnaise, made with tofu"
    if (a.startsWith(q + ',') || a.startsWith(q + ' ')) {
      bestScore = Math.max(bestScore, 0.95);
      continue;
    }
    // Also check stemmed: "strawberry" matches "strawberries, raw"
    if (a.startsWith(qStemmed + ',') || a.startsWith(qStemmed + ' ')) {
      bestScore = Math.max(bestScore, 0.95);
      continue;
    }
    {
      // Check if the first alias token stems to the query: "strawberries, raw" → stem "strawberry"
      const firstAToken = aWords[0];
      if (firstAToken && qTokens.length === 1 && stemToken(firstAToken) === stemToken(qTokens[0])) {
        // Single-word query matches the primary alias word by stem
        // Score based on how specific the alias is (fewer extra words = better)
        const specificity = Math.max(0.85, 0.95 - (aWords.length - 1) * 0.03);
        if (specificity > bestScore) bestScore = specificity;
        continue; // This alias's stem matched; check remaining aliases for potentially better scores
      }
    }

    // Alias starts with query (single word primary match)
    if (a.startsWith(q)) {
      bestScore = Math.max(bestScore, 0.9);
      continue;
    }

    // Token overlap (handles multi-word and partial matches)
    const aTokens = aWords;
    
    let overlapCount = 0;
    let unmatchedQueryTokens = 0;
    const substantiveMatched: boolean[] = new Array(qSubstantive.length).fill(false);

    // Match substantive tokens first (higher weight)
    qSubstantive.forEach((qt, qi) => {
      let matched = false;
      for (const at of aTokens) {
        const m = tokenMatch(qt, at);
        if (m > 0) {
          overlapCount += m;
          matched = true;
          break;
        }
      }
      if (!matched) unmatchedQueryTokens++;
      substantiveMatched[qi] = matched;
    });

    // Match color tokens (lower weight — they refine but shouldn't drive matching)
    qColors.forEach(qt => {
      for (const at of aTokens) {
        const m = tokenMatch(qt, at);
        if (m > 0) {
          overlapCount += m * 0.3; // Colors contribute less
          break;
        }
      }
    });

    const effectiveQueryLen = qSubstantive.length + qColors.length * 0.3;
    const queryCoverage = effectiveQueryLen > 0 ? overlapCount / effectiveQueryLen : 0;
    const aliasCoverage = overlapCount / aTokens.length;
    
    // Weighted harmonic mean — favor recall (query coverage) more
    // If substantive query tokens are unmatched, penalize heavily
    let score = (queryCoverage + aliasCoverage) > 0
      ? (2 * queryCoverage * aliasCoverage) / (queryCoverage + aliasCoverage)
      : 0;

    // Penalty for unmatched substantive query tokens
    if (qSubstantive.length > 1 && unmatchedQueryTokens > 0) {
      score *= (1 - unmatchedQueryTokens * 0.3 / qSubstantive.length);
    }

    // Boost if the alias's primary word matches the query's primary word (by stem)
    if (aTokens[0] && qSubstantive[0]) {
      if (tokenMatch(qSubstantive[0], aTokens[0]) >= 1.0) {
        score += 0.08;
      } else if (tokenMatch(qSubstantive[0], aTokens[0]) >= 0.8) {
        score += 0.04;
      }
    }

    if (score > bestScore) bestScore = score;
  }
  return Math.min(bestScore, 1.0);
}

/**
 * Resolve food synonyms before fuzzy search.
 * Maps common everyday names to USDA-style names for better matching.
 */
function resolveSearchTerms(foodName: string): string[] {
  const normalized = normalizeName(foodName);
  const terms = [foodName]; // always search the original

  // Check synonym map (case-insensitive)
  const synonyms = FOOD_SYNONYMS[normalized];
  if (synonyms) {
    terms.push(...synonyms);
  }
  // Also try partial synonym matches (e.g., "grilled sandwich bread" still matches "sandwich bread")
  for (const [key, vals] of Object.entries(FOOD_SYNONYMS)) {
    if (key !== normalized && normalized.includes(key)) {
      terms.push(...vals);
    }
  }
  return [...new Set(terms)];
}

export function lookupUSDAAll(foodName: string, threshold = 0.65, maxResults = 8): USDAReference[] {
  const searchTerms = resolveSearchTerms(foodName);
  const matchMap = new Map<number, USDAReference>(); // dedupe by fdcId

  for (const term of searchTerms) {
    for (const entry of COMMON_FOODS) {
      const score = matchScore(term, entry);
      if (score >= threshold) {
        const existing = matchMap.get(entry.fdcId);
        if (!existing || score > existing.score) {
          matchMap.set(entry.fdcId, {
            fdcId: entry.fdcId, name: entry.name,
            category: entry.category, score, per100g: entry.per100g,
          });
        }
      }
    }
  }

  return Array.from(matchMap.values())
    .sort((a, b) => {
      // Primary: sort by score descending
      if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
      // Tiebreaker: prefer "raw" variants (user usually means the plain/raw food)
      const aRaw = a.name.toLowerCase().includes(', raw') ? 1 : 0;
      const bRaw = b.name.toLowerCase().includes(', raw') ? 1 : 0;
      if (bRaw !== aRaw) return bRaw - aRaw;
      // Secondary tiebreaker: prefer shorter names (less processed/more generic)
      return a.name.length - b.name.length;
    })
    .slice(0, maxResults);
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
  return `This food item had no direct match in our USDA database. Provide a highly accurate, professional nutrient estimation for: ${foodName}, ${portionG}g, ${cooking || 'unknown preparation'}.
If this is a composite item or mixture, mentally break it down into its separate raw/cooked components, estimate their individual weights, calculate their nutrients, and sum them up to get the total.

Provide detailed step-by-step nutritional reasoning for macros and key vitamins/minerals in the reason field.
JSON: {"nutrients":{"cal":0,"pro":0,"carb":0,"fat":0,"fib":0,"water":0,"vA":0,"vC":0,"vD":0,"vE":0,"vK":0,"vB6":0,"vB12":0,"fol":0,"ca":0,"fe":0,"mg":0,"k":0,"zn":0,"o3":0},"reason":"detailed step-by-step reasoning for estimates"}
Values for THAT portion. cal=kcal pro/carb/fat/fib/water=g vitamins standard units minerals=mg o3=g`;
}

function parseCompactNutrients(compact: Record<string, any>): Partial<Record<keyof FoodNutrients, number>> {
  const result: any = {};
  for (const [key, value] of Object.entries(compact)) {
    const fullKey = COMPACT_TO_FULL[key];
    if (fullKey) {
      const numValue = typeof value === 'string' ? parseFloat(value) : value;
      if (typeof numValue === 'number' && !isNaN(numValue)) {
        result[fullKey] = numValue;
      }
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
function parsePickResponse(response: string, maxVal: number): number {
  const cleaned = response.trim();
  // Try exact match of number first
  const numMatch = cleaned.match(/^(\d+)/);
  if (numMatch) {
    const val = parseInt(numMatch[1], 10);
    if (val >= 0 && val <= maxVal) return val;
  }
  // Try extracting any digits
  const digits = cleaned.replace(/\D/g, '');
  if (digits) {
    const val = parseInt(digits, 10);
    if (val >= 0 && val <= maxVal) return val;
  }
  return 0; // none
}

function buildPickPrompt(foodName: string, portionG: number, cooking: string, refs: USDAReference[]): string {
  const candidateNames = refs.slice(0, 8).map((r, i) =>
    `${i + 1}. ${r.name} [${r.category}] (${Math.round(r.score * 100)}% match)`
  ).join('\n');
  return `We are identifying this food item for an exact USDA FoodData Central database match to retrieve highly accurate, standard lab-measured nutrition.
Food to match: "${foodName}" (${portionG}g, ${cooking || 'unknown preparation'}).

Which USDA database entry best matches this SPECIFIC food item? Consider both the substance and prep/cooking style, not just generic keyword overlap.
Reply with ONLY the number (e.g., 1, 2, 0). If NONE of the candidates represent this food accurately (or if they belong to a completely different form, e.g. dried powder instead of fresh), reply "0".

${candidateNames}`;
}

function buildSuggestPrompt(foodName: string, cooking: string): string {
  return `The food "${foodName}" (${cooking || 'unknown prep'}) didn't match well in our USDA database.
Suggest 3 official USDA food search terms/synonyms that best represent this food.
Format each line as: search_term | confidence (0-100)
Example: Spices, paprika | 85

Only the 3 best guesses:`;
}

function parseSuggestions(suggestResponse: string): Array<{ name: string, confidence: number }> {
  return suggestResponse.split('\n')
    .map(l => {
      const cleaned = l.replace(/^\d+[\.\)]\s*/, '').trim();
      const parts = cleaned.split('|');
      const name = parts[0]?.trim() || '';
      const conf = parseInt(parts[1]?.trim() || '50', 10);
      return { name, confidence: Math.min(100, Math.max(0, conf || 50)) };
    })
    .filter(s => s.name.length > 2)
    .sort((a, b) => b.confidence - a.confidence);
}

async function generateText(providerOrBrain: any, prompt: string): Promise<string> {
  if (!providerOrBrain) {
    throw new Error('No inference provider or brain available');
  }
  if (typeof providerOrBrain.text === 'function') {
    return await providerOrBrain.text(prompt);
  }
  if (typeof providerOrBrain.generateRaw === 'function') {
    return await providerOrBrain.generateRaw(prompt);
  }
  if (typeof providerOrBrain.generate === 'function') {
    return await providerOrBrain.generate(prompt);
  }
  throw new Error('Inference provider or brain does not support text generation');
}

/**
 * Estimate nutrients for a single food item.
 *
 * 4-Tier Brain-driven USDA Matching Cascade:
 * Tier 1: Search USDA database for candidates.
 * Tier 2: Brain picks the best fit from candidates.
 * Tier 3: Synonym suggestion on rejection.
 * Tier 4: Re-search USDA with synonyms and ask brain again.
 * Tier 5: Fallback to AI nutrient estimation (preserves allReferences).
 */
export async function estimateNutrients(
  foodName: string,
  portionG: number,
  cooking: string = '',
  useAI: boolean = true,
  brainOrProvider?: any,
): Promise<NutrientResult> {
  let allRefs = lookupUSDAAll(foodName, 0.4); // low threshold to get candidates
  let usedRef: USDAReference | undefined;
  let reasoning: string | undefined;

  let provider = brainOrProvider;
  if (!provider && useAI) {
    try {
      const { getAgentEnabled, getAgentProvider, getInferenceProvider } = require('../../providers/providerFactory');
      const agentOn = await getAgentEnabled();
      provider = (agentOn && getAgentProvider()) || await getInferenceProvider();
    } catch (e: any) {
      console.warn('[estimateNutrients] Failed to get active provider:', e.message);
    }
  }

  // ── 4-Tier Brain-Driven Cascade ──
  let aiRanSuccessfully = false;
  if (useAI && provider) {
    try {
      // Tier 1: Search USDA for candidates.
      // Tier 2: Brain picks the best fit from candidates.
      if (allRefs.length > 0) {
        console.log(`[estimateNutrients] Asking brain to pick for "${foodName}" from ${allRefs.length} refs`);
        const pickPrompt = buildPickPrompt(foodName, portionG, cooking, allRefs);
        const pickResponse = await generateText(provider, pickPrompt);
        const pickedNum = parsePickResponse(pickResponse, allRefs.length);

        if (pickedNum > 0) {
          usedRef = allRefs[pickedNum - 1];
          reasoning = `Brain selected USDA reference: "${usedRef.name}"`;
          console.log(`[estimateNutrients] Brain selected: "${usedRef.name}"`);
        }
      }

      // Tier 3: Rejection → Suggest 3 alternative keywords/synonyms
      if (!usedRef) {
        console.log(`[estimateNutrients] No USDA match accepted for "${foodName}". Asking brain for synonyms...`);
        const suggestPrompt = buildSuggestPrompt(foodName, cooking);
        const suggestResponse = await generateText(provider, suggestPrompt);
        const suggestions = parseSuggestions(suggestResponse);

        // Tier 4: Re-search USDA with synonyms and ask brain again
        if (suggestions.length > 0) {
          console.log(`[estimateNutrients] Synonym suggestions:`, suggestions.map(s => `${s.name} (${s.confidence}%)`).join(', '));
          
          let newRefs: USDAReference[] = [];
          for (const sug of suggestions.slice(0, 3)) {
            const hits = lookupUSDAAll(sug.name, 0.4);
            for (const h of hits) {
              if (!newRefs.some(r => r.fdcId === h.fdcId) && !allRefs.some(r => r.fdcId === h.fdcId)) {
                newRefs.push(h);
              }
            }
          }

          if (newRefs.length > 0) {
            // Combine them
            const combinedRefs = [...allRefs, ...newRefs];
            const pickPrompt2 = buildPickPrompt(foodName, portionG, cooking, combinedRefs);
            const pickResponse2 = await generateText(provider, pickPrompt2);
            const pickedNum2 = parsePickResponse(pickResponse2, combinedRefs.length);

            if (pickedNum2 > 0) {
              usedRef = combinedRefs[pickedNum2 - 1];
              reasoning = `Brain selected USDA reference after synonym re-search: "${usedRef.name}"`;
              console.log(`[estimateNutrients] Brain selected after re-search: "${usedRef.name}"`);
            }
            
            // Keep all unique references for meta.allReferences
            allRefs = combinedRefs;
          }
        }
      }

      // Brain cascade completed successfully (even if it rejected all candidates)
      aiRanSuccessfully = true;
    } catch (e: any) {
      console.warn('[estimateNutrients] Brain cascade error:', e.message);
    }
  }

  // Non-AI fallback: only if AI didn't run or crashed. If AI ran successfully
  // and still didn't pick a ref, respect that decision — fall through to AI estimation.
  if (!aiRanSuccessfully && !usedRef && allRefs.length > 0 && allRefs[0].score >= 0.70) {
    usedRef = allRefs[0];
    reasoning = `Fallback USDA match: "${usedRef.name}" (${Math.round(usedRef.score * 100)}% confidence)`;
  }

  // ── Tier 5: Fallback to AI nutrient estimation if still no match, but keep allRefs ──
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
        adjustments: [],
        reasoning,
        breakdown: { measured, estimated: 0, unknown },
      },
    };
  }

  // Full AI Estimation
  if (useAI && provider) {
    try {
      const prompt = buildEstimatePrompt(foodName, portionG, cooking);
      const raw = await generateText(provider, prompt);
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
            allReferences: allRefs, // Preserve all refs for side-by-side!
            adjustments: [],
            reasoning: parsed.reason || reasoning || 'AI estimated — no USDA match chosen',
            breakdown: { measured: 0, estimated, unknown },
          },
        };
      }
    } catch (e: any) {
      console.warn('[estimateNutrients] AI estimation failed:', e.message);
    }
  }

  // Absolute fallback: empty nutrients
  const nutrients: Partial<NutrientValues> = {};
  for (const key of ALL_KEYS) {
    nutrients[key] = { value: null, source: null, confidence: 0 };
  }
  return {
    nutrients: nutrients as NutrientValues,
    meta: {
      primarySource: null,
      allReferences: allRefs,
      adjustments: [],
      reasoning: 'Nutrient lookup failed.',
      breakdown: { measured: 0, estimated: 0, unknown: 20 },
    },
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
