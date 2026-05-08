import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { LifeDesignResult } from '../types';
import { parseJsonResponse } from './detect';
import { ActivityTypeService } from '../../services/activityTypeService';

const LIFE_DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    lifeCategories: {
      type: 'object',
      properties: {
        work: { type: 'number' },
        health: { type: 'number' },
        play: { type: 'number' },
        love: { type: 'number' },
      },
      required: ['work', 'health', 'play', 'love'],
    },
    aeiou: {
      type: 'object',
      properties: {
        users: { type: 'string' },
      },
    },
  },
  required: ['lifeCategories'],
};

export async function inferLifeDesign(input: PipelineInput, context: any): Promise<LifeDesignResult> {
  const brain = await getBrain();
  
  // 1. Get default life categories from ActivityType
  let defaultLifeCat = { work: 0, health: 0, play: 0, love: 0 };
  const activityTypeKey = context.activityType;
  if (activityTypeKey) {
    const typeModel = await ActivityTypeService.getByKey(activityTypeKey);
    if (typeModel && typeModel.defaultLifeCategories) {
      defaultLifeCat = { ...defaultLifeCat, ...typeModel.defaultLifeCategories };
    }
  }

  // If no context, just use the presets directly
  if (!input.text && !(input.photos && input.photos.length > 0)) {
    return { lifeCategories: defaultLifeCat };
  }

  // 2. See if the context implies an override (using Brain)
  const prompt = `You are assigning Life Design category weights for a Stanford Life Design dashboard.
The four categories are:
- Work: productive/professional tasks, studying, career-building
- Health: physical exercise, nutrition preparation, medical, self-care
- Play: fun, creative, exploratory activities done for enjoyment
- Love: connecting with others, relationships, community, family time

Defaults for "${activityTypeKey || 'unknown'}": ${JSON.stringify(defaultLifeCat)}.
Override defaults only when the specific context clearly shifts the balance
(e.g., a "work" lunch with a friend shifts some weight to Love).
Weights must sum to 1.0.

Also extract any specific people names mentioned in the text as a comma-separated string
for the "U" (Users) dimension of the AEIOU framework. Only list names that are
clearly mentioned — if none are mentioned, leave users empty.

Context text: ${input.text || 'None'}
Activity detected: ${context.activityType || 'unknown'} — ${context.logName || ''}
Social context: ${context.interactions || 'unknown'}`;

  if (input.photos && input.photos.length > 0 && brain.supportsVision) {
    const raw = await brain.vision(prompt, input.photos, { temperature: 0.1 });
    const result = parseJsonResponse<LifeDesignResult>(raw, { lifeCategories: defaultLifeCat });
    return result;
  }

  const result = await brain.json<LifeDesignResult>(prompt, LIFE_DESIGN_SCHEMA, { lifeCategories: defaultLifeCat }, { temperature: 0.1 });

  // Post-process the extracted "users"
  if (result.aeiou && result.aeiou.users) {
    result.aeiou.users.split(',').map(n => n.trim()).filter(n => n);
  }

  return result;
}
