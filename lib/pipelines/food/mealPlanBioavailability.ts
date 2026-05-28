/**
 * Meal Plan Bioavailability — Thin wrapper around nutrientInteractions.ts
 *
 * This module provides the same interface as before (applyBioavailability),
 * but delegates to the dose-dependent, scientifically-referenced rules
 * in nutrientInteractions.ts instead of maintaining duplicate logic.
 *
 * This is the single source of truth for bioavailability adjustments
 * across both the meal plan solver and the chat pipeline.
 */

import { MealPlanCoverage, NutrientGap } from './meal-plan-solver';
import { applyInteractions, AppliedInteraction } from '../../data/nutrientInteractions';

export interface BioavailabilityNote {
  meal: string;
  note: string;
  effect: 'positive' | 'negative';
  nutrient: string;
  ruleId: string;
}

/**
 * Apply bioavailability adjustments to a meal plan's coverage.
 *
 * Delegates to nutrientInteractions.ts applyInteractions() for each meal slot,
 * computing dose-dependent nutrient interaction effects.
 *
 * @param mealPlan - Per-slot meal data with items and nutrient totals
 * @param gapCoverage - Raw solver coverage (will be adjusted)
 * @param gaps - Original nutrient gaps
 * @returns adjustedCoverage and user-facing notes
 */
export function applyBioavailability(
  mealPlan: Record<string, { items: any[]; nutrients: Record<string, number> }>,
  gapCoverage: Record<string, MealPlanCoverage>,
  gaps: NutrientGap[]
): { adjustedCoverage: Record<string, MealPlanCoverage>; notes: BioavailabilityNote[] } {
  const notes: BioavailabilityNote[] = [];
  const adjustedCoverage: Record<string, MealPlanCoverage> = JSON.parse(JSON.stringify(gapCoverage));
  const gapMap: Record<string, NutrientGap> = {};
  for (const g of gaps) gapMap[g.nutrient] = g;

  const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

  for (const slot of MEAL_SLOTS) {
    const meal = mealPlan[slot];
    if (!meal) continue;

    const mealItems = meal.items || [];
    const mealNutrients = meal.nutrients || {};

    if (mealItems.length === 0) continue;

    // Build food array for interaction detection
    // Each item may be a string (name) or an object with name/portion_g/nutrients
    const foodArray = mealItems.map((item: any) => {
      const name = typeof item === 'string' ? item : (item.name || item);
      return {
        name: String(name),
        portion_g: item.portion_g || 100,
        nutrients: item.nutrients || mealNutrients,
      };
    });

    // Apply dose-dependent interactions
    const { adjusted, interactions } = applyInteractions(mealNutrients, foodArray);

    // Convert interactions to user-facing notes
    for (const ix of interactions) {
      notes.push({
        meal: slot,
        note: ix.reason,
        effect: ix.type === 'synergy' ? 'positive' : 'negative',
        nutrient: ix.target,
        ruleId: `${ix.trigger}_${ix.target}`,
      });
    }

    // Apply nutrient deltas to coverage
    for (const ix of interactions) {
      const nutrient = ix.target;
      if (!adjustedCoverage[nutrient]) continue;

      const gap = gapMap[nutrient];
      if (!gap) continue;

      const delta = ix.afterValue - ix.beforeValue;
      const planAdds = (adjustedCoverage[nutrient].planAdds || 0) + delta;
      adjustedCoverage[nutrient].planAdds = Math.round(planAdds * 10) / 10;

      const newTotal = gap.actual + planAdds;
      const newPct = gap.rda > 0 ? Math.round((newTotal / gap.rda) * 100) : adjustedCoverage[nutrient].afterPlanPct;
      adjustedCoverage[nutrient].afterPlanPct = newPct;

      if (newPct >= 70) adjustedCoverage[nutrient].status = 'covered';
      else if (newPct > adjustedCoverage[nutrient].currentPct) adjustedCoverage[nutrient].status = 'partial';
    }
  }

  return { adjustedCoverage, notes };
}
