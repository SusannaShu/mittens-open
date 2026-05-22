/**
 * useNutrientPipeline -- Per-food async nutrient estimation state management.
 *
 * After food identification, this hook:
 * 1. Kicks off estimateNutrients() for each food independently
 * 2. Applies USDA retention factors + nutrient interaction rules
 * 3. Updates the pipeline state per food as each completes
 * 4. Supports cancel + restart when user edits a food name
 */

import { useRef, useCallback } from 'react';
import { FoodPipelineItem, FoodPipelineStatus } from '../../components/chat/MealPipelineCard';
import { getInferenceProvider, getAgentEnabled, getAgentProvider } from '../providers/providerFactory';
import { lookupRetention, applyRetention } from '../data/retentionFactors';
import { applyInteractions } from '../data/nutrientInteractions';
import { lookupUSDAAll, scaleNutrients, USDAReference, estimateNutrients, flattenNutrients } from '../services/food/nutrientEstimator';
import type { FoodIdentification, NutrientEstimate } from '../providers/inferenceProvider';

// Track abort controllers per food (messageId-foodIndex)
type AbortMap = Map<string, AbortController>;

interface PipelineCallbacks {
  /** Update a single food's pipeline state in messages */
  updateFood: (messageId: string, index: number, updates: Partial<FoodPipelineItem>) => void;
  /** Update all foods for a message at once */
  updateAllFoods: (messageId: string, foods: FoodPipelineItem[]) => void;
  /** Triggered when all foods in a message have completed estimation */
  onPipelineComplete?: (messageId: string, foods: FoodPipelineItem[]) => void;
}

/**
 * Convert FoodIdentification result to initial pipeline state
 */
export function foodIdToPipeline(foodResult: FoodIdentification): FoodPipelineItem[] {
  return foodResult.foods.map(f => ({
    name: f.name,
    portion_g: f.portion_g,
    household_portion: f.household_portion,
    cooking: f.cooking,
    confidence: f.confidence ?? 0.8,
    status: 'idle' as FoodPipelineStatus,
  }));
}

export function useNutrientPipeline(callbacks: PipelineCallbacks) {
  const abortMap = useRef<AbortMap>(new Map());

  /**
   * Run nutrient estimation for a single food item.
   * Updates the message state as it progresses.
   */
  const estimateOne = useCallback(async (
    messageId: string,
    index: number,
    food: FoodPipelineItem,
    allFoods: FoodPipelineItem[],
  ) => {
    const key = `${messageId}-${index}`;
    console.log('[NutrientPipeline] estimateOne START:', key, food.name);

    // Cancel any existing estimation for this food
    const existing = abortMap.current.get(key);
    if (existing) existing.abort();

    const controller = new AbortController();
    abortMap.current.set(key, controller);

    // Mark as estimating
    callbacks.updateFood(messageId, index, { status: 'estimating' });

    try {
      if (controller.signal.aborted) return;

      // ── Centralized Brain-Driven USDA matching cascade and estimation ──
      console.log('[NutrientPipeline] estimateOne executing estimateNutrients for:', food.name);
      
      const res = await estimateNutrients(
        food.name,
        food.portion_g,
        food.cooking || '',
        true, // useAI
      );

      if (controller.signal.aborted) return;

      const nutrients = flattenNutrients(res.nutrients);
      
      // Calculate usdaNutrients if matched. If not matched, fall back to closest reference for side-by-side
      let usdaNutrients: Record<string, number> | undefined;
      const usedRef = res.meta.usedReference;
      
      if (usedRef) {
        const scaledUsda = scaleNutrients(usedRef.per100g, food.portion_g);
        usdaNutrients = {};
        for (const [k, v] of Object.entries(scaledUsda)) {
          usdaNutrients[k] = v ?? 0;
        }
      } else if (res.meta.allReferences && res.meta.allReferences.length > 0) {
        const closestRef = res.meta.allReferences[0];
        const scaledUsda = scaleNutrients(closestRef.per100g, food.portion_g);
        usdaNutrients = {};
        for (const [k, v] of Object.entries(scaledUsda)) {
          usdaNutrients[k] = v ?? 0;
        }
      }

      const allRefsWithData = res.meta.allReferences.map(r => ({
        fdcId: r.fdcId,
        name: r.name,
        category: r.category,
        score: r.score,
        per100g: r.per100g as unknown as Record<string, number | null>,
      }));

      const adjustments = res.meta.adjustments;
      const reasoning = res.meta.reasoning;

      // ── Phase 3a: Apply USDA retention factors (cooking loss) ──
      let retentionChanges: FoodPipelineItem['retentionChanges'];
      let cookingSeverity: number | undefined;
      let cookingMethod: string | undefined;
      
      let adjustedNutrients = { ...nutrients };
      if (food.cooking) {
        const retention = lookupRetention(food.name, food.cooking);
        if (retention) {
          const result = applyRetention(adjustedNutrients, retention.factors);
          adjustedNutrients = result.adjusted;
          retentionChanges = result.changes.length > 0 ? result.changes : undefined;
          cookingSeverity = retention.severity;
          cookingMethod = retention.method;
        }
      }

      if (controller.signal.aborted) return;

      // Mark as complete (interactions applied later after all foods finish)
      callbacks.updateFood(messageId, index, {
        status: 'complete',
        nutrients: adjustedNutrients,
        usdaNutrients,
        usedRef: usedRef ? { fdcId: usedRef.fdcId, name: usedRef.name, score: usedRef.score } : undefined,
        allRefs: allRefsWithData,
        adjustments,
        reasoning,
        retentionChanges,
        cookingSeverity,
        cookingMethod,
      });

      console.log('[NutrientPipeline] DONE:', food.name,
        usedRef ? `USDA "${usedRef.name}" (${usedRef.score})` : 'AI estimate',
        Object.keys(adjustedNutrients).length, 'nutrients');
      return { index, nutrients: adjustedNutrients, name: food.name, portion_g: food.portion_g };

    } catch (err: any) {
      console.log('[NutrientPipeline] ERROR:', food.name, err?.message);
      if (controller.signal.aborted) return;
      callbacks.updateFood(messageId, index, { status: 'error' });
    } finally {
      abortMap.current.delete(key);
    }
  }, [callbacks]);

  /**
   * Start the pipeline for all foods in a message.
   * Each food runs independently in parallel.
   */
  const startPipeline = useCallback(async (
    messageId: string,
    foods: FoodPipelineItem[],
  ) => {
    // Phase 2 + 3a run in parallel per food
    const results = await Promise.all(
      foods.map((food, i) => estimateOne(messageId, i, food, foods))
    );

    // Phase 3b: Cross-food interactions (after ALL foods have nutrients)
    const completedFoods = results.filter(Boolean) as Array<{ index: number; nutrients: Record<string, number>; name: string; portion_g: number }>;
    if (completedFoods.length <= 1) return; // Need 2+ foods for interactions

    const allFoodData = completedFoods.map(f => ({ name: f.name, portion_g: f.portion_g, nutrients: f.nutrients }));

    for (const food of completedFoods) {
      const interResult = applyInteractions(food.nutrients, allFoodData);
      if (interResult.interactions.length > 0) {
        callbacks.updateFood(messageId, food.index, {
          nutrients: interResult.adjusted,
          interactionChanges: interResult.interactions,
        });
        console.log('[NutrientPipeline] Interactions for', food.name, ':', interResult.interactions.length, 'effects');
        // Update the local copy for the completion callback
        food.nutrients = interResult.adjusted;
      }
    }

    // Pipeline is complete, trigger persistence via callback
    // We pass the fresh state of the foods
    if (callbacks.onPipelineComplete) {
      // Re-construct the full food list to pass back
      const finalFoods = foods.map((f, i) => {
        const completed = completedFoods.find(cf => cf.index === i);
        if (completed) {
          return { ...f, nutrients: completed.nutrients, status: 'complete' as const };
        }
        return f;
      });
      callbacks.onPipelineComplete(messageId, finalFoods);
    }
  }, [estimateOne, callbacks]);

  /**
   * Handle food name edit: cancel old estimation, restart with new name.
   */
  const restartFood = useCallback(async (
    messageId: string,
    index: number,
    newName: string,
    allFoods: FoodPipelineItem[],
  ) => {
    // Cancel existing
    const key = `${messageId}-${index}`;
    const existing = abortMap.current.get(key);
    if (existing) existing.abort();

    // Update the food with new name and reset state
    const updatedFood: FoodPipelineItem = {
      ...allFoods[index],
      name: newName,
      status: 'idle',
      nutrients: undefined,
      usedRef: undefined,
      allRefs: undefined,
      adjustments: undefined,
      reasoning: undefined,
      retentionChanges: undefined,
      interactionChanges: undefined,
    };

    callbacks.updateFood(messageId, index, updatedFood);

    // Restart estimation
    const updatedFoods = [...allFoods];
    updatedFoods[index] = updatedFood;
    const result = await estimateOne(messageId, index, updatedFood, updatedFoods);
    
    // Check if pipeline is now complete
    if (result && callbacks.onPipelineComplete) {
       // Since the other foods might be unchanged, we can construct the final array
       // Note: we don't re-run interactions here for simplicity, but we save the updated result
       const finalFoods = [...allFoods];
       finalFoods[index] = { ...finalFoods[index], nutrients: result.nutrients, status: 'complete' };
       callbacks.onPipelineComplete(messageId, finalFoods);
    }
  }, [callbacks, estimateOne]);

  /**
   * Remove a food from the pipeline.
   */
  const removeFood = useCallback((
    messageId: string,
    index: number,
    allFoods: FoodPipelineItem[],
  ) => {
    const key = `${messageId}-${index}`;
    const existing = abortMap.current.get(key);
    if (existing) existing.abort();
    abortMap.current.delete(key);

    const updated = allFoods.filter((_, i) => i !== index);
    callbacks.updateAllFoods(messageId, updated);
    
    if (callbacks.onPipelineComplete && updated.every(f => f.status === 'complete')) {
       callbacks.onPipelineComplete(messageId, updated);
    }
  }, [callbacks]);

  /**
   * Handle portion edit: cancel old estimation, restart with new portion.
   */
  const restartFoodPortion = useCallback(async (
    messageId: string,
    index: number,
    newPortionG: number,
    allFoods: FoodPipelineItem[],
  ) => {
    const key = `${messageId}-${index}`;
    const existing = abortMap.current.get(key);
    if (existing) existing.abort();

    const updatedFood: FoodPipelineItem = {
      ...allFoods[index],
      portion_g: newPortionG,
      household_portion: `${newPortionG}g`,
      status: 'idle',
      nutrients: undefined,
      usdaNutrients: undefined,
      usedRef: undefined,
      allRefs: undefined,
      adjustments: undefined,
      reasoning: undefined,
      retentionChanges: undefined,
      interactionChanges: undefined,
    };

    callbacks.updateFood(messageId, index, updatedFood);

    const updatedFoods = [...allFoods];
    updatedFoods[index] = updatedFood;
    const result = await estimateOne(messageId, index, updatedFood, updatedFoods);
    
    if (result && callbacks.onPipelineComplete) {
       const finalFoods = [...allFoods];
       finalFoods[index] = { ...finalFoods[index], nutrients: result.nutrients, status: 'complete' };
       callbacks.onPipelineComplete(messageId, finalFoods);
    }
  }, [callbacks, estimateOne]);

  /**
   * Add a new food to an existing pipeline.
   */
  const addFood = useCallback(async (
    messageId: string,
    foodName: string,
    allFoods: FoodPipelineItem[],
  ) => {
    const newFood: FoodPipelineItem = {
      name: foodName,
      portion_g: 100,
      confidence: 1,
      status: 'idle',
    };

    const updated = [...allFoods, newFood];
    callbacks.updateAllFoods(messageId, updated);

    // Start estimation for the new food
    const newIndex = updated.length - 1;
    const result = await estimateOne(messageId, newIndex, newFood, updated);
    
    if (result && callbacks.onPipelineComplete) {
       const finalFoods = [...updated];
       finalFoods[newIndex] = { ...finalFoods[newIndex], nutrients: result.nutrients, status: 'complete' };
       if (finalFoods.every(f => f.status === 'complete')) {
         callbacks.onPipelineComplete(messageId, finalFoods);
       }
    }
  }, [callbacks, estimateOne]);

  /**
   * Replace a food directly with a selected USDA match.
   */
  const replaceWithUsda = useCallback((
    messageId: string,
    index: number,
    usdaFood: USDAReference & { amountGram: number, customName?: string },
    allFoods: FoodPipelineItem[],
  ) => {
    const key = `${messageId}-${index}`;
    const existing = abortMap.current.get(key);
    if (existing) existing.abort();
    abortMap.current.delete(key);

    const scaled = scaleNutrients(usdaFood.per100g, usdaFood.amountGram);
    const nutrients: Record<string, number> = {};
    for (const [k, v] of Object.entries(scaled)) {
      nutrients[k] = v ?? 0;
    }

    const updatedFood: FoodPipelineItem = {
      ...allFoods[index],
      name: usdaFood.customName || usdaFood.name,
      portion_g: usdaFood.amountGram,
      household_portion: `${usdaFood.amountGram}g`,
      status: 'complete',
      nutrients,
      usdaNutrients: { ...nutrients },
      usedRef: { fdcId: usdaFood.fdcId, name: usdaFood.name, score: 1 },
      reasoning: `User manually selected USDA match: ${usdaFood.name}`,
    };

    const updated = [...allFoods];
    updated[index] = updatedFood;
    callbacks.updateAllFoods(messageId, updated);

    if (callbacks.onPipelineComplete && updated.every(f => f.status === 'complete')) {
      callbacks.onPipelineComplete(messageId, updated);
    }
  }, [callbacks]);

  /**
   * Cancel all running estimations for a message.
   */
  const cancelAll = useCallback((messageId: string, foodCount: number) => {
    for (let i = 0; i < foodCount; i++) {
      const key = `${messageId}-${i}`;
      const existing = abortMap.current.get(key);
      if (existing) existing.abort();
      abortMap.current.delete(key);
    }
  }, []);

  return { startPipeline, restartFood, restartFoodPortion, addFood, removeFood, replaceWithUsda, cancelAll };
}
