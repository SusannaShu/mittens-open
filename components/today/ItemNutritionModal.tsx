import React from 'react';
import NutrientDetailSheet from '../chat/NutrientDetailSheet';
import { FoodPipelineItem } from '../chat/MealPipelineCard';

interface ItemNutritionModalProps {
  visible: boolean;
  onClose: () => void;
  item: any | null;
}

export default function ItemNutritionModal({ visible, onClose, item }: ItemNutritionModalProps) {
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
    usedRef: item.meta?.usedRef || item.usdaRef,
    allRefs: item.meta?.allReferences || (item.usdaRef ? [item.usdaRef] : undefined),
    adjustments: item.meta?.adjustments,
    reasoning: item.meta?.reasoning || item.reasoning,
    retentionChanges: item.meta?.retentionChanges || item.retentionChanges,
    interactionChanges: item.meta?.interactionChanges || item.interactionChanges,
    cookingSeverity: item.meta?.cookingSeverity || item.cookingSeverity,
    cookingMethod: item.meta?.cookingMethod || item.cookingMethod,
  };

  return (
    <NutrientDetailSheet
      visible={visible}
      onClose={onClose}
      food={foodItem}
    />
  );
}
