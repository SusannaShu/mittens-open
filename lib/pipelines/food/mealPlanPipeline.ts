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
import {
  buildCandidatePrompt,
  getCurrentSeason,
  getServingG,
  inferSourceType,
  buildCandidateFromResult,
} from './candidateGenerator';
import { estimateNutrients } from '../../services/food/nutrientEstimator';
import { recommendSupplements } from './supplementRecommender';
import { estimateVitaminDSynthesis, recommendSunExposure } from '../../services/vitaminDSynthesis';

export async function generateMealPlanPipeline(
  userId: string,
  gaps: NutrientGap[],
  customConstraint?: string
) {
  const db = getDb();
  const today = new Date().toLocaleDateString('en-CA');

  // ── 1. Gather context ──
  const loggedRows = db.getAllSync(
    `SELECT log_name, items, meal_type FROM nutrition_logs WHERE date(logged_at) = ? AND deleted_at IS NULL ORDER BY logged_at ASC`,
    [today]
  ) as any[];

  const eatenMealTypes = new Set(loggedRows.map(m => (m.meal_type || '').toLowerCase()).filter(Boolean));
  const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'];
  const remainingMeals = MEAL_SLOTS.filter(slot => !eatenMealTypes.has(slot));

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
  const prompt = buildCandidatePrompt({
    remainingMeals,
    gaps,
    pantryStr,
    dislikedStr,
    eatenStr,
    dietPrefs,
    season,
  });

  // Build fallback structure
  const fallbackPlan: Record<string, any> = {};
  for (const slot of remainingMeals) {
    fallbackPlan[slot] = { candidates: [], cookTip: '' };
  }

  let llmPlan: Record<string, { candidates: Array<{ food: string; targets_gap?: string; fromPantry?: boolean }>; cookTip?: string }>;
  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();
    llmPlan = await brain.json(prompt, {}, fallbackPlan);
  } catch (e: any) {
    console.warn('[MealPlan] LLM candidate gen failed, using fallback:', e.message);
    llmPlan = fallbackPlan;
  }

  // ── 3. Parallelized USDA Brain-Driven Matching & Estimation ──
  let brain: any = null;
  try {
    const { getBrain } = require('../../brain/selector');
    brain = await getBrain();
  } catch (e: any) {
    console.warn('[MealPlan] Failed to load active brain for planning:', e.message);
  }

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
  };

  const solverResult = solveMealPlan(allCandidates, gaps, solverConstraints);

  // ── 6. Bioavailability ──
  const mealAssignment = assignToMeals(solverResult.selectedFoods, remainingMeals);
  const mealPlanForBio: any = {};
  for (const slot of remainingMeals) {
    const foods = mealAssignment[slot] || [];
    const mealNutrients: any = {};
    for (const food of foods) {
      for (const [k, v] of Object.entries(food.scaledNutrients || {})) {
        if (typeof v === 'number') mealNutrients[k] = (mealNutrients[k] || 0) + v;
      }
    }
    mealPlanForBio[slot] = {
      items: foods.map((f: any) => ({ name: f.name })),
      nutrients: mealNutrients,
    };
  }

  const { adjustedCoverage, notes: bioNotes } = applyBioavailability(
    mealPlanForBio, solverResult.coverage, gaps
  );

  // ── 7. Assemble ──
  const assembledPlan = assemblePlan(mealAssignment, pantryRows, adjustedCoverage, remainingMeals, llmPlan);

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
      const skinType = profile?.skin_type || 'fitzpatrick-4';
      const deficitMcg = Math.max(0, vitDGap.rda - vitDGap.actual);

      if (uvIndex >= 3) {
        vitaminDRec = recommendSunExposure({ deficitMcg, uvIndex, skinType });
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
    solver_metadata: JSON.stringify(solverResult.metadata),
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
      solverMetadata: solverResult.metadata,
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

    // Add cook tip from LLM if available
    const cookTip = llmPlan?.[slot]?.cookTip;

    plan[slot] = {
      items: mealItems,
      nutrients: mealNutrients,
      fromPantry,
      fromStore,
      ...(cookTip ? { prepTip: cookTip } : {}),
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
