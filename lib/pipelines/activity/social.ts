import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { SocialResult } from '../types';
import { parseJsonResponse } from './detect';

const SOCIAL_SCHEMA = {
  type: 'object',
  properties: {
    interactions: { type: 'string', enum: ['solo', '1-2', 'small_group', 'large_group'] },
  },
  required: ['interactions'],
};

export async function detectSocial(input: PipelineInput, context: any): Promise<SocialResult> {
  const brain = await getBrain();
  
  const prompt = `You are identifying social context for a Stanford Life Design "I" (Interactions) reflection.
This helps the user track solo vs. social time for relationship health insights.

From the photo and/or text, classify the interaction level:
- interactions: "solo" (alone), "1-2" (with one or two others),
  "small_group" (3-6 people), "large_group" (7+ people)

Base your classification on visible people in the photo, mentioned names, or described social settings.
If the photo shows only objects or scenery with no people mentioned or visible, classify as "solo".

Context text: ${input.text || 'None'}
Activity detected: ${context.activityType || 'unknown'} — ${context.logName || ''}`;

  if (input.photos && input.photos.length > 0 && brain.supportsVision) {
    const raw = await brain.vision(prompt, input.photos, { temperature: 0.1 });
    return parseJsonResponse<SocialResult>(raw, { interactions: 'solo' });
  }

  return brain.json<SocialResult>(prompt, SOCIAL_SCHEMA, { interactions: 'solo' }, { temperature: 0.1 });
}
