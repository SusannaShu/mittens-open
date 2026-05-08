/**
 * Food Pipeline Phase 2: NUTRIENTS
 *
 * Estimate nutritional content for identified foods.
 * Uses USDA database lookup first (ZERO AI tokens), falls back to AI
 * estimation only when USDA match is poor.
 *
 * MIGRATED FROM:
 *   gemmaLocalProvider.estimateNutrients() → USDA-first approach
 *   lib/services/food/nutrientEstimator.ts → the actual USDA lookup
 *   geminiVision.estimateNutrients() (Backend) → the AI fallback
 *
 * KEY DESIGN:
 *   - USDA lookup is deterministic and free (no AI call)
 *   - Only uses brain.text() when USDA match score < threshold
 *   - Returns full audit trail: which USDA entry, what adjustments, why
 *   - User can tap any nutrient to see the reasoning
 *
 * INPUTS:
 *   - food: { name, portion_g, cooking } from Phase 1
 *
 * OUTPUTS:
 *   - NutrientResult: 20 nutrient values + full metadata
 *
 * RE-RUN TRIGGER:
 *   User edits food name, portion, or cooking method → re-run this phase.
 *   No need to redo Phase 1 (identification).
 */

import type { NutrientResult } from '../types';

/**
 * Estimate nutrients for a single food item.
 *
 * Strategy:
 *   1. Search local USDA database for closest match
 *   2. If good match (score > 0.7): scale to portion, adjust for cooking
 *   3. If poor match: use brain.text() to estimate (costs tokens)
 *   4. Return full audit trail either way
 */
export async function estimateNutrients(
  food: { name: string; portion_g: number; cooking?: string },
): Promise<NutrientResult> {
  // Use the existing USDA-first estimator
  const { estimateNutrients: estimateUSDA, flattenNutrients } =
    require('../../services/food/nutrientEstimator');

  const result = await estimateUSDA(food.name, food.portion_g, food.cooking || '');
  const { allReferences, usedReference, adjustments, reasoning } = result.meta;

  return {
    nutrients: flattenNutrients(result.nutrients),
    meta: {
      source: allReferences.length > 0 ? 'usda_ref' : 'ai_estimate',
      usedRef: usedReference ? {
        fdcId: usedReference.fdcId,
        name: usedReference.name,
        score: usedReference.score,
      } : undefined,
      allRefs: allReferences.map((r: any) => ({
        fdcId: r.fdcId, name: r.name, score: r.score,
      })),
      adjustments: adjustments.map((a: any) => ({
        nutrient: a.key,
        usdaValue: a.usdaValue,
        adjustedValue: a.adjustedValue,
        reason: a.reason,
      })),
      reasoning,
    },
  };
}

/**
 * Batch estimate nutrients for multiple foods.
 * Runs in parallel since each lookup is independent.
 */
export async function estimateNutrientsBatch(
  foods: Array<{ name: string; portion_g: number; cooking?: string }>,
): Promise<NutrientResult[]> {
  return Promise.all(foods.map(estimateNutrients));
}
