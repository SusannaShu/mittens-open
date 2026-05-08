// Re-export for backward compatibility -- new code should import from services/food/
export {
  lookupUSDA, lookupUSDAAll, scaleNutrients,
  estimateNutrients, estimateNutrientsBatch,
  reEstimateWithReference, applyUserEdits,
  flattenNutrients, flattenNutrientsNullable, averageConfidence,
} from './food/nutrientEstimator';
export type {
  NutrientResult, NutrientValues, NutrientValue, NutrientSource,
  FlatNutrients, USDAReference, NutrientAdjustment,
} from './food/nutrientEstimator';
