import { MealPlanCoverage, NutrientGap } from './meal-plan-solver';

export interface BioavailabilityNote {
  meal: string;
  note: string;
  effect: 'positive' | 'negative';
  nutrient: string;
  ruleId: string;
}

const TEA_COFFEE_KEYWORDS = ['tea', 'coffee', 'espresso', 'matcha', 'green tea', 'black tea'];

const PHYTATE_KEYWORDS = ['whole grain', 'whole wheat', 'brown rice', 'oats', 'oatmeal',
  'lentil', 'bean', 'chickpea', 'quinoa', 'barley', 'millet', 'rye'];

export const BIOAVAILABILITY_RULES = [
  {
    id: 'iron_vitc_synergy',
    check: (mealNutrients: Record<string, number>, mealItems: any[]) => {
      return (mealNutrients.iron || 0) > 0 && (mealNutrients.vitamin_c || 0) >= 25;
    },
    effect: { iron: 1.5 },
    note: 'Vitamin C boosts iron absorption',
    type: 'positive' as const,
  },
  {
    id: 'iron_calcium_block',
    check: (mealNutrients: Record<string, number>) => {
      return (mealNutrients.iron || 0) > 0 && (mealNutrients.calcium || 0) >= 300;
    },
    effect: { iron: 0.6 },
    note: 'Separate calcium and iron by 2hrs for best absorption',
    type: 'negative' as const,
  },
  {
    id: 'iron_polyphenol_block',
    check: (mealNutrients: Record<string, number>, mealItems: any[]) => {
      if ((mealNutrients.iron || 0) <= 0) return false;
      const names = mealItems.map(i => (i.name || i).toLowerCase());
      return names.some(n => TEA_COFFEE_KEYWORDS.some(kw => n.includes(kw)));
    },
    effect: { iron: 0.6 },
    note: 'Tea/coffee polyphenols block iron -- drink 1hr apart',
    type: 'negative' as const,
  },
  {
    id: 'fat_soluble_no_fat',
    check: (mealNutrients: Record<string, number>) => {
      const hasFatSoluble = (mealNutrients.vitamin_a || 0) > 0 ||
        (mealNutrients.vitamin_d || 0) > 0 ||
        (mealNutrients.vitamin_e || 0) > 0 ||
        (mealNutrients.vitamin_k || 0) > 0;
      return hasFatSoluble && (mealNutrients.fat || 0) < 5;
    },
    effect: { vitamin_a: 0.5, vitamin_d: 0.5, vitamin_e: 0.5, vitamin_k: 0.5 },
    note: 'Add a fat source for fat-soluble vitamin absorption',
    type: 'negative' as const,
  },
  {
    id: 'zinc_phytate_block',
    check: (mealNutrients: Record<string, number>, mealItems: any[]) => {
      if ((mealNutrients.zinc || 0) <= 0) return false;
      const names = mealItems.map(i => (i.name || i).toLowerCase());
      return names.some(n => PHYTATE_KEYWORDS.some(kw => n.includes(kw)));
    },
    effect: { zinc: 0.7 },
    note: 'Whole grains/legumes reduce zinc absorption slightly',
    type: 'negative' as const,
  },
];

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

    for (const rule of BIOAVAILABILITY_RULES) {
      if (!rule.check(mealNutrients, mealItems)) continue;

      notes.push({
        meal: slot,
        note: rule.note,
        effect: rule.type,
        nutrient: Object.keys(rule.effect)[0],
        ruleId: rule.id,
      });

      for (const [nutrient, multiplier] of Object.entries(rule.effect)) {
        if (!adjustedCoverage[nutrient]) continue;

        const gap = gapMap[nutrient];
        if (!gap) continue;

        const mealContrib = mealNutrients[nutrient] || 0;
        const adjustedContrib = mealContrib * multiplier;
        const delta = adjustedContrib - mealContrib;

        const planAdds = (adjustedCoverage[nutrient].planAdds || 0) + delta;
        adjustedCoverage[nutrient].planAdds = Math.round(planAdds * 10) / 10;

        const newTotal = gap.actual + planAdds;
        const newPct = gap.rda > 0 ? Math.round((newTotal / gap.rda) * 100) : adjustedCoverage[nutrient].afterPlanPct;
        adjustedCoverage[nutrient].afterPlanPct = newPct;

        if (newPct >= 70) adjustedCoverage[nutrient].status = 'covered';
        else if (newPct > adjustedCoverage[nutrient].currentPct) adjustedCoverage[nutrient].status = 'partial';
      }
    }
  }

  return { adjustedCoverage, notes };
}
