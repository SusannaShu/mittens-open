import React from 'react';
import NutrientDetailSheet from '../chat/NutrientDetailSheet';
import { FoodPipelineItem } from '../chat/MealPipelineCard';
import { scaleNutrients, USDAReference } from '../../lib/services/food/nutrientEstimator';

interface ItemNutritionModalProps {
  visible: boolean;
  onClose: () => void;
  item: any | null;
  /** Called when user overrides the USDA reference from the detail sheet */
  onUpdate?: (updatedItem: any) => void;
}

export default function ItemNutritionModal({ visible, onClose, item, onUpdate }: ItemNutritionModalProps) {
  if (!item) return null;

  // Adapt DB/local item shape to FoodPipelineItem expected by NutrientDetailSheet
  const foodItem: FoodPipelineItem = {
    name: item.name || item.foodName || 'Unknown',
    portion_g: item.portion_g || item.portionG || 0,
    household_portion: item.household_portion || item.householdPortion,
    cooking: item.cooking,
    confidence: item.confidence || 1,
    status: 'complete',
    nutrients: item.nutrients,
    // Provide either the explicit usdaNutrients or let the sheet compute it from usedRef
    usdaNutrients: item.usdaNutrients,
    usedRef: item.usedRef || item.meta?.usedRef || item.usdaRef || item.meta?.usedReference,
    allRefs: item.allRefs || item.meta?.allReferences || item.meta?.allRefs || (item.usdaRef ? [item.usdaRef] : undefined),
    adjustments: item.meta?.adjustments,
    reasoning: item.meta?.reasoning || item.reasoning,
    retentionChanges: item.meta?.retentionChanges || item.retentionChanges,
    interactionChanges: item.meta?.interactionChanges || item.interactionChanges,
    cookingSeverity: item.meta?.cookingSeverity || item.cookingSeverity,
    cookingMethod: item.meta?.cookingMethod || item.cookingMethod,
  };

  const handleUsdaSelect = onUpdate
    ? (usdaFood: USDAReference & { amountGram: number; customName?: string }) => {
        const scaled = scaleNutrients(usdaFood.per100g, usdaFood.amountGram);
        const nutrients: Record<string, number> = {};
        for (const [k, v] of Object.entries(scaled)) {
          nutrients[k] = v ?? 0;
        }

        onUpdate({
          ...item,
          name: usdaFood.customName || usdaFood.name.split(',')[0],
          portion_g: usdaFood.amountGram,
          nutrients,
          usdaNutrients: { ...nutrients },
          usedRef: { fdcId: usdaFood.fdcId, name: usdaFood.name, score: usdaFood.score || 1 },
          reasoning: `User manually selected USDA match: ${usdaFood.name}`,
          _nameChanged: false, // Bypass AI re-estimation on save
        });
        onClose();
      }
    : undefined;

  return (
    <NutrientDetailSheet
      visible={visible}
      onClose={onClose}
      food={foodItem}
      onUsdaSelect={handleUsdaSelect}
    />
  );
}
