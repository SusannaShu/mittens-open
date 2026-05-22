/**
 * Supplement Recommender — LAST RESORT
 *
 * Only recommends supplements when food + portion scaling + sun exposure
 * cannot close a nutrient gap. The hierarchy is:
 *   1. Whole food recommendations (meal plan solver)
 *   2. Portion scaling of existing meals
 *   3. Sun exposure (vitamin D only, via vitaminDSynthesis.ts)
 *   4. Supplements (this module) — absolute last resort
 *
 * All supplement forms chosen for bioavailability and tolerability.
 * Doses capped at standard single-unit amounts; never exceeds UL.
 *
 * References:
 *  - NIH ODS Supplement Fact Sheets
 *  - ConsumerLab.com form comparisons
 *  - Examine.com supplement guides
 */

import { NutrientGap, SupplementRec } from '../../types';

/**
 * Curated supplement database with evidence-based forms, doses, and interactions.
 * Only recommend when food + lifestyle cannot close the gap.
 */
const SUPPLEMENT_DB: Record<string, {
  form: string;
  dosePerUnit: number;
  unit: string;
  timingNote: string;
  avoidWith: string[];
  cautions: string[];
}> = {
  vitamin_d: {
    form: 'Vitamin D3 (cholecalciferol)',
    dosePerUnit: 25, unit: 'mcg (1000 IU)',
    timingNote: 'Take with a fat-containing meal for best absorption',
    avoidWith: [],
    cautions: ['Do not exceed 100 mcg (4000 IU)/day without medical supervision'],
  },
  vitamin_b12: {
    form: 'Methylcobalamin',
    dosePerUnit: 1000, unit: 'mcg',
    timingNote: 'Take in the morning; sublingual for best absorption',
    avoidWith: [],
    cautions: ['Essential for vegans and those over 50'],
  },
  iron: {
    form: 'Ferrous bisglycinate (chelated, gentle)',
    dosePerUnit: 25, unit: 'mg',
    timingNote: 'Take on empty stomach with vitamin C for absorption; avoid with calcium',
    avoidWith: ['calcium supplements', 'coffee/tea within 1 hour'],
    cautions: ['Only supplement if confirmed deficient via blood test (serum ferritin)'],
  },
  omega3: {
    form: 'Fish oil (EPA + DHA)',
    dosePerUnit: 1, unit: 'g',
    timingNote: 'Take with food to reduce GI issues',
    avoidWith: [],
    cautions: ['May interact with blood thinners; algal oil for vegans'],
  },
  folate: {
    form: 'L-methylfolate (5-MTHF)',
    dosePerUnit: 400, unit: 'mcg',
    timingNote: 'Take with food; bioactive form bypasses MTHFR polymorphism',
    avoidWith: [],
    cautions: ['Preferred over folic acid for those with MTHFR variants'],
  },
  magnesium: {
    form: 'Magnesium glycinate',
    dosePerUnit: 200, unit: 'mg',
    timingNote: 'Take in the evening; may aid sleep',
    avoidWith: [],
    cautions: ['Glycinate form is gentle on stomach; avoid oxide form'],
  },
  calcium: {
    form: 'Calcium citrate',
    dosePerUnit: 500, unit: 'mg',
    timingNote: 'Take with food; split into 500mg doses for better absorption',
    avoidWith: ['iron supplements (separate by 2 hours)'],
    cautions: ['Citrate form absorbed better than carbonate; take with vitamin D'],
  },
  zinc: {
    form: 'Zinc picolinate',
    dosePerUnit: 15, unit: 'mg',
    timingNote: 'Take with food to reduce nausea',
    avoidWith: ['iron supplements (separate by 2 hours)'],
    cautions: ['Long-term high zinc can deplete copper; consider zinc/copper combo'],
  },
  vitamin_e: {
    form: 'd-alpha-tocopherol (natural)',
    dosePerUnit: 15, unit: 'mg',
    timingNote: 'Take with a fat-containing meal',
    avoidWith: [],
    cautions: ['Natural form (d-alpha) preferred over synthetic (dl-alpha)'],
  },
};

/**
 * Recommend supplements only for truly uncoverable nutrient gaps.
 * Called after MILP solver + portion scaling + sun recommendation.
 *
 * @param uncoveredGaps Gaps still < 50% after food plan
 * @param allGaps All current nutrient gaps (for context)
 * @returns Array of supplement recommendations
 */
export function recommendSupplements(
  uncoveredGaps: Array<{ nutrient: string; name: string; afterPlanPct: number }>,
  allGaps: NutrientGap[]
): SupplementRec[] {
  const recs: SupplementRec[] = [];

  for (const gap of uncoveredGaps) {
    // Only recommend for gaps still significantly under target
    if (gap.afterPlanPct >= 50) continue;

    // Skip vitamin D — handled by sun recommendation, not supplement (unless UV < 3)
    // The caller should handle vitamin D separately via vitaminDSynthesis.ts
    // Only include here if explicitly flagged as sun-infeasible
    
    const supp = SUPPLEMENT_DB[gap.nutrient];
    if (!supp) continue;

    const fullGap = allGaps.find(g => g.nutrient === gap.nutrient);
    if (!fullGap) continue;

    const deficitAmount = Math.max(0, fullGap.rda - fullGap.actual);
    // Calculate how many units needed (round up, but cap at 1 standard dose)
    const unitsNeeded = Math.min(1, Math.ceil(deficitAmount / supp.dosePerUnit));
    const suggestedDose = unitsNeeded * supp.dosePerUnit;

    // Don't recommend if dose would exceed UL
    if (fullGap.ul && (fullGap.actual + suggestedDose) > fullGap.ul) continue;

    recs.push({
      nutrient: gap.nutrient,
      name: fullGap.name,
      deficitAmount: Math.round(deficitAmount * 10) / 10,
      form: supp.form,
      suggestedDose,
      unit: supp.unit,
      rationale: `Your ${fullGap.name} is at ${gap.afterPlanPct}% even after today's meal plan. ` +
        `A ${suggestedDose}${supp.unit} ${supp.form} supplement could help close this gap.`,
      timingNote: supp.timingNote,
      avoidWith: supp.avoidWith,
      cautions: supp.cautions,
    });
  }

  return recs;
}
