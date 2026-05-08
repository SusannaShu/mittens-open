import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { PantryFreshnessResult } from '../types';
import { parseJsonResponse } from '../activity/detect';

const FRESHNESS_SCHEMA = {
  type: 'object',
  properties: {
    freshness: { type: 'string', enum: ['fresh', 'good', 'use_soon', 'questionable'] },
    storageLocation: { type: 'string', enum: ['fridge', 'freezer', 'pantry', 'counter'] },
    checkBy: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['freshness', 'storageLocation'],
};

export async function assessPantryFreshness(input: PipelineInput, itemName: string): Promise<PantryFreshnessResult> {
  const brain = await getBrain();
  
  const prompt = `Assess freshness and storage of "${itemName}".
freshness: fresh, good, use_soon, or questionable
storageLocation: fridge, freezer, pantry, or counter
checkBy: ISO date or null
reason: short explanation

Context text: ${input.text || 'None'}`;

  // Vision: use brain.vision() then parse
  if (input.photos && input.photos.length > 0 && brain.supportsVision) {
    const raw = await brain.vision(prompt, input.photos, { temperature: 0.1 });
    return parseJsonResponse<PantryFreshnessResult>(raw, { freshness: 'good', storageLocation: 'pantry' });
  }

  return brain.json<PantryFreshnessResult>(prompt, FRESHNESS_SCHEMA, { freshness: 'good', storageLocation: 'pantry' }, { temperature: 0.1 });
}
