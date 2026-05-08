/**
 * Food Pipeline Phase 3: BIOAVAILABILITY
 *
 * Analyze how cooking method and food combinations affect nutrient
 * absorption. Uses the meal photo to verify actual cooking state
 * (not just what the user labeled).
 *
 * MIGRATED FROM:
 *   gemmaLocalProvider.analyzeBioavailability()
 *
 * RESEARCH BACKED:
 *   - Cooking retention factors from lib/data/retentionFactors.ts
 *   - Nutrient interactions from lib/data/nutrientInteractions.ts
 *   - Example interactions:
 *     - Vitamin C + iron = enhanced absorption (2-6x)
 *     - Calcium + iron = reduced absorption
 *     - Fat + fat-soluble vitamins (A, D, E, K) = enhanced absorption
 *     - Phytates (grains) + minerals = reduced absorption
 *     - Steaming retains ~91% vitamin C vs boiling ~65%
 *
 * INPUTS:
 *   - images: meal photo(s) for cooking state verification
 *   - foods: identified foods with portions from Phase 1
 *   - baseNutrients: nutrient values from Phase 2
 *
 * OUTPUTS:
 *   - BioavailabilityResult: per-nutrient adjustment factors with reasoning
 *
 * RE-RUN TRIGGER:
 *   User changes cooking method → re-run this phase.
 *   Phase 2 (nutrients) provides the base values.
 *
 * RESEARCH NEEDED:
 *   - More comprehensive retention factor database
 *   - Fermentation effects on bioavailability
 *   - Soaking/sprouting effects on phytate reduction
 *   - Cooking temperature effects (low vs high heat)
 *   - Reheating effects on resistant starch
 */

import { getBrain } from '../../brain/selector';
import type { BioavailabilityResult } from '../types';

export async function analyzeBioavailability(
  images: string[],
  foods: Array<{ name: string; portion_g: number; cooking?: string }>,
  baseNutrients: Record<string, Record<string, number>>,
): Promise<BioavailabilityResult> {
  if (foods.length === 0) return { adjustments: [], mealNote: '' };

  const brain = await getBrain();

  // Build food list with their nutrient values for context
  const foodLines = foods.map(f => {
    const nuts = baseNutrients[f.name] || {};
    const nutStr = Object.entries(nuts)
      .filter(([, v]) => v > 0)
      .slice(0, 8)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    return `${f.name} ${f.portion_g}g (${f.cooking || 'unknown'}): ${nutStr}`;
  }).join('\n');

  const prompt = `Meal foods and estimated nutrients:
${foodLines}

Analyze cooking state and nutrient interactions.
1. How does cooking method affect retention?
2. Any nutrient interactions? (vitamin C + iron = better absorption)

JSON: {"adj":[
{"food":"name","nutrient":"vitamin_c","factor":0.91,"before":19.2,"after":17.5,"why":"steaming retains ~91%"}
],"note":"meal summary","tip":"cooking tip"}`;

  const raw = images.length > 0
    ? await brain.vision(prompt, images, { temperature: 0.2 })
    : await brain.text(prompt, { temperature: 0.2 });

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        adjustments: (parsed.adj || []).map((a: any) => ({
          food: a.food || '',
          nutrient: a.nutrient || '',
          factor: a.factor ?? 1,
          before: a.before ?? 0,
          after: a.after ?? 0,
          reason: a.why || a.reason || '',
        })),
        mealNote: parsed.note || '',
        cookingTip: parsed.tip || undefined,
      };
    }
  } catch { /* parse error */ }

  return { adjustments: [], mealNote: '' };
}
