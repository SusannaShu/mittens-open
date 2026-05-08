/**
 * Cloud Batch -- combines food pipeline phases into a single API call.
 *
 * For cloud brains, combines identify + eatingContext (when applicable)
 * into one prompt to avoid sequential 429-triggering calls.
 *
 * Note: nutrients phase is NOT included in cloud batch because it uses
 * USDA database lookup (deterministic, no AI needed in most cases).
 * bioavailability and validate also stay separate since they depend on
 * nutrient results.
 */

import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import type { FoodIdentifyResult, EatingContext, FoodItem } from '../types';

export type FoodPhase = 'identify' | 'eatingContext';

// ─── Combined prompt builder ───

function buildCombinedFoodPrompt(
  phases: FoodPhase[],
  input: PipelineInput,
  memory?: string,
): string {
  const sections: string[] = [];

  sections.push(`Analyze this meal from the photo and/or text. Return ALL requested sections in a single JSON response.\n`);

  if (phases.includes('identify')) {
    const captionLine = input.text ? `\nUser says: "${input.text}"` : '';
    sections.push(`=== FOOD IDENTIFICATION ===
You are identifying specific food items for USDA FoodData Central database matching.
Each food name will be used to look up accurate nutritional data.${captionLine}
${memory ? `User preferences: ${memory}\n` : ''}
Provide the most specific food name possible:
- "grilled chicken breast" not "chicken"
- "jasmine rice" not "rice"
- "steamed broccoli" not "broccoli"
- If a branded product is visible, include the brand name

PORTION ESTIMATION:
- Use plate/bowl/utensils as size references (dinner plate ~25cm, fork ~20cm)
- Provide BOTH grams AND household measure

CONFIDENCE: 0.9+ clearly visible, 0.6-0.8 likely, below 0.5 uncertain

Provide in the "identify" key:
- items: array of {name, portion_g, household_portion, cooking, confidence}`);
  }

  if (phases.includes('eatingContext')) {
    sections.push(`\n=== EATING CONTEXT ===
Assess eating context for metabolism and digestion impact estimation.
Research shows eating pace, mindfulness, and stress affect nutrient absorption.

Provide in the "eatingContext" key:
- pace: "rushed", "moderate", or "slow"
- chewing: "minimal", "moderate", or "thorough"
- distraction: "focused", "some", or "distracted"
- stress: "calm", "moderate", or "stressed"
- social: "alone" or "with_others"

If no eating context cues are visible, use "moderate" defaults.`);
  }

  sections.push(`\nRespond with a single JSON object.`);

  return sections.join('\n');
}

// ─── Combined response parser ───

interface CombinedFoodResult {
  identify?: FoodIdentifyResult;
  eatingContext?: EatingContext;
}

function parseCombinedFoodResponse(raw: string, phases: FoodPhase[]): CombinedFoodResult {
  try {
    let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
    cleaned = cleaned.replace(/<\/?think>/g, '');

    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return {};

    const parsed = JSON.parse(match[0]);
    const result: CombinedFoodResult = {};

    if (phases.includes('identify') && parsed.identify) {
      const items = parsed.identify.items || parsed.identify.foods || [];
      const foods: FoodItem[] = items.map((i: any) => ({
        name: i.n || i.name || '',
        portion_g: typeof (i.g || i.portion_g) === 'number'
          ? (i.g || i.portion_g)
          : parseInt(i.g || i.portion_g, 10) || 0,
        household_portion: i.hp || i.household_portion,
        cooking: i.k || i.cooking,
        confidence: i.c ?? i.confidence ?? 0.8,
      }));

      // Deduplicate
      const unique = Array.from(
        new Map(foods.map(f => [f.name.toLowerCase(), f])).values()
      );

      const hour = new Date().getHours();
      const mealType = hour < 10 ? 'breakfast' : hour < 14 ? 'lunch' : hour < 20 ? 'dinner' : 'snack';

      result.identify = {
        foods: unique,
        mealType,
        mealName: unique.map(f => f.name).slice(0, 3).join(', '),
        hasMore: unique.length >= 3,
      };
    }

    if (phases.includes('eatingContext') && parsed.eatingContext) {
      result.eatingContext = {
        pace: parsed.eatingContext.pace || 'moderate',
        chewing: parsed.eatingContext.chewing || 'moderate',
        distraction: parsed.eatingContext.distraction || 'some',
        stress: parsed.eatingContext.stress || 'calm',
        social: parsed.eatingContext.social || 'alone',
      };
    }

    return result;
  } catch (err) {
    console.error('[CloudBatch:food] Failed to parse combined response:', raw?.slice(0, 300));
    return {};
  }
}

// ─── Main entry point ───

/**
 * Run food identification + eating context as a single cloud API call.
 */
export async function runFoodPhasesCloud(
  input: PipelineInput,
  phases: FoodPhase[],
  memory?: string,
): Promise<CombinedFoodResult> {
  const brain = await getBrain();
  const prompt = buildCombinedFoodPrompt(phases, input, memory);

  console.log('[CloudBatch:food] Running', phases.length, 'phases in one call:', phases.join(', '));

  let raw: string;
  if (input.photos && input.photos.length > 0 && brain.supportsVision) {
    raw = await brain.vision(prompt, input.photos, { temperature: 0.2 });
  } else {
    raw = await brain.text(prompt, { temperature: 0.2 });
  }

  return parseCombinedFoodResponse(raw, phases);
}
