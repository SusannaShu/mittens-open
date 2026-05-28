/**
 * Bioavailability-Aware MILP Solver
 *
 * Two-pass iterative approach:
 *   Pass 1: Run standard MILP solver
 *   Pass 2: Apply nutrient interactions (dose-dependent) per meal slot
 *           → identify nutrients that dropped below 70% coverage
 *   Pass 3: If nutrients dropped, inflate their RDA targets and re-solve
 *   Final:  Report adjusted coverage with bio notes
 *
 * Uses the scientifically-referenced, dose-dependent rules from
 * nutrientInteractions.ts as the single source of truth for
 * bioavailability adjustments (replaces the simpler rules in
 * mealPlanBioavailability.ts).
 *
 * Max 3 iterations to prevent infinite loops.
 */

import { solveMealPlan, MealPlanCandidate, NutrientGap, MealPlanConstraints, MealPlanResult, MealPlanCoverage } from './meal-plan-solver';
import { applyInteractions, AppliedInteraction } from '../../data/nutrientInteractions';

export interface BioSolverNote {
  meal: string;
  note: string;
  effect: 'positive' | 'negative';
  nutrient: string;
  trigger: string;
  factor: number;
}

export interface BioSolverResult {
  selectedFoods: MealPlanCandidate[];
  coverage: Record<string, MealPlanCoverage>;
  adjustedCoverage: Record<string, MealPlanCoverage>;
  bioNotes: BioSolverNote[];
  bindingConstraints: { type: string; nutrient: string; name: string }[];
  pantryUsage: any[];
  metadata: any;
  iterations: number;
}

/**
 * Assign selected foods to meal slots (same logic as mealPlanPipeline).
 */
function assignToSlots(
  selectedFoods: MealPlanCandidate[],
  mealSlots: string[],
): Record<string, MealPlanCandidate[]> {
  const assignment: Record<string, MealPlanCandidate[]> = {};
  for (const slot of mealSlots) assignment[slot] = [];

  for (const food of selectedFoods) {
    const slot = food.mealSlot || mealSlots[0];
    if (assignment[slot]) {
      assignment[slot].push(food);
    } else {
      assignment[mealSlots[0]].push(food);
    }
  }

  return assignment;
}

/**
 * Compute effective (bioavailability-adjusted) nutrients per meal slot
 * using the dose-dependent rules from nutrientInteractions.ts.
 */
function computeBioAdjustedNutrients(
  mealAssignment: Record<string, MealPlanCandidate[]>,
): {
  adjustedSlotNutrients: Record<string, Record<string, number>>;
  allInteractions: { slot: string; interactions: AppliedInteraction[] }[];
} {
  const adjustedSlotNutrients: Record<string, Record<string, number>> = {};
  const allInteractions: { slot: string; interactions: AppliedInteraction[] }[] = [];

  for (const [slot, foods] of Object.entries(mealAssignment)) {
    if (foods.length === 0) continue;

    // Build total meal nutrients for interaction detection
    const mealTotalNutrients: Record<string, number> = {};
    for (const food of foods) {
      const nutrients = food.scaledNutrients || food.nutrients || {};
      for (const [k, v] of Object.entries(nutrients)) {
        if (typeof v === 'number') {
          mealTotalNutrients[k] = (mealTotalNutrients[k] || 0) + v;
        }
      }
    }

    // Build food array for interaction detection (needs portion_g for phytate/oxalate dose calc)
    const foodArray = foods.map(f => ({
      name: f.name,
      portion_g: f.portion_g * (f.portionMultiplier || 1),
      nutrients: f.scaledNutrients || f.nutrients,
    }));

    // Apply interactions to the total meal nutrients
    const { adjusted, interactions } = applyInteractions(mealTotalNutrients, foodArray);

    adjustedSlotNutrients[slot] = adjusted;

    if (interactions.length > 0) {
      allInteractions.push({ slot, interactions });
    }
  }

  return { adjustedSlotNutrients, allInteractions };
}

/**
 * Compute adjusted coverage after bioavailability, using the interaction-adjusted
 * nutrient totals instead of raw solver output.
 */
function computeAdjustedCoverage(
  rawCoverage: Record<string, MealPlanCoverage>,
  gaps: NutrientGap[],
  rawSlotNutrients: Record<string, Record<string, number>>,
  adjustedSlotNutrients: Record<string, Record<string, number>>,
): Record<string, MealPlanCoverage> {
  const adjusted: Record<string, MealPlanCoverage> = JSON.parse(JSON.stringify(rawCoverage));

  for (const g of gaps) {
    const n = g.nutrient;
    if (!adjusted[n]) continue;

    // Sum raw and adjusted across all slots
    let rawTotal = 0;
    let adjTotal = 0;
    for (const slot of Object.keys(rawSlotNutrients)) {
      rawTotal += (rawSlotNutrients[slot]?.[n] || 0);
      adjTotal += (adjustedSlotNutrients[slot]?.[n] || 0);
    }

    if (rawTotal <= 0) continue;

    // Delta from bioavailability adjustments
    const delta = adjTotal - rawTotal;
    const newPlanAdds = adjusted[n].planAdds + delta;
    adjusted[n].planAdds = Math.round(newPlanAdds * 10) / 10;

    const newTotal = g.actual + newPlanAdds;
    const newPct = g.rda > 0 ? Math.round((newTotal / g.rda) * 100) : adjusted[n].afterPlanPct;
    adjusted[n].afterPlanPct = newPct;

    if (newPct >= 70) adjusted[n].status = 'covered';
    else if (newPct > adjusted[n].currentPct) adjusted[n].status = 'partial';
  }

  return adjusted;
}

/**
 * Convert interactions into user-facing bio notes.
 */
function interactionsToBioNotes(
  allInteractions: { slot: string; interactions: AppliedInteraction[] }[],
): BioSolverNote[] {
  const notes: BioSolverNote[] = [];

  for (const { slot, interactions } of allInteractions) {
    for (const ix of interactions) {
      notes.push({
        meal: slot,
        note: ix.reason,
        effect: ix.type === 'synergy' ? 'positive' : 'negative',
        nutrient: ix.target,
        trigger: ix.trigger,
        factor: ix.factor,
      });
    }
  }

  return notes;
}

/**
 * Identify nutrients that were "covered" by raw solver but dropped below 70%
 * after bioavailability adjustments.
 */
function findDroppedNutrients(
  rawCoverage: Record<string, MealPlanCoverage>,
  adjustedCoverage: Record<string, MealPlanCoverage>,
): { nutrient: string; rawPct: number; adjPct: number; absorptionFactor: number }[] {
  const dropped: { nutrient: string; rawPct: number; adjPct: number; absorptionFactor: number }[] = [];

  for (const [nutrient, raw] of Object.entries(rawCoverage)) {
    const adj = adjustedCoverage[nutrient];
    if (!adj) continue;

    // Only care about nutrients that the solver thought it covered but bio says otherwise
    if (raw.afterPlanPct >= 70 && adj.afterPlanPct < 70) {
      // Calculate the effective absorption factor
      const absorptionFactor = raw.planAdds > 0
        ? Math.max(0.1, adj.planAdds / raw.planAdds)
        : 1;
      dropped.push({ nutrient, rawPct: raw.afterPlanPct, adjPct: adj.afterPlanPct, absorptionFactor });
    }
  }

  return dropped;
}

/**
 * Inflate gap targets to compensate for bioavailability losses.
 * If iron has 0.7x absorption, inflate iron RDA by 1/0.7 so the solver
 * selects enough iron to actually hit the target after losses.
 */
function inflateGaps(
  gaps: NutrientGap[],
  droppedNutrients: { nutrient: string; absorptionFactor: number }[],
): NutrientGap[] {
  const dropMap = new Map(droppedNutrients.map(d => [d.nutrient, d.absorptionFactor]));

  return gaps.map(g => {
    const factor = dropMap.get(g.nutrient);
    if (!factor || factor >= 1) return g;

    // Inflate RDA to compensate: need RDA/factor to actually get RDA after losses
    const inflatedRda = Math.round((g.rda / factor) * 10) / 10;
    return { ...g, rda: inflatedRda };
  });
}

/**
 * Solve meal plan with bioavailability awareness.
 *
 * Iteratively runs the MILP solver and checks bioavailability adjustments.
 * If nutrient absorption losses cause gaps, inflates targets and re-solves.
 *
 * @param candidates - Food candidates with nutrients
 * @param gaps - Current nutrient gaps
 * @param constraints - Solver constraints
 * @param maxIterations - Max solve passes (default 3)
 * @returns Result with bio-adjusted coverage and notes
 */
export function solveMealPlanWithBioavailability(
  candidates: MealPlanCandidate[],
  gaps: NutrientGap[],
  constraints: MealPlanConstraints,
  maxIterations: number = 3,
): BioSolverResult {
  let currentGaps = gaps;
  let bestResult: MealPlanResult | null = null;
  let bestAdjustedCoverage: Record<string, MealPlanCoverage> = {};
  let bestBioNotes: BioSolverNote[] = [];
  let iterations = 0;

  const mealSlots = constraints.mealSlots || ['snack'];

  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;

    // 1. Run MILP solver
    const result = solveMealPlan(candidates, currentGaps, constraints);
    if (!result.selectedFoods.length) {
      // No solution — return whatever we have
      if (bestResult) break;
      return {
        selectedFoods: [],
        coverage: result.coverage,
        adjustedCoverage: result.coverage,
        bioNotes: [],
        bindingConstraints: result.bindingConstraints,
        pantryUsage: result.pantryUsage,
        metadata: { ...result.metadata, bioIterations: iterations },
        iterations,
      };
    }

    // 2. Assign to slots and compute raw per-slot nutrients
    const assignment = assignToSlots(result.selectedFoods, mealSlots);
    const rawSlotNutrients: Record<string, Record<string, number>> = {};
    for (const [slot, foods] of Object.entries(assignment)) {
      const slotN: Record<string, number> = {};
      for (const food of foods) {
        for (const [k, v] of Object.entries(food.scaledNutrients || {})) {
          if (typeof v === 'number') slotN[k] = (slotN[k] || 0) + v;
        }
      }
      rawSlotNutrients[slot] = slotN;
    }

    // 3. Apply bioavailability interactions
    const { adjustedSlotNutrients, allInteractions } = computeBioAdjustedNutrients(assignment);

    // 4. Compute adjusted coverage
    const adjustedCoverage = computeAdjustedCoverage(
      result.coverage, gaps, rawSlotNutrients, adjustedSlotNutrients,
    );

    const bioNotes = interactionsToBioNotes(allInteractions);

    // Track best result
    bestResult = result;
    bestAdjustedCoverage = adjustedCoverage;
    bestBioNotes = bioNotes;

    // 5. Check if any nutrients dropped below 70% due to bioavailability
    const dropped = findDroppedNutrients(result.coverage, adjustedCoverage);

    if (dropped.length === 0) {
      // Converged — bioavailability didn't significantly hurt coverage
      break;
    }

    if (i === maxIterations - 1) {
      // Last iteration — use whatever we have
      console.warn(
        `[BioSolver] Did not converge after ${maxIterations} iterations. ` +
        `Dropped nutrients: ${dropped.map(d => `${d.nutrient}: ${d.rawPct}% → ${d.adjPct}%`).join(', ')}`
      );
      break;
    }

    // 6. Inflate targets and re-solve
    console.log(
      `[BioSolver] Pass ${i + 1}: ${dropped.length} nutrients dropped after bio adjustment. ` +
      `Inflating: ${dropped.map(d => `${d.nutrient} (x${(1 / d.absorptionFactor).toFixed(2)})`).join(', ')}`
    );
    currentGaps = inflateGaps(currentGaps, dropped);
  }

  return {
    selectedFoods: bestResult!.selectedFoods,
    coverage: bestResult!.coverage,
    adjustedCoverage: bestAdjustedCoverage,
    bioNotes: bestBioNotes,
    bindingConstraints: bestResult!.bindingConstraints,
    pantryUsage: bestResult!.pantryUsage,
    metadata: { ...bestResult!.metadata, bioIterations: iterations },
    iterations,
  };
}
