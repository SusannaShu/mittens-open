/**
 * Meal Plan Pipeline — Hybrid LLM + USDA + MILP
 *
 * Flow:
 *  1. Gather context (eaten meals, gaps, pantry, prefs)
 *  2. LLM suggests in-season whole foods targeting nutrient gaps
 *  3. Fuzzy-match each food to USDA COMMON_FOODS for accurate per100g data
 *  4. Unmatched foods → LLM nutrient estimate (flagged low confidence)
 *  5. MILP solver optimizes portions to hit RDA targets without exceeding UL
 *  6. Bioavailability adjustments
 *  7. Supplement recommendations (last resort) + Vitamin D sun exposure
 *  8. Store plan
 */

import { getDb } from '../../database';
import { solveMealPlan, MealPlanCandidate, NutrientGap } from './meal-plan-solver';
import { applyBioavailability } from './mealPlanBioavailability';
import { solveMealPlanWithBioavailability } from './bioSolver';
import {
  buildCandidatePrompt,
  getCurrentSeason,
  getServingG,
  inferSourceType,
  buildCandidateFromResult,
} from './candidateGenerator';
import { estimateNutrients, NutrientResult } from '../../services/food/nutrientEstimator';
import { recommendSupplements } from './supplementRecommender';
import { estimateVitaminDSynthesis, recommendSunExposure } from '../../services/vitaminDSynthesis';
import { generateAllCookTips } from './cookTipGenerator';

// ── Time-Aware Slot Selection ──

/**
 * Determine which meal slots make sense given the current time, what's
 * already been eaten, and remaining nutrient gaps.  Asks the LLM first;
 * falls back to a simple hour-based heuristic.
 */
async function determineMealSlots(
  brain: any,
  currentTime: Date,
  eatenMeals: string[],
  eatenFoodNames: string[],
  gapSummary: string,
): Promise<string[]> {
  const hh = currentTime.getHours();
  const mm = currentTime.getMinutes();
  const timeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

  try {
    const prompt = `Current local time: ${timeStr}.
Meals already eaten today: ${eatenMeals.length > 0 ? eatenMeals.join(', ') : 'none'}.
Foods already eaten: ${eatenFoodNames.length > 0 ? eatenFoodNames.join(', ') : 'none'}.
Remaining nutrient gaps: ${gapSummary || 'none significant'}.

Which meal slots should we plan for? Choose from: breakfast, lunch, dinner, snack.
Only include slots that make sense given the time of day and what has already been eaten.

Return ONLY a JSON array of strings, e.g. ["lunch", "dinner"].`;

    const slots = await brain.json(prompt, {}, null);
    if (Array.isArray(slots) && slots.length > 0) {
      // Validate each slot is a known string
      const valid = slots
        .map((s: any) => String(s).toLowerCase().trim())
        .filter((s: string) => ['breakfast', 'lunch', 'dinner', 'snack'].includes(s));
      if (valid.length > 0) return valid;
    }
  } catch (e: any) {
    const msg = (e.message || String(e)).toLowerCase();
    const isConn =
      e.name === 'ConnectionError' ||
      msg.includes('network request failed') ||
      msg.includes('failed to fetch') ||
      msg.includes('econnrefused') ||
      msg.includes('cannot reach') ||
      msg.includes('aborterror') ||
      msg.includes('model file not downloaded') ||
      msg.includes('no brain available') ||
      msg.includes('brain offline') ||
      msg.includes('not connected');
    if (isConn) {
      throw new Error(`Brain offline: ${e.message}`);
    }
    console.warn('[MealPlan] LLM slot selection failed, using time heuristic:', e.message);
  }

  // Fallback: time-based heuristic
  let heuristicSlots: string[];
  if (hh < 10)       heuristicSlots = ['breakfast', 'lunch', 'dinner'];
  else if (hh < 14)  heuristicSlots = ['lunch', 'dinner'];
  else if (hh < 19)  heuristicSlots = ['dinner'];
  else               heuristicSlots = ['snack'];

  // Filter out already-eaten slots
  const eatenSet = new Set(eatenMeals.map(m => m.toLowerCase()));
  return heuristicSlots.filter(s => !eatenSet.has(s));
}

export async function generateMealPlanPipeline(
  userId: string,
  gaps: NutrientGap[],
  customConstraint?: string
) {
  const db = getDb();
  const today = new Date().toLocaleDateString('en-CA');

  // ── 0. Obtain brain early — needed for slot selection, candidate gen, and tips ──
  let brain: any = null;
  try {
    const { getBrain } = require('../../brain/selector');
    brain = await getBrain();
  } catch (e: any) {
    console.warn('[MealPlan] Failed to load active brain for planning:', e.message);
  }

  if (!brain) {
    throw new Error('Brain not connected. Please make sure local AI model is running and downloaded.');
  }

  // ── 1. Gather context ──
  const loggedRows = db.getAllSync(
    `SELECT log_name, items, meal_type FROM nutrition_logs WHERE date(logged_at) = ? AND deleted_at IS NULL ORDER BY logged_at ASC`,
    [today]
  ) as any[];

  const eatenMealTypes = new Set(loggedRows.map(m => (m.meal_type || '').toLowerCase()).filter(Boolean));
  const eatenFoodNames = loggedRows.map(r => r.log_name || '').filter(Boolean);
  const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'];

  // Build gap summary for slot selection prompt
  const gapSummaryStr = gaps
    .filter(g => (g.status === 'low' || g.status === 'moderate' || g.pct < 80) && g.nutrient !== 'vitamin_d')
    .slice(0, 8)
    .map(g => `${g.name}: ${g.pct}%`)
    .join(', ');

  // Time-aware slot selection (LLM with heuristic fallback)
  let remainingMeals: string[];
  if (brain) {
    remainingMeals = await determineMealSlots(
      brain, new Date(), Array.from(eatenMealTypes), eatenFoodNames, gapSummaryStr
    );
  } else {
    // No brain available — fall back to simple filtering
    remainingMeals = MEAL_SLOTS.filter(slot => !eatenMealTypes.has(slot));
  }

  if (remainingMeals.length === 0) {
    return { plan: await handleAllMealsEaten(db, today, gaps, MEAL_SLOTS) };
  }

  const pantryRows = db.getAllSync(
    `SELECT id, item_name, quantity, unit, freshness FROM smart_pantry WHERE quantity > 0 ORDER BY item_name`
  ) as any[];

  const profile = db.getFirstSync(`SELECT * FROM nutrition_profile WHERE id = 1`) as any;
  let dislikedList: string[] = [];
  try {
    const parsed = JSON.parse(profile?.disliked_foods || '[]');
    dislikedList = Array.isArray(parsed)
      ? parsed.map((d: any) => typeof d === 'string' ? d : d.food || '').filter(Boolean)
      : (profile?.disliked_foods || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  } catch {
    dislikedList = (profile?.disliked_foods || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  }

  let dietPrefs: string[] = [];
  try { dietPrefs = JSON.parse(profile?.dietary_preferences || '[]'); } catch {}
  if (!Array.isArray(dietPrefs)) dietPrefs = [];

  // ── 1b. Query recent foods (last 3 days) for variety ──
  const recentFoods = queryRecentFoods(db, today, 3);

  const eatenStr = loggedRows.length > 0
    ? `ALREADY EATEN TODAY: ${loggedRows.map(r => r.log_name || '').filter(Boolean).join(', ')}`
    : '';
  const pantryStr = pantryRows.length > 0
    ? pantryRows.map(p => {
        const freshTag = p.freshness === 'use_soon' ? ' [USE SOON]' : '';
        return `${p.item_name} (${p.quantity}${p.unit || ''})${freshTag}`;
      }).join(', ')
    : 'Empty';
  const dislikedStr = dislikedList.join(', ');

  // ── 2. LLM generates whole food candidates targeting gaps ──
  const season = getCurrentSeason();
  const sessionPrefs = customConstraint || '';
  const prompt = buildCandidatePrompt({
    remainingMeals,
    gaps,
    pantryStr,
    dislikedStr,
    eatenStr,
    dietPrefs,
    season,
    sessionPrefs,
    recentFoods,
  });

  // Build fallback structure
  const fallbackPlan: Record<string, any> = {};
  for (const slot of remainingMeals) {
    fallbackPlan[slot] = { candidates: [] };
  }

  let llmPlan: Record<string, { candidates: Array<{ food: string; targets_gap?: string; fromPantry?: boolean }> }>;
  try {
    if (!brain) throw new Error('Brain not connected');
    llmPlan = await brain.json(prompt, {}, fallbackPlan);
  } catch (e: any) {
    const msg = (e.message || String(e)).toLowerCase();
    const isConn =
      e.name === 'ConnectionError' ||
      msg.includes('network request failed') ||
      msg.includes('failed to fetch') ||
      msg.includes('econnrefused') ||
      msg.includes('cannot reach') ||
      msg.includes('aborterror') ||
      msg.includes('model file not downloaded') ||
      msg.includes('no brain available') ||
      msg.includes('brain offline') ||
      msg.includes('not connected');
    if (isConn) {
      throw new Error(`Brain offline: ${e.message}`);
    }
    console.warn('[MealPlan] LLM candidate gen failed, using fallback:', e.message);
    llmPlan = fallbackPlan;
  }

  // ── 3. Parallelized USDA Brain-Driven Matching & Estimation ──

  const estimationPromises: Promise<{
    foodName: string;
    slot: string;
    index: number;
    cand: any;
    pantryMatch: any;
    result: NutrientResult;
  } | null>[] = [];


  let candidateIdx = 0;

  for (const slot of remainingMeals) {
    const slotData = llmPlan[slot];
    const candidates = slotData?.candidates || [];

    for (const cand of candidates) {
      const foodName = typeof cand === 'string' ? cand : cand.food;
      if (!foodName) continue;

      // Check if pantry item matches
      const pantryMatch = pantryRows.find(p =>
        foodName.toLowerCase().includes((p.item_name || '').toLowerCase()) ||
        (p.item_name || '').toLowerCase().includes(foodName.toLowerCase().split(',')[0])
      );

      const idx = candidateIdx++;

      const promise = (async () => {
        try {
          // Pass portionG=100 so estimateNutrients estimates nutrients at per-100g base.
          // buildCandidateFromResult will scale them to standard serving portion_g!
          const result = await estimateNutrients(foodName, 100, '', true, brain);
          return {
            foodName,
            slot,
            index: idx,
            cand,
            pantryMatch,
            result,
          };
        } catch (err: any) {
          console.error(`[MealPlanPipeline] Failed to estimate nutrients for "${foodName}":`, err.message);
          return null;
        }
      })();
      
      estimationPromises.push(promise);
    }
  }

  const estimationResults = await Promise.all(estimationPromises);
  const allCandidates: MealPlanCandidate[] = [];

  for (const item of estimationResults) {
    if (!item) continue;
    const candidate = buildCandidateFromResult(item.foodName, item.result, item.slot, item.index, item.pantryMatch);
    if (item.cand.targets_gap) {
      (candidate as any).targets_gap = item.cand.targets_gap;
    }
    allCandidates.push(candidate);
  }

  // ── 5. MILP Solve ──
  if (allCandidates.length === 0) {
    console.warn('[MealPlan] No candidates available after matching');
    return { plan: await handleAllMealsEaten(db, today, gaps, MEAL_SLOTS) };
  }

  const targetCalories = gaps.find(g => g.nutrient === 'calories');
  const solverConstraints = {
    targetCalories: targetCalories ? targetCalories.rda : 2000,
    dislikedFoods: dislikedList,
    mealSlots: remainingMeals,
    recentFoods,
  };

  // ── 5+6. Bioavailability-Aware MILP Solve (iterative) ──
  const bioResult = solveMealPlanWithBioavailability(allCandidates, gaps, solverConstraints);

  const { selectedFoods, adjustedCoverage, bioNotes, metadata: solverMetadata } = bioResult;

  // ── 7. Assemble ──
  const mealAssignment = assignToMeals(selectedFoods, remainingMeals);
  const assembledPlan = assemblePlan(mealAssignment, pantryRows, adjustedCoverage, remainingMeals, llmPlan);

  // Post-solver: generate cooking tips for final selected foods
  if (brain) {
    const cookTips = await generateAllCookTips(brain, mealAssignment, gaps);
    for (const [slot, tip] of Object.entries(cookTips)) {
      if (tip && assembledPlan[slot]) {
        assembledPlan[slot].prepTip = tip;
      }
    }
  }

  const uncoveredGaps = Object.entries(adjustedCoverage)
    .filter(([, v]) => v.status !== 'covered' && v.currentPct < 70 && v.afterPlanPct < 70)
    .map(([k, v]) => ({ nutrient: k, name: v.name, afterPlanPct: v.afterPlanPct }));

  // 7b. Supplements (absolute last resort)
  const supplements = recommendSupplements(uncoveredGaps, gaps as any);

  // 7c. Vitamin D: recommend sun exposure
  let vitaminDRec: any = null;
  const vitDGap = gaps.find(g => g.nutrient === 'vitamin_d');
  if (vitDGap && vitDGap.pct < 70) {
    try {
      const weatherRow = db.getFirstSync(
        `SELECT meta FROM weather_cache WHERE date(fetched_at) = ? ORDER BY fetched_at DESC LIMIT 1`,
        [today]
      ) as any;
      let uvIndex = 0;
      if (weatherRow?.meta) {
        try { uvIndex = JSON.parse(weatherRow.meta)?.uv || 0; } catch {}
      }
      const skinTypeRaw = profile?.skin_type || 'fitzpatrick-4';
      const skinType = (typeof skinTypeRaw === 'number' ? skinTypeRaw : parseInt(String(skinTypeRaw).replace(/\D/g, ''), 10) || 4) as 1 | 2 | 3 | 4 | 5 | 6;
      const deficitMcg = Math.max(0, vitDGap.rda - vitDGap.actual);

      if (uvIndex >= 3) {
        const sunRec = recommendSunExposure({ deficitMcg, uvIndex, skinType });
        vitaminDRec = { ...sunRec, uvIndex };
      } else {
        vitaminDRec = {
          minutesNeeded: Infinity,
          feasible: false,
          note: 'UV index too low today for vitamin D synthesis. Consider a vitamin D3 supplement (1000 IU).',
          uvIndex,
        };
      }
    } catch {}
  }

  // ── 8. Store ──
  const existing = db.getFirstSync(`SELECT * FROM daily_meal_plans WHERE plan_date = ?`, [today]) as any;

  const payload: any = {
    plan_date: today,
    breakfast: assembledPlan.breakfast ? JSON.stringify(assembledPlan.breakfast) : (existing?.breakfast || null),
    lunch: assembledPlan.lunch ? JSON.stringify(assembledPlan.lunch) : (existing?.lunch || null),
    dinner: assembledPlan.dinner ? JSON.stringify(assembledPlan.dinner) : (existing?.dinner || null),
    snacks: assembledPlan.snacks ? JSON.stringify(assembledPlan.snacks) : (existing?.snacks || null),
    grocery_list: JSON.stringify(assembledPlan.groceryList),
    gap_coverage: JSON.stringify(adjustedCoverage),
    bioavailability_notes: JSON.stringify(bioNotes),
    solver_metadata: JSON.stringify(solverMetadata),
    supplements: JSON.stringify(supplements),
    vitamin_d_rec: vitaminDRec ? JSON.stringify(vitaminDRec) : null,
    created_at: new Date().toISOString(),
  };

  db.runSync(
    `INSERT OR REPLACE INTO daily_meal_plans (plan_date, breakfast, lunch, dinner, snacks, gap_coverage, grocery_list, bioavailability_notes, solver_metadata, supplements, vitamin_d_rec, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.plan_date,
      payload.breakfast,
      payload.lunch,
      payload.dinner,
      payload.snacks,
      payload.gap_coverage,
      payload.grocery_list,
      payload.bioavailability_notes,
      payload.solver_metadata,
      payload.supplements,
      payload.vitamin_d_rec,
      payload.created_at,
    ]
  );

  return {
    plan: {
      date: today,
      breakfast: assembledPlan.breakfast,
      lunch: assembledPlan.lunch,
      dinner: assembledPlan.dinner,
      groceryList: assembledPlan.groceryList,
      gapCoverage: adjustedCoverage,
      uncoveredGaps,
      supplements,
      vitaminDRec,
      bioavailabilityNotes: bioNotes,
      solverMetadata,
      generatedAt: payload.created_at,
    },
  };
}

// ── Helper functions ──

async function handleAllMealsEaten(db: any, today: string, gaps: NutrientGap[], MEAL_SLOTS: string[]) {
  const gapCoverage: any = {};
  for (const g of gaps) {
    gapCoverage[g.nutrient] = {
      name: g.name,
      currentPct: g.pct,
      afterPlanPct: g.pct,
      unit: g.unit,
      status: g.pct >= 70 ? 'covered' : g.pct >= 30 ? 'partial' : 'uncovered',
    };
  }

  const existing = db.getFirstSync(`SELECT * FROM daily_meal_plans WHERE plan_date = ?`, [today]) as any;

  db.runSync(
    `INSERT OR REPLACE INTO daily_meal_plans (plan_date, breakfast, lunch, dinner, snacks, gap_coverage, grocery_list, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      today,
      existing?.breakfast || null,
      existing?.lunch || null,
      existing?.dinner || null,
      existing?.snacks || null,
      JSON.stringify(gapCoverage),
      JSON.stringify([]),
    ]
  );

  return { gapCoverage };
}

function assignToMeals(selectedFoods: MealPlanCandidate[], remainingMeals: string[]) {
  const assignment: Record<string, MealPlanCandidate[]> = {};
  for (const slot of remainingMeals) assignment[slot] = [];

  for (const food of selectedFoods) {
    const slot = food.mealSlot || remainingMeals[0];
    if (assignment[slot]) {
      assignment[slot].push(food);
    } else {
      assignment[remainingMeals[0]].push(food);
    }
  }

  // Rebalance: if any slot is empty, steal from the fullest
  for (const slot of remainingMeals) {
    if (assignment[slot].length === 0) {
      const heaviest = remainingMeals.reduce((a, b) =>
        (assignment[a] || []).length > (assignment[b] || []).length ? a : b
      );
      if (assignment[heaviest] && assignment[heaviest].length > 1) {
        const item = assignment[heaviest].pop();
        if (item) assignment[slot].push(item);
      }
    }
  }

  return assignment;
}

function assemblePlan(
  mealAssignment: Record<string, MealPlanCandidate[]>,
  pantryItems: any[],
  gapCoverage: any,
  remainingMeals: string[],
  llmPlan?: any,
) {
  const groceryList: any[] = [];
  const plan: any = {};

  for (const slot of remainingMeals) {
    const foods = mealAssignment[slot] || [];
    const mealItems: string[] = [];
    const mealNutrients: any = {};
    const fromPantry: any[] = [];
    const fromStore: any[] = [];

    for (const food of foods) {
      let displayStr = food.name;
      if (food.portionMultiplier && food.portionMultiplier !== 1) {
        displayStr = formatScaledPortion(food.name, food.portionMultiplier);
      }
      mealItems.push(displayStr);

      for (const [k, v] of Object.entries(food.scaledNutrients || {})) {
        if (typeof v === 'number') mealNutrients[k] = (mealNutrients[k] || 0) + v;
      }

      if (food.fromPantry) {
        fromPantry.push({
          food: food.name,
          pantryItem: (food as any).pantryItemName || food.name,
          usedPortion: displayStr,
        });
      } else {
        const forNutrients: any[] = [];
        const tg = (food as any).targets_gap;
        if (tg && gapCoverage[tg]) {
          forNutrients.push({ nutrient: tg, name: gapCoverage[tg].name, currentPct: gapCoverage[tg].currentPct });
        }

        fromStore.push({ food: food.name, forNutrients });

        if (!groceryList.some(g => g.food.toLowerCase() === food.name.toLowerCase())) {
          const portionNote = (food.portionMultiplier && food.portionMultiplier !== 1)
            ? `${Math.round(food.portionMultiplier * 100)}% portion`
            : '';
          groceryList.push({
            food: food.name,
            portion: portionNote,
            forMeals: [slot],
            forNutrients,
          });
        } else {
          const existing = groceryList.find(g => g.food.toLowerCase() === food.name.toLowerCase());
          if (existing && !existing.forMeals.includes(slot)) {
            existing.forMeals.push(slot);
          }
        }
      }
    }

    plan[slot] = {
      items: mealItems,
      nutrients: mealNutrients,
      fromPantry,
      fromStore,
    };
  }

  return { ...plan, groceryList };
}

function formatScaledPortion(foodString: string, multiplier: number) {
  if (!multiplier || Math.round(multiplier * 100) === 100) return foodString;
  const match = foodString.trim().match(/^(\d+(?:\.\d+)?(?:[/]\d+)?|\d+\s+\d+[/]\d+)\s+(.*)/);
  if (!match) {
    return `${foodString} (x${Math.round(multiplier * 10) / 10})`;
  }
  const numStr = match[1];
  const restStr = match[2];
  let num = 0;
  if (numStr.includes(' ')) {
    const [whole, frac] = numStr.split(' ');
    const [n, d] = frac.split('/');
    num = parseInt(whole) + parseInt(n) / parseInt(d);
  } else if (numStr.includes('/')) {
    const [n, d] = numStr.split('/');
    num = parseInt(n) / parseInt(d);
  } else {
    num = parseFloat(numStr);
  }
  const scaled = Math.round(num * multiplier * 10) / 10;
  return `${scaled} ${restStr}`;
}

// ── Variety: Query Recent Foods ──

/**
 * Extract food names from the last N days of actually logged meals.
 * Uses nutrition_logs (what the user really ate) instead of daily_meal_plans
 * (what was planned but may not have been followed).
 */
function queryRecentFoods(db: any, today: string, days: number): string[] {
  try {
    const rows = db.getAllSync(
      `SELECT log_name, items FROM nutrition_logs
       WHERE date(logged_at) < ? AND date(logged_at) >= date(?, '-' || ? || ' days')
       AND deleted_at IS NULL
       ORDER BY logged_at DESC`,
      [today, today, days]
    ) as any[];

    const foods: string[] = [];
    for (const row of rows) {
      // log_name is the primary food name
      const logName = (row.log_name || '').trim();
      if (logName && logName.length > 2) {
        // Strip portions like "1 cup cooked"
        const clean = logName.replace(/^\d+[\s/]*\d*\s*(cup|oz|tbsp|tsp|large|medium|small|slice|piece)s?\s+/i, '').trim();
        if (clean.length > 2) foods.push(clean.toLowerCase());
      }

      // Also extract individual items from the items JSON array
      if (row.items) {
        try {
          const items = JSON.parse(row.items);
          if (Array.isArray(items)) {
            for (const item of items) {
              const name = typeof item === 'string' ? item : (item.name || item.food || '');
              const clean = String(name).replace(/^\d+[\s/]*\d*\s*(cup|oz|tbsp|tsp|large|medium|small|slice|piece)s?\s+/i, '').trim();
              if (clean && clean.length > 2) foods.push(clean.toLowerCase());
            }
          }
        } catch {}
      }
    }

    // Deduplicate
    return [...new Set(foods)];
  } catch (e: any) {
    console.warn('[MealPlan] Failed to query recent foods for variety:', e.message);
    return [];
  }
}

// ── Slot-Level Re-generation ──

/**
 * Re-generate a single meal slot while preserving other slots.
 *
 * Used when a user dismisses a food item — only the affected slot
 * gets new candidates and re-solved, keeping the rest of the plan stable.
 *
 * @param slot - Which meal slot to regenerate (breakfast/lunch/dinner/snack)
 * @param excludedFoods - Foods to exclude (the dismissed items)
 * @param sessionPrefs - Optional temporary preferences
 */
export async function regenerateSlotPipeline(
  slot: string,
  excludedFoods: string[],
  sessionPrefs?: string,
) {
  const db = getDb();
  const today = new Date().toLocaleDateString('en-CA');

  // 0. Load brain
  let brain: any = null;
  try {
    const { getBrain } = require('../../brain/selector');
    brain = await getBrain();
  } catch (e: any) {
    throw new Error('Brain not available for slot regeneration');
  }

  // 1. Load current plan
  const existingRow = db.getFirstSync(
    `SELECT * FROM daily_meal_plans WHERE plan_date = ? ORDER BY id DESC LIMIT 1`,
    [today]
  ) as any;
  if (!existingRow) throw new Error('No existing meal plan to regenerate from');

  // 2. Gather context (same as main pipeline)
  const { LocalDataProvider } = require('../../providers/localDataProvider');
  const provider = new LocalDataProvider();
  const summary = await provider.getDailySummary(today);
  const gaps: NutrientGap[] = summary.gaps;

  const profile = db.getFirstSync(`SELECT * FROM nutrition_profile WHERE id = 1`) as any;
  let dislikedList: string[] = [];
  try {
    const parsed = JSON.parse(profile?.disliked_foods || '[]');
    dislikedList = Array.isArray(parsed)
      ? parsed.map((d: any) => typeof d === 'string' ? d : d.food || '').filter(Boolean)
      : [];
  } catch {
    dislikedList = [];
  }
  let dietPrefs: string[] = [];
  try { dietPrefs = JSON.parse(profile?.dietary_preferences || '[]'); } catch {}
  if (!Array.isArray(dietPrefs)) dietPrefs = [];

  const pantryRows = db.getAllSync(
    `SELECT id, item_name, quantity, unit, freshness FROM smart_pantry WHERE quantity > 0 ORDER BY item_name`
  ) as any[];

  const loggedRows = db.getAllSync(
    `SELECT log_name FROM nutrition_logs WHERE date(logged_at) = ? AND deleted_at IS NULL`,
    [today]
  ) as any[];

  const eatenStr = loggedRows.length > 0
    ? `ALREADY EATEN TODAY: ${loggedRows.map((r: any) => r.log_name || '').filter(Boolean).join(', ')}`
    : '';
  const pantryStr = pantryRows.length > 0
    ? pantryRows.map((p: any) => `${p.item_name} (${p.quantity}${p.unit || ''})`).join(', ')
    : 'Empty';

  const recentFoods = queryRecentFoods(db, today, 3);
  const season = getCurrentSeason();

  // 3. Generate candidates for just this slot
  const prompt = buildCandidatePrompt({
    remainingMeals: [slot],
    gaps,
    pantryStr,
    dislikedStr: [...dislikedList, ...excludedFoods].join(', '),
    eatenStr,
    dietPrefs,
    season,
    sessionPrefs,
    recentFoods: [...recentFoods, ...excludedFoods], // treat dismissed as "recent" too
  });

  const fallbackPlan: Record<string, any> = {};
  fallbackPlan[slot] = { candidates: [] };

  let llmPlan: any;
  try {
    llmPlan = await brain.json(prompt, {}, fallbackPlan);
  } catch {
    llmPlan = fallbackPlan;
  }

  // 4. USDA matching (same as main pipeline)
  const slotData = llmPlan[slot];
  const candidates = slotData?.candidates || [];
  const estimationPromises: Promise<any>[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const foodName = typeof cand === 'string' ? cand : cand.food;
    if (!foodName) continue;

    const pantryMatch = pantryRows.find((p: any) =>
      foodName.toLowerCase().includes((p.item_name || '').toLowerCase()) ||
      (p.item_name || '').toLowerCase().includes(foodName.toLowerCase().split(',')[0])
    );

    estimationPromises.push(
      (async () => {
        try {
          const result = await estimateNutrients(foodName, 100, '', true, brain);
          return { foodName, slot, index: i, cand, pantryMatch, result };
        } catch { return null; }
      })()
    );
  }

  const estimationResults = await Promise.all(estimationPromises);
  const allCandidates: MealPlanCandidate[] = [];
  for (const item of estimationResults) {
    if (!item) continue;
    const candidate = buildCandidateFromResult(item.foodName, item.result, item.slot, item.index, item.pantryMatch);
    if (item.cand.targets_gap) (candidate as any).targets_gap = item.cand.targets_gap;
    allCandidates.push(candidate);
  }

  if (allCandidates.length === 0) {
    throw new Error('No candidates generated for slot regeneration');
  }

  // 5. Solve for just this slot (with bio-awareness)
  const targetCalories = gaps.find(g => g.nutrient === 'calories');
  const solverConstraints = {
    targetCalories: targetCalories ? targetCalories.rda : 2000,
    dislikedFoods: [...dislikedList, ...excludedFoods],
    mealSlots: [slot],
    recentFoods: [...recentFoods, ...excludedFoods],
    excludedFoods,
  };

  const bioResult = solveMealPlanWithBioavailability(allCandidates, gaps, solverConstraints);

  // 6. Assemble just this slot
  const mealAssignment = assignToMeals(bioResult.selectedFoods, [slot]);
  const slotPlan = assemblePlan(mealAssignment, pantryRows, bioResult.adjustedCoverage, [slot]);

  // Generate cook tip for the slot
  if (brain) {
    const cookTips = await generateAllCookTips(brain, mealAssignment, gaps);
    if (cookTips[slot] && slotPlan[slot]) {
      slotPlan[slot].prepTip = cookTips[slot];
    }
  }

  // 7. Update only this slot in the stored plan
  db.runSync(
    `UPDATE daily_meal_plans SET ${slot} = ?, gap_coverage = ?, bioavailability_notes = ?, solver_metadata = ?, updated_at = datetime('now') WHERE id = ?`,
    [
      JSON.stringify(slotPlan[slot]),
      JSON.stringify(bioResult.adjustedCoverage),
      JSON.stringify(bioResult.bioNotes),
      JSON.stringify(bioResult.metadata),
      existingRow.id,
    ]
  );

  return { slot, plan: slotPlan[slot], coverage: bioResult.adjustedCoverage };
}
