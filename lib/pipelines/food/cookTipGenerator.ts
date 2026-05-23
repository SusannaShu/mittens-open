/**
 * Post-Solver Cook Tip Generator
 *
 * Generates per-meal-slot cooking tips AFTER the solver has selected final foods.
 * Tips focus on:
 * - Nutrient preservation (steaming > boiling, minimal cooking for water-soluble vitamins)
 * - Bioavailability pairing (vitamin C with iron, fat with fat-soluble vitamins)
 * - Gap-specific advice (which cooking technique helps close which gap)
 */

import type { MealPlanCandidate, NutrientGap } from './meal-plan-solver';

function buildCookTipPrompt(
  slot: string,
  foods: MealPlanCandidate[],
  gaps: NutrientGap[],
): string {
  const foodList = foods.map(f => {
    const topNutrients = Object.entries(f.nutrients || {})
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([k, v]) => `${k}: ${Math.round(v)}`)
      .join(', ');
    return `- ${f.name} (${topNutrients})`;
  }).join('\n');

  const gapStr = gaps
    .filter(g => g.pct < 80 && g.nutrient !== 'vitamin_d')
    .slice(0, 5)
    .map(g => `${g.name}: ${g.pct}%`)
    .join(', ');

  return `For ${slot}, the selected foods are:
${foodList}

Remaining nutrient gaps: ${gapStr || 'none significant'}

Give ONE concise cooking tip (1-2 sentences) that:
1. Maximizes nutrient retention for these specific foods
2. Suggests food pairing for better absorption (e.g., vitamin C with iron, fat with fat-soluble vitamins)
3. References which gap the technique helps close

Respond with just the tip text, no JSON.`;
}

export async function generateAllCookTips(
  brain: any,
  mealAssignment: Record<string, MealPlanCandidate[]>,
  gaps: NutrientGap[],
): Promise<Record<string, string>> {
  const tips: Record<string, string> = {};

  for (const [slot, foods] of Object.entries(mealAssignment)) {
    if (!foods || foods.length === 0) continue;
    try {
      const prompt = buildCookTipPrompt(slot, foods, gaps);
      const tip = await brain.text(prompt);
      tips[slot] = (tip || '').trim().slice(0, 300); // Cap length
    } catch (e: any) {
      console.warn(`[CookTip] Failed to generate tip for ${slot}:`, e.message);
      tips[slot] = '';
    }
  }

  return tips;
}
