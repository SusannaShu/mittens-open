import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { PantryItem } from '../types';
import { parseJsonResponse } from '../activity/detect';

const PANTRY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'string' },
          confidence: { type: 'number' },
          freshness: { type: 'string', enum: ['fresh', 'good', 'use_soon', 'questionable'] },
          storageLocation: { type: 'string', enum: ['fridge', 'freezer', 'pantry', 'counter'] },
          checkBy: { type: 'string' },
        },
        required: ['name', 'confidence', 'freshness', 'storageLocation'],
      },
    },
  },
  required: ['items'],
};

export async function identifyPantryItem(input: PipelineInput): Promise<{ items: PantryItem[] }> {
  const brain = await getBrain();
  
  const prompt = `Identify ALL food and grocery items visible in this photo.

For EACH item you can see, return:
- name: what the item is (e.g. "red bell pepper", "carrots", "celery bunch")
- quantity: estimated amount (e.g. "3 peppers", "1 bunch", "about 2 lbs")
- confidence: how certain you are, 0.0 to 1.0
- freshness: 'fresh', 'good', 'use_soon', or 'questionable'
- storageLocation: 'fridge', 'freezer', 'pantry', or 'counter'
- checkBy: ISO date or null

Return JSON only, no explanation:
{"items":[{"name":"red bell pepper","quantity":"2","confidence":0.95,"freshness":"good","storageLocation":"fridge","checkBy":null}]}

Context text: ${input.text || 'None'}`;

  // Vision: use brain.vision() then parse (grammar can't constrain vision output)
  if (input.photos && input.photos.length > 0 && brain.supportsVision) {
    console.log('[Pantry] identify START, brain:', brain.name, 'photos:', input.photos.length);
    const raw = await brain.vision(prompt, input.photos, { temperature: 0.1 });
    console.log('[Pantry] identify raw response:', raw?.slice(0, 300));
    const result = parseJsonResponse<{ items: PantryItem[] }>(raw, { items: [] });
    console.log('[Pantry] identify parsed items:', result.items.length);
    if (result.items.length === 0 && raw && raw.length > 10) {
      console.warn('[Pantry] identify returned 0 items but model DID respond. Full response:', raw);
    }
    return result;
  }

  // Text-only: grammar-constrained JSON
  return brain.json<{ items: PantryItem[] }>(prompt, PANTRY_SCHEMA, { items: [] }, { temperature: 0.1 });
}
