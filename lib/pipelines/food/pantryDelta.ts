import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { PantryDelta } from '../../services/ambient/types';
import { parseJsonResponse } from '../activity/detect';

const PANTRY_DELTA_SCHEMA = {
  type: 'object',
  properties: {
    deltas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          qtyChange: { type: 'number' },
          unit: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'guess'] },
          reason: { type: 'string' },
        },
        required: ['name', 'qtyChange', 'unit', 'confidence', 'reason'],
      },
    },
  },
  required: ['deltas'],
};

export async function extractPantryDeltas(input: PipelineInput): Promise<{ deltas: PantryDelta[] }> {
  const brain = await getBrain();
  
  const prompt = `You are a Smart Pantry assistant. Your job is to extract exact quantities of food items the user has consumed, used, or purchased based on visual evidence or text.

For EACH item you see being actively interacted with, return:
- name: what the item is (e.g. "red bell pepper", "chicken breast", "almonds")
- qtyChange: a NUMBER representing the change. Use NEGATIVE numbers for cooking/eating (e.g., -0.5, -2) and POSITIVE numbers for grocery shopping (e.g., 1, 3).
- unit: the unit of measurement (e.g., "lbs", "oz", "tbsp", "cups", "whole", "jars")
- confidence: 'high', 'medium', or 'guess' based on how clearly you can estimate the amount.
- reason: short explanation of your reasoning (e.g., "User put 3 almonds on the plate", "User placed 2 lbs of chicken in grocery cart").

CRITICAL RULES:
1. ONLY list items the user is actively taking from storage, using for prep, or buying at a grocery store.
2. ABSOLUTELY DO NOT list items that are just sitting untouched in the background (e.g., items already on a grocery shelf, untouched jars in the fridge).
3. If you see plated, prepared food being eaten but cannot tell how much raw ingredient was used to make it, DO NOT guess the raw ingredient amounts. Only report what you see being prepared or picked up.

Return JSON only, no explanation:
{"deltas":[{"name":"almonds","qtyChange":-3,"unit":"whole","confidence":"high","reason":"User picked up 3 almonds"}]}

Context text: ${input.text || 'None'}`;

  const fallback = { deltas: [] };

  if (input.photos && input.photos.length > 0 && brain.supportsVision) {
    console.log('[PantryDelta] extract START, brain:', brain.name, 'photos:', input.photos.length);
    const raw = await brain.vision(prompt, input.photos, { temperature: 0.1 });
    console.log('[PantryDelta] extract raw response:', raw?.slice(0, 300));
    return parseJsonResponse<{ deltas: PantryDelta[] }>(raw, fallback);
  }

  if (input.text) {
    return brain.json<{ deltas: PantryDelta[] }>(prompt, PANTRY_DELTA_SCHEMA, fallback, { temperature: 0.1 });
  }

  return fallback;
}
