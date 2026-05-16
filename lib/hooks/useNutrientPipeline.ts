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
import { lookupUSDAAll, scaleNutrients } from '../services/food/nutrientEstimator';
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

      // ── Phase 2: USDA lookup ──

      const usdaRefs = lookupUSDAAll(food.name, 0.4); // low threshold to get candidates
      console.log('[NutrientPipeline] USDA lookup:', food.name, '→', usdaRefs.length, 'matches',
        usdaRefs[0] ? `best: "${usdaRefs[0].name}" (${usdaRefs[0].score})` : 'none');

      // Build allRefs with per100g data for UI switching
      const allRefsWithData = usdaRefs.map(r => ({
        fdcId: r.fdcId,
        name: r.name,
        category: r.category,
        score: r.score,
        per100g: r.per100g as unknown as Record<string, number | null>,
      }));

      let nutrients: Record<string, number> = {};
      let usdaNutrients: Record<string, number> | undefined;
      let usedRef: typeof usdaRefs[0] | undefined;
      let adjustments: any[] | undefined;
      let reasoning: string | undefined;

      if (usdaRefs.length > 0) {
        // Always let AI pick the best USDA match from candidates
        console.log('[NutrientPipeline] Asking AI to pick from', usdaRefs.length, 'candidates for:', food.name);
        const agentOn = await getAgentEnabled();
        const provider = (agentOn && getAgentProvider()) || await getInferenceProvider();

        const candidateNames = usdaRefs.slice(0, 8).map((r, i) => `${i + 1}. ${r.name}`).join('\n');
        const pickPrompt = `Food from photo: "${food.name}" (${food.portion_g}g, ${food.cooking || 'unknown preparation'}).

Which USDA database entry best matches this SPECIFIC food? Consider the actual food, not just keyword overlap.
For example, "vegetable rolls" are ROLLS with vegetable filling, NOT canned vegetables.

Reply with ONLY the number. If NONE are a good match, reply "0".

${candidateNames}`;

        try {
          const pickResponse = await provider.generateRaw(pickPrompt);
          const pickNum = parseInt(pickResponse.replace(/\D/g, ''), 10);

          if (pickNum > 0 && pickNum <= usdaRefs.length) {
            usedRef = usdaRefs[pickNum - 1];
            const scaled = scaleNutrients(usedRef.per100g, food.portion_g);
            nutrients = {};
            usdaNutrients = {};
            for (const [k, v] of Object.entries(scaled)) {
              nutrients[k] = v ?? 0;
              usdaNutrients[k] = v ?? 0;
            }
            reasoning = `AI selected USDA "${usedRef.name}" from ${usdaRefs.length} candidates`;
            console.log('[NutrientPipeline] AI picked:', usedRef.name);
          } else {
            // AI rejected all candidates -- try AI-suggested USDA names
            console.log('[NutrientPipeline] AI rejected all candidates for:', food.name, '-- trying AI name search');
            const suggestPrompt = `The food "${food.name}" (${food.cooking || 'unknown prep'}) didn't match well in our USDA database.
Suggest 3 official USDA food names that best match this food.
Format each line as: name | confidence
Example: Rolls, dinner, wheat | 80

Only the 3 best guesses:`;
            const suggestResponse = await provider.generateRaw(suggestPrompt);
            const suggestions = suggestResponse.split('\n')
              .map(l => {
                const cleaned = l.replace(/^\d+[\.)\s]*/, '').trim();
                const parts = cleaned.split('|');
                return { name: parts[0]?.trim() || '', confidence: parseInt(parts[1]?.trim() || '50', 10) };
              })
              .filter(s => s.name.length > 2)
              .sort((a, b) => b.confidence - a.confidence);

            // Re-search USDA with AI-suggested names
            let found = false;
            for (const suggestion of suggestions.slice(0, 3)) {
              const reRefs = lookupUSDAAll(suggestion.name, 0.4);
              if (reRefs.length > 0) {
                const mappedRefs = reRefs.map(r => ({
                  fdcId: r.fdcId,
                  name: r.name,
                  category: r.category,
                  score: r.score,
                  per100g: r.per100g as unknown as Record<string, number | null>,
                }));
                usedRef = mappedRefs[0];
                allRefsWithData.push(...mappedRefs.filter(r => !allRefsWithData.some(a => a.fdcId === r.fdcId)));
                const scaled = scaleNutrients(usedRef.per100g, food.portion_g);
                nutrients = {};
                usdaNutrients = {};
                for (const [k, v] of Object.entries(scaled)) {
                  nutrients[k] = v ?? 0;
                  usdaNutrients[k] = v ?? 0;
                }
                reasoning = `AI searched USDA for "${suggestion.name}" -> "${usedRef.name}"`;
                console.log('[NutrientPipeline] AI re-search found:', usedRef.name);
                found = true;
                break;
              }
            }

            if (!found) {
              // Final fallback: pure AI estimation
              const estimate = await provider.estimateNutrients(
                { name: food.name, portion_g: food.portion_g, cooking: food.cooking }, {}
              );
              nutrients = { ...estimate.nutrients };
              adjustments = estimate.meta.adjustments;
              reasoning = 'AI: No USDA match found. Estimated from knowledge.';
            }
          }
        } catch {
          // Pick call failed, fall back to AI estimation
          const provider2 = (agentOn && getAgentProvider()) || await getInferenceProvider();
          const estimate = await provider2.estimateNutrients(
            { name: food.name, portion_g: food.portion_g, cooking: food.cooking }, {}
          );
          nutrients = { ...estimate.nutrients };
          adjustments = estimate.meta.adjustments;
          reasoning = estimate.meta.reasoning || 'AI-estimated (USDA pick failed).';
        }

      } else {
        // No USDA candidates: ask AI to suggest proper USDA names, then re-search
        console.log('[NutrientPipeline] No USDA candidates, asking AI to suggest names for:', food.name);
        const agentOn = await getAgentEnabled();
        const inferenceProvider = (agentOn && getAgentProvider()) || await getInferenceProvider();

        try {
          const suggestPrompt = `The food "${food.name}" (${food.cooking || 'unknown prep'}) isn't in our USDA FoodData Central database.
Suggest 3 official USDA food names that best match this food, with your confidence (0-100).
Format each line as: name | confidence
Example: Spices, paprika | 85

Only the 3 best guesses:`;

          const suggestResponse = await inferenceProvider.generateRaw(suggestPrompt);
          const suggestions = suggestResponse.split('\n')
            .map(l => {
              const cleaned = l.replace(/^\d+[\.\)]\s*/, '').trim();
              const parts = cleaned.split('|');
              const name = parts[0]?.trim();
              const conf = parseInt(parts[1]?.trim() || '50', 10);
              return { name: name || '', confidence: Math.min(100, Math.max(0, conf || 50)) };
            })
            .filter(s => s.name.length > 2)
            .sort((a, b) => b.confidence - a.confidence);

          console.log('[NutrientPipeline] AI suggestions:', suggestions.map(s => `${s.name} (${s.confidence}%)`).join(', '));

          // Re-search USDA with AI-suggested names, weighted by AI confidence
          let bestRef: typeof usdaRefs[0] | undefined;
          let bestComboScore = 0;
          for (const suggestion of suggestions) {
            const refs = lookupUSDAAll(suggestion.name, 0.5);
            for (const r of refs.slice(0, 3)) {
              // Combined score: USDA fuzzy match * AI confidence
              const combo = r.score * (suggestion.confidence / 100);
              if (combo > bestComboScore) {
                bestComboScore = combo;
                bestRef = r;
              }
              if (!allRefsWithData.some(e => e.fdcId === r.fdcId)) {
                allRefsWithData.push({ fdcId: r.fdcId, name: r.name, score: r.score, per100g: r.per100g as any });
              }
            }
          }

          if (bestRef && bestComboScore >= 0.4) {
            usedRef = bestRef;
            const scaled = scaleNutrients(usedRef.per100g, food.portion_g);
            nutrients = {};
            usdaNutrients = {};
            for (const [k, v] of Object.entries(scaled)) {
              nutrients[k] = v ?? 0;
              usdaNutrients[k] = v ?? 0;
            }
            reasoning = `AI suggested "${usedRef.name}" for "${food.name}" (${Math.round(bestComboScore * 100)}% confidence)`;
            console.log('[NutrientPipeline] AI-suggested USDA match:', usedRef.name, 'combo:', bestComboScore);
          } else {
            // Truly no match: full AI estimation
            const estimate = await inferenceProvider.estimateNutrients(
              { name: food.name, portion_g: food.portion_g, cooking: food.cooking }, {}
            );
            nutrients = { ...estimate.nutrients };
            adjustments = estimate.meta.adjustments;
            reasoning = estimate.meta.reasoning || 'No USDA match found. AI-estimated.';
          }
        } catch {
          // Suggestion failed, full AI fallback
          const estimate = await inferenceProvider.estimateNutrients(
            { name: food.name, portion_g: food.portion_g, cooking: food.cooking }, {}
          );
          nutrients = { ...estimate.nutrients };
          adjustments = estimate.meta.adjustments;
          reasoning = estimate.meta.reasoning || 'AI-estimated (suggestion failed).';
        }
      }

      if (controller.signal.aborted) return;

      // ── Phase 3a: Apply USDA retention factors (cooking loss) ──
      let retentionChanges: FoodPipelineItem['retentionChanges'];
      let cookingSeverity: number | undefined;
      let cookingMethod: string | undefined;
      if (food.cooking) {
        const retention = lookupRetention(food.name, food.cooking);
        if (retention) {
          const result = applyRetention(nutrients, retention.factors);
          nutrients = result.adjusted;
          retentionChanges = result.changes.length > 0 ? result.changes : undefined;
          cookingSeverity = retention.severity;
          cookingMethod = retention.method;
        }
      }

      if (controller.signal.aborted) return;

      // Mark as complete (interactions applied later after all foods finish)
      callbacks.updateFood(messageId, index, {
        status: 'complete',
        nutrients,
        usdaNutrients,
        usedRef: usedRef ? { fdcId: usedRef.fdcId, name: usedRef.name, score: usedRef.score } : undefined,
        allRefs: allRefsWithData,
        adjustments,
        reasoning,
        retentionChanges,
        cookingSeverity,
        cookingMethod,
      });

      // Return nutrients for post-completion interaction pass
      console.log('[NutrientPipeline] DONE:', food.name,
        usedRef ? `USDA "${usedRef.name}" (${usedRef.score})` : 'AI estimate',
        Object.keys(nutrients).length, 'nutrients');
      return { index, nutrients, name: food.name, portion_g: food.portion_g };

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
