import solver from 'javascript-lp-solver/dist/index.browser.mjs';

const NUTRIENT_KEYS = [
  'calories', 'protein', 'carbs', 'fat', 'fiber',
  'vitamin_a', 'vitamin_c', 'vitamin_d', 'vitamin_e', 'vitamin_k',
  'vitamin_b6', 'vitamin_b12', 'folate',
  'calcium', 'iron', 'magnesium', 'potassium', 'zinc', 'omega3',
];

/**
 * UL Source Rules — IOM Dietary Reference Intakes
 * 
 * Some nutrients have ULs that apply ONLY to specific forms/sources.
 * If a nutrient is listed here, UL enforcement only applies when
 * the food's sourceType matches one of the listed sources.
 * 
 * Nutrients NOT listed here: UL applies to total intake from all sources.
 * 
 * References:
 *  - Vitamin A: IOM 2001 — UL for preformed retinol only; β-carotene (plant) has no UL
 *  - Vitamin D: IOM 2011 — UL for exogenous intake; endogenous sun synthesis is self-limiting
 *  - Vitamin E: IOM 2000 — UL for supplemental α-tocopherol only; food E has no UL
 *  - Folate: IOM 1998 — UL for synthetic folic acid only; food folate has no UL
 *  - Niacin: IOM 1998 — UL for nicotinic acid (supplements/fortified); food niacin has no UL
 *  - Magnesium: IOM 1997 — UL for supplemental/pharmacological only; food Mg has no UL
 *  - Iron: IOM 2001 — UL applies to all sources technically, but non-heme (plant) has
 *    very low bioavailability (~2-20%), making plant iron toxicity virtually impossible
 *  - Vitamin B6: IOM 1998 — UL set at 100mg based on supplemental pyridoxine studies;
 *    food B6 has never caused toxicity (max ~3mg/day from food)
 */
const UL_RULES: Record<string, string[]> = {
  vitamin_a:  ['animal', 'supplement', 'fortified'], // β-carotene (plant) is harmless
  vitamin_d:  ['supplement'],                         // sun synthesis is self-limiting
  vitamin_e:  ['supplement'],                         // food vitamin E is harmless
  folate:     ['supplement', 'fortified'],            // synthetic folic acid only
  niacin:     ['supplement', 'fortified'],            // nicotinic acid flush; food niacin safe
  magnesium:  ['supplement', 'fortified'],            // dietary magnesium is harmless
  iron:       ['animal', 'supplement', 'fortified'],  // non-heme plant iron absorption too low
  vitamin_b6: ['supplement'],                         // food B6 maxes ~3mg/day, UL is 100mg
};

export interface MealPlanCandidate {
  id: string;
  name: string;
  mealSlot?: string;
  nutrients: Record<string, number>;
  portion_g: number;
  fromPantry?: boolean;
  pantryAvailable_g?: number;
  confidence?: 'high' | 'medium' | 'low';
  sourceType?: 'animal' | 'plant' | 'supplement' | 'fortified' | 'unknown';
  pantryItemId?: number;
  freshness?: string;
  portionMultiplier?: number;
  scaledNutrients?: Record<string, number>;
  usdaNutrients?: Record<string, number>;
  usedRef?: { fdcId: number; name: string; score: number };
  allRefs?: Array<{ fdcId: number; name: string; category: string; score: number; per100g: Record<string, number | null> }>;
  adjustments?: any[];
  reasoning?: string;
}

export interface NutrientGap {
  nutrient: string;
  name: string;
  rda: number;
  ul?: number;
  ulTotal?: number;
  actual: number;
  pct: number;
  status: string;
  unit: string;
}

export interface MealPlanConstraints {
  targetCalories?: number;
  dislikedFoods?: string[];
  mealSlots?: string[];
  recentFoods?: string[];
  excludedFoods?: string[];
}

export interface MealPlanCoverage {
  name: string;
  currentPct: number;
  afterPlanPct: number;
  planAdds: number;
  unit: string;
  rda: number;
  status: string;
  isUlExcess: boolean;
}

export interface MealPlanResult {
  selectedFoods: MealPlanCandidate[];
  coverage: Record<string, MealPlanCoverage>;
  bindingConstraints: { type: string; nutrient: string; name: string }[];
  pantryUsage: any[];
  metadata: any;
}

/**
 * Solve for optimal food portions across all candidates.
 */
export function solveMealPlan(
  candidates: MealPlanCandidate[],
  gaps: NutrientGap[],
  constraints: MealPlanConstraints
): MealPlanResult {
  const startTime = Date.now();
  const { targetCalories = 2000, dislikedFoods = [], mealSlots = ['snack'], recentFoods = [], excludedFoods = [] } = constraints;

  // Build gap map for quick lookup
  const gapMap: Record<string, NutrientGap> = {};
  for (const g of gaps) gapMap[g.nutrient] = g;

  // Identify gap nutrients (< 90% RDA)
  // Exclude vitamin_d — addressed via sun/UV exposure recommendation, not food optimization
  const gapNutrients = gaps
    .filter(g => (g.status === 'low' || g.status === 'moderate') && g.nutrient !== 'vitamin_d')
    .map(g => g.nutrient);

  // Build LP model
  const model: any = {
    optimize: 'score',
    opType: 'max',
    constraints: {},
    variables: {},
    ints: {},
  };

  // WEIGHTS
  const W_GAP = 10;
  const W_GAP_MACRO = 15;  // macros get higher priority (protein, carbs, fat, fiber)
  const W_PANTRY = 1.5;
  const W_PANTRY_URGENT = 2.5;  // use_soon items
  const W_DISLIKE = -20;
  const W_RECENT = -2;      // soft penalty for recently used foods (variety)
  const W_EXCLUDED = -100;  // hard penalty for explicitly excluded foods

  const SAFETY_TIER: Record<string, number> = {
    calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0,
    vitamin_k: 1, vitamin_b12: 1, potassium: 1, magnesium: 1, omega3: 1,
    vitamin_c: 2, vitamin_b6: 2, folate: 2, vitamin_e: 2, calcium: 2, vitamin_d: 2,
    vitamin_a: 3, iron: 3, zinc: 3,
  };

  const MACRO_KEYS = new Set(['calories', 'protein', 'carbs', 'fat', 'fiber']);

  // Add constraints for each nutrient with UL
  for (const g of gaps) {
    if (g.ul) {
      const epsilon = 0.15;
      const effectiveUL = g.ul * (1 - epsilon);
      const currentUL = g.ulTotal !== undefined ? g.ulTotal : g.actual;
      const headroom = Math.max(0, effectiveUL - currentUL);
      model.constraints[`ul_${g.nutrient}`] = { max: headroom };
    }
  }

  // Calorie constraints (envelope ±15%)
  const calHeadroom = Math.max(0, targetCalories - (gapMap.calories ? gapMap.calories.actual : 0));
  model.constraints['cal_min'] = { min: calHeadroom * 0.85 };
  model.constraints['cal_max'] = { max: calHeadroom * 1.15 };

  // Macro constraints: protein, carbs, fat, fiber (soft envelope ±25%)
  for (const macro of ['protein', 'carbs', 'fat', 'fiber']) {
    const g = gapMap[macro];
    if (!g || g.pct >= 90) continue;
    const deficit = Math.max(0, g.rda - g.actual);
    if (deficit > 0) {
      model.constraints[`macro_min_${macro}`] = { min: deficit * 0.6 };
      model.constraints[`macro_max_${macro}`] = { max: deficit * 1.4 };
    }
  }

  // Per-meal-slot item count constraints
  for (const slot of mealSlots) {
    model.constraints[`slot_min_${slot}`] = { min: 2 };
    model.constraints[`slot_max_${slot}`] = { max: 8 };
  }

  // Build variables (one per candidate food)
  for (let i = 0; i < candidates.length; i++) {
    const food = candidates[i];
    const varName = `food_${i}`;
    const nutrients = food.nutrients || {};
    const sourceType = food.sourceType || 'unknown';
    const isDisliked = dislikedFoods.some(d =>
      (food.name || '').toLowerCase().includes(d.toLowerCase())
    );

    const confidence = (food.confidence || 'medium').toLowerCase();
    const epsilon = confidence === 'high' ? 0.15 : confidence === 'low' ? 0.35 : 0.25;

    let score = 0;

    // Gap-closing reward — normalize by deficit so partially-filled gaps
    // get proportionally higher reward per unit of contribution
    for (const gapNutrient of gapNutrients) {
      const amount = nutrients[gapNutrient] || 0;
      const g = gapMap[gapNutrient];
      if (amount > 0 && g && g.rda > 0) {
        const deficit = Math.max(0, g.rda - g.actual);
        if (deficit <= 0) continue; // Already covered, no reward
        const contribution = Math.min(amount, deficit);
        const weight = MACRO_KEYS.has(gapNutrient) ? W_GAP_MACRO : W_GAP;
        score += weight * (contribution / deficit);
      }
    }

    // Overshoot penalty — source-aware so safe food sources aren't penalized
    for (const key of NUTRIENT_KEYS) {
      const amount = nutrients[key] || 0;
      const g = gapMap[key];
      if (amount <= 0 || !g || g.rda <= 0 || g.pct < 90) continue;

      // Check if UL applies to this source type
      const rule = UL_RULES[key];
      if (rule && !rule.includes(sourceType)) continue; // Safe source, no penalty

      const tier = SAFETY_TIER[key] ?? 2;
      const ratio = amount / g.rda;

      if (tier === 0 || tier === 1) {
        continue;
      } else if (tier === 2) {
        if (g.pct >= 150) score += -2 * ratio;
      } else {
        if (g.pct >= 200) score += -20 * ratio;
        else if (g.pct >= 100) score += -8 * ratio;
        else score += -3 * ratio;
      }
    }

    // Pantry preference bonus
    if (food.fromPantry) {
      const freshBonus = (food.freshness === 'use_soon' || food.freshness === 'questionable')
        ? W_PANTRY_URGENT : W_PANTRY;
      score += freshBonus;
    }

    if (isDisliked) score += W_DISLIKE;

    // Excluded foods (from item dismissal) — effectively blacklist
    const isExcluded = excludedFoods.some(e =>
      (food.name || '').toLowerCase().includes(e.toLowerCase())
    );
    if (isExcluded) score += W_EXCLUDED;

    // Recent food penalty — soft discouragement for variety
    // (pantry items are exempt: if you have it in the fridge, use it)
    if (!food.fromPantry && recentFoods.length > 0) {
      const isRecent = recentFoods.some(r =>
        (food.name || '').toLowerCase().includes(r.toLowerCase()) ||
        r.toLowerCase().includes((food.name || '').toLowerCase().split(',')[0])
      );
      if (isRecent) score += W_RECENT;
    }

    const variable: any = { score };

    // Nutrient contributions
    for (const g of gaps) {
      if (g.ul) {
        const effectiveUL = g.ul * (1 - epsilon);
        const currentUL = g.ulTotal !== undefined ? g.ulTotal : g.actual;
        const headroom = Math.max(0, effectiveUL - currentUL);
        if (headroom > 0) {
          const rule = UL_RULES[g.nutrient];
          if (!rule || rule.includes(sourceType) || sourceType === 'unknown') {
            variable[`ul_${g.nutrient}`] = nutrients[g.nutrient] || 0;
          }
        }
      }
    }

    variable['cal_min'] = nutrients.calories || 0;
    variable['cal_max'] = nutrients.calories || 0;

    for (const macro of ['protein', 'carbs', 'fat', 'fiber']) {
      if (model.constraints[`macro_min_${macro}`]) {
        variable[`macro_min_${macro}`] = nutrients[macro] || 0;
        variable[`macro_max_${macro}`] = nutrients[macro] || 0;
      }
    }

    const slot = food.mealSlot || mealSlots[0] || 'snack';
    variable[`slot_min_${slot}`] = 1;
    variable[`slot_max_${slot}`] = 1;

    if (food.fromPantry && food.pantryAvailable_g && food.portion_g) {
      const maxMultiplier = food.pantryAvailable_g / food.portion_g;
      model.constraints[`pantry_cap_${i}`] = { max: Math.min(maxMultiplier, 1.5) };
      variable[`pantry_cap_${i}`] = 1;
    } else {
      // Cap portion at 1.2x serving to keep meals realistic
      model.constraints[`max_portion_${i}`] = { max: 1.2 };
      variable[`max_portion_${i}`] = 1;
    }

    model.constraints[`min_portion_${i}`] = { min: 0 };
    variable[`min_portion_${i}`] = 1;

    model.variables[varName] = variable;
  }

  let results;
  try {
    if (!solver) {
      console.warn('javascript-lp-solver not available, using greedy fallback');
      return greedyFallback(candidates, gaps, constraints, startTime);
    }
    results = solver.Solve(model);
    
    if (results && results.feasible === false) {
      console.warn('MILP solver returned infeasible model, falling back to greedy algorithm');
      return greedyFallback(candidates, gaps, constraints, startTime);
    }
  } catch (err: any) {
    console.error('MILP solver error:', err.message);
    return greedyFallback(candidates, gaps, constraints, startTime);
  }

  const selectedFoods: MealPlanCandidate[] = [];
  const pantryUsage: any[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const varName = `food_${i}`;
    const portion = results[varName] || 0;
    if (portion < 0.3) continue;

    const food = { ...candidates[i] };
    food.portionMultiplier = Math.round(portion * 100) / 100;

    const scaledNutrients: Record<string, number> = {};
    for (const [k, v] of Object.entries(food.nutrients || {})) {
      scaledNutrients[k] = typeof v === 'number' ? Math.round(v * food.portionMultiplier * 10) / 10 : v;
    }
    food.scaledNutrients = scaledNutrients;
    selectedFoods.push(food);

    if (food.fromPantry && food.portion_g) {
      const usedG = Math.round(food.portion_g * food.portionMultiplier);
      pantryUsage.push({
        itemId: food.pantryItemId || null,
        foodName: food.name,
        usedPortion_g: usedG,
        availablePortion_g: food.pantryAvailable_g || null,
        percentUsed: food.pantryAvailable_g
          ? Math.round((usedG / food.pantryAvailable_g) * 100) : null,
      });
    }
  }

  const coverage = computeCoverage(selectedFoods, gaps);
  const bindingConstraints: any[] = [];

  for (const g of gaps) {
    if (g.ul) {
      let totalAdded = 0;
      for (const f of selectedFoods) {
        const sType = f.sourceType || 'unknown';
        const r = UL_RULES[g.nutrient];
        if (!r || r.includes(sType) || sType === 'unknown') {
          totalAdded += ((f.scaledNutrients || {})[g.nutrient] || 0);
        }
      }
      const epsilon = 0.15;
      const effectiveUL = g.ul * (1 - epsilon);
      const currentUL = g.ulTotal !== undefined ? g.ulTotal : g.actual;
      const headroom = effectiveUL - currentUL;
      if (totalAdded >= headroom * 0.9) {
        bindingConstraints.push({ type: 'UL', nutrient: g.nutrient, name: g.name });
      }
    }
  }

  const metadata = {
    solveTimeMs: Date.now() - startTime,
    candidateCount: candidates.length,
    selectedCount: selectedFoods.length,
    feasible: results.feasible !== false,
    loops: 0,
  };

  return { selectedFoods, coverage, bindingConstraints, pantryUsage, metadata };
}

function computeCoverage(selectedFoods: MealPlanCandidate[], gaps: NutrientGap[]): Record<string, MealPlanCoverage> {
  const coverage: Record<string, MealPlanCoverage> = {};
  const totalNutrients: Record<string, number> = {};
  const ulAdded: Record<string, number> = {};

  for (const food of selectedFoods) {
    const sType = food.sourceType || 'unknown';
    for (const [k, v] of Object.entries(food.scaledNutrients || {})) {
      if (typeof v === 'number') {
        totalNutrients[k] = (totalNutrients[k] || 0) + v;
        const r = UL_RULES[k];
        if (!r || r.includes(sType) || sType === 'unknown') {
          ulAdded[k] = (ulAdded[k] || 0) + v;
        }
      }
    }
  }

  for (const g of gaps) {
    const planAdds = totalNutrients[g.nutrient] || 0;
    const afterActual = g.actual + planAdds;
    const afterPct = g.rda > 0 ? Math.round((afterActual / g.rda) * 100) : g.pct;

    let status = 'no_impact';
    if (afterPct >= 70) status = 'covered';
    else if (afterPct > g.pct) status = 'partial';

    const planAddsUL = ulAdded[g.nutrient] || 0;
    const afterUlTotal = (g.ulTotal !== undefined ? g.ulTotal : g.actual) + planAddsUL;
    const isUlExcess = g.ul ? afterUlTotal > g.ul : false;

    coverage[g.nutrient] = {
      name: g.name,
      currentPct: g.pct,
      afterPlanPct: afterPct,
      planAdds: Math.round(planAdds * 10) / 10,
      unit: g.unit,
      rda: g.rda,
      status,
      isUlExcess,
    };
  }

  return coverage;
}

function greedyFallback(
  candidates: MealPlanCandidate[],
  gaps: NutrientGap[],
  constraints: MealPlanConstraints,
  startTime: number
): MealPlanResult {
  const gapMap: Record<string, NutrientGap> = {};
  for (const g of gaps) gapMap[g.nutrient] = g;

  const SAFETY_TIER_GREEDY: Record<string, number> = {
    calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0,
    vitamin_k: 1, vitamin_b12: 1, potassium: 1, magnesium: 1, omega3: 1,
    vitamin_c: 2, vitamin_b6: 2, folate: 2, vitamin_e: 2, calcium: 2, vitamin_d: 2,
    vitamin_a: 3, iron: 3, zinc: 3,
  };
  const MACRO_SET = new Set(['calories', 'protein', 'carbs', 'fat', 'fiber']);

  const scored = candidates.map(food => {
    const nutrients = food.nutrients || {};
    let score = 0;
    for (const g of gaps) {
      if ((g.status === 'low' || g.status === 'moderate') && nutrients[g.nutrient]) {
        const weight = MACRO_SET.has(g.nutrient) ? 15 : 10;
        score += (nutrients[g.nutrient] / g.rda) * weight;
      }
      if (g.pct >= 90 && nutrients[g.nutrient] && g.rda > 0) {
        const tier = SAFETY_TIER_GREEDY[g.nutrient] ?? 2;
        const ratio = nutrients[g.nutrient] / g.rda;
        if (tier === 3 && g.pct >= 100) score += -8 * ratio;
        else if (tier === 2 && g.pct >= 150) score += -2 * ratio;
      }
    }
    if (food.fromPantry) score += 1.5;
    return { ...food, _score: score };
  });

  scored.sort((a, b) => b._score - a._score);

  const runningTotal: Record<string, number> = {};
  const runningUlTotal: Record<string, number> = {};
  for (const g of gaps) {
    runningTotal[g.nutrient] = g.actual;
    runningUlTotal[g.nutrient] = g.ulTotal !== undefined ? g.ulTotal : g.actual;
  }

  const selected: MealPlanCandidate[] = [];

  for (const food of scored) {
    if (selected.length >= 15) break;

    let safe = true;
    const nutrients = food.nutrients || {};
    const sType = food.sourceType || 'unknown';
    for (const g of gaps) {
      if (g.ul) {
        const r = UL_RULES[g.nutrient];
        if (!r || r.includes(sType) || sType === 'unknown') {
          const projectedUl = (runningUlTotal[g.nutrient] || 0) + (nutrients[g.nutrient] || 0);
          if (projectedUl > g.ul * 0.85) { safe = false; break; }
        }
      }
    }
    if (!safe) continue;

    food.portionMultiplier = 1;
    food.scaledNutrients = { ...nutrients };
    selected.push(food);

    for (const [k, v] of Object.entries(nutrients)) {
      if (typeof v === 'number') {
        runningTotal[k] = (runningTotal[k] || 0) + v;
        const r = UL_RULES[k];
        if (!r || r.includes(sType) || sType === 'unknown') {
          runningUlTotal[k] = (runningUlTotal[k] || 0) + v;
        }
      }
    }
  }

  const coverage = computeCoverage(selected, gaps);
  return {
    selectedFoods: selected,
    coverage,
    bindingConstraints: [],
    pantryUsage: [],
    metadata: { solveTimeMs: Date.now() - startTime, candidateCount: candidates.length, selectedCount: selected.length, feasible: true, loops: 0, fallback: true },
  };
}
