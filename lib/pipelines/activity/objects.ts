import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { parseJsonResponse } from './detect';

const OBJECTS_SCHEMA = {
  type: 'object',
  properties: {
    objects: { type: 'string' },
  },
  required: ['objects'],
};

export async function detectObjects(input: PipelineInput, context: any): Promise<{ objects: string }> {
  const brain = await getBrain();
  
  const prompt = `You are identifying key objects for a Stanford Life Design "O" (Objects) reflection.
This helps the user understand which tools, devices, or objects are part of activities
they find engaging or draining.

From the photo and/or text, list the prominent objects the user is interacting with
or that define the activity setting (e.g., "laptop, coffee mug" or "bicycle, helmet, trail map").

Focus on objects that characterize the activity, not background items.
List as a comma-separated string.

Context text: ${input.text || 'None'}
Activity detected: ${context.activityType || 'unknown'} — ${context.logName || ''}`;

  let result: { objects: string };
  if (input.photos && input.photos.length > 0 && brain.supportsVision) {
    const raw = await brain.vision(prompt, input.photos, { temperature: 0.1 });
    result = parseJsonResponse<{ objects: string }>(raw, { objects: '' });
  } else {
    result = await brain.json<{ objects: string }>(prompt, OBJECTS_SCHEMA, { objects: '' }, { temperature: 0.1 });
  }

  return { objects: result.objects };
}
