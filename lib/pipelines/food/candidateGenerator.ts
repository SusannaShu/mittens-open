/**
 * Candidate Generator — Hybrid LLM + USDA Approach
 *
 * 1. LLM generates whole food meal candidates targeting nutrient gaps
 * 2. Each food is fuzzy-matched to USDA COMMON_FOODS for accurate per100g data
 * 3. Unmatched foods get LLM nutrient estimates (flagged low confidence)
 * 4. MILP solver optimizes portions
 */

import { FoodEntry } from '../../data/commonFoods';
import { MealPlanCandidate, NutrientGap } from './meal-plan-solver';
import {
  NutrientResult,
  flattenNutrients,
  scaleNutrients
} from '../../services/food/nutrientEstimator';

// ── Serving Size Estimation ──

const SERVING_SIZES: Record<string, number> = {
  poultry: 120, seafood: 115, beef: 115, pork: 115, lamb: 115,
  legume: 130, dairy: 175, grain: 140, cereal: 40,
  vegetable: 130, fruit: 150, nut: 30, fat: 15,
  soup: 245, baked: 50, sweet: 30, beverage: 240,
  spice: 5, snack: 30,
};

export function getServingG(category: string): number {
  return SERVING_SIZES[category] || 100;
}

/** Infer sourceType from USDA category for UL rules */
export function inferSourceType(category: string): 'animal' | 'plant' | 'fortified' | 'unknown' {
  const ANIMAL = new Set(['beef', 'pork', 'poultry', 'lamb', 'seafood', 'dairy']);
  const PLANT = new Set(['vegetable', 'fruit', 'legume', 'nut', 'grain', 'spice']);
  if (ANIMAL.has(category)) return 'animal';
  if (PLANT.has(category)) return 'plant';
  if (['cereal', 'baked'].includes(category)) return 'fortified';
  return 'unknown';
}

// ── Dietary Filtering ──

const ANIMAL_CATEGORIES = new Set(['beef', 'pork', 'poultry', 'lamb', 'seafood']);

export function isAllowedByDiet(food: FoodEntry, prefs: string[]): boolean {
  if (!prefs || prefs.length === 0) return true;
  for (const pref of prefs) {
    switch (pref) {
      case 'vegetarian':
        if (ANIMAL_CATEGORIES.has(food.category)) return false;
        break;
      case 'vegan':
        if (ANIMAL_CATEGORIES.has(food.category) || food.category === 'dairy') return false;
        break;
      case 'pescatarian':
        if (['beef', 'pork', 'poultry', 'lamb'].includes(food.category)) return false;
        break;
      case 'halal': case 'kosher':
        if (food.category === 'pork') return false;
        break;
    }
  }
  return true;
}

// ── LLM Prompt Builder ──

export function buildCandidatePrompt(opts: {
  remainingMeals: string[];
  gaps: NutrientGap[];
  pantryStr: string;
  dislikedStr: string;
  eatenStr: string;
  dietPrefs: string[];
  season: string;
}): string {
  const { remainingMeals, gaps, pantryStr, dislikedStr, eatenStr, dietPrefs, season } = opts;

  // Exclude vitamin_d — addressed via sun/UV exposure, not food
  const needMore = gaps.filter(g =>
    (g.status === 'low' || g.status === 'moderate' || g.pct < 80) && g.nutrient !== 'vitamin_d'
  );
  const avoidMore = gaps.filter(g => g.status === 'excess' || g.pct > 150);

  const gapStr = needMore.length > 0
    ? needMore.map(g => {
        const deficit = Math.max(0, g.rda - g.actual);
        return `${g.name}: need ${Math.round(deficit * 10) / 10}${g.unit} more (currently ${g.pct}%)`;
      }).join('\n')
    : 'No major gaps';

  const avoidStr = avoidMore.length > 0
    ? `AVOID adding more: ${avoidMore.map(g => g.name).join(', ')}`
    : '';

  const dietStr = dietPrefs.length > 0
    ? `DIETARY: ${dietPrefs.join(', ')}`
    : '';

  const mealSlotStr = remainingMeals.map(m => `"${m}"`).join(', ');

  return `Suggest whole food ingredients for ${mealSlotStr} that close these nutrient gaps.

NUTRIENT GAPS:
${gapStr}
${avoidStr}

PANTRY: ${pantryStr}
${dislikedStr ? `DISLIKED: ${dislikedStr}` : ''}
${eatenStr}
${dietStr}
SEASON: ${season}

RULES:
1. Suggest 6-8 INDIVIDUAL whole food ingredients per meal. One food per line.
2. Whole, minimally processed foods ONLY. No powders, supplements, or fortified products.
3. Specify a realistic household portion (e.g. "4 oz salmon fillet", "1 cup cooked lentils", "2 large eggs").
4. Each meal needs: a protein source, a carb/grain, and 1-2 vegetables.
5. Choose cooking methods that preserve nutrients: steaming > boiling, raw > overcooked.
6. Prefer in-season produce for ${season}.
7. Prefer pantry items. Mark with [pantry].
8. Tag which gap nutrient each food primarily targets.

Return ONLY valid JSON:
{
${remainingMeals.map(m => `  "${m}": {
    "candidates": [
      { "food": "4 oz salmon fillet", "targets_gap": "omega3", "fromPantry": false },
      { "food": "1 cup cooked quinoa", "targets_gap": "protein", "fromPantry": true }
    ],
    "cookTip": "Steam vegetables to preserve vitamin C; pair iron-rich foods with citrus."
  }`).join(',\n')}
}`;
}

// ── Candidate Builder (NutrientResult → MealPlanCandidate) ──

export function buildCandidateFromResult(
  foodStr: string,
  res: NutrientResult,
  slot: string,
  index: number,
  pantryItem?: any,
): MealPlanCandidate {
  const usedRef = res.meta.usedReference;
  const closestRef = res.meta.allReferences && res.meta.allReferences.length > 0
    ? res.meta.allReferences[0]
    : undefined;

  const refToUse = usedRef || closestRef;
  const category = refToUse?.category || 'vegetable';
  const portion_g = getServingG(category);

  // Since estimateNutrients was run with 100g portionG, scale final estimated nutrients to portion_g
  const nutrients100g = flattenNutrients(res.nutrients);
  const nutrients: Record<string, number> = {};
  const scale = portion_g / 100;
  for (const [k, v] of Object.entries(nutrients100g)) {
    nutrients[k] = Math.round((v || 0) * scale * 100) / 100;
  }

  // Calculate usdaNutrients for side-by-side comparison
  let usdaNutrients: Record<string, number> | undefined;
  if (refToUse) {
    const scaledUsda = scaleNutrients(refToUse.per100g, portion_g);
    usdaNutrients = {};
    for (const [k, v] of Object.entries(scaledUsda)) {
      usdaNutrients[k] = v ?? 0;
    }
  }

  const allRefsWithData = (res.meta.allReferences || []).map(r => ({
    fdcId: r.fdcId,
    name: r.name,
    category: r.category,
    score: r.score,
    per100g: r.per100g as unknown as Record<string, number | null>,
  }));

  return {
    id: `candidate_${slot}_${index}`,
    name: foodStr,
    mealSlot: slot,
    nutrients,
    portion_g,
    fromPantry: !!pantryItem,
    pantryItemId: pantryItem?.id || undefined,
    pantryAvailable_g: pantryItem?.quantity ? pantryItem.quantity * 100 : undefined,
    freshness: pantryItem?.freshness || undefined,
    confidence: usedRef ? 'high' : 'medium',
    sourceType: inferSourceType(category),
    
    // Pass along rich metadata fields for UI displaying
    usdaNutrients,
    usedRef: usedRef ? { fdcId: usedRef.fdcId, name: usedRef.name, score: usedRef.score } : undefined,
    allRefs: allRefsWithData,
    adjustments: res.meta.adjustments,
    reasoning: res.meta.reasoning,
  };
}

// ── Season Helper ──

export function getCurrentSeason(latitude?: number): string {
  const month = new Date().getMonth(); // 0-11
  const isNorthern = (latitude ?? 40) >= 0;
  if (isNorthern) {
    if (month >= 2 && month <= 4) return 'spring';
    if (month >= 5 && month <= 7) return 'summer';
    if (month >= 8 && month <= 10) return 'fall';
    return 'winter';
  } else {
    if (month >= 2 && month <= 4) return 'fall';
    if (month >= 5 && month <= 7) return 'winter';
    if (month >= 8 && month <= 10) return 'spring';
    return 'summer';
  }
}
