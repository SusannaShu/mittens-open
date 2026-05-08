import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { EnvironmentResult } from '../types';
import { parseJsonResponse } from './detect';

const ENV_SCHEMA = {
  type: 'object',
  properties: {
    environment: { type: 'string', enum: ['indoor', 'outdoor'] },
    subtype: { type: 'string', enum: ['nature', 'urban', 'home', 'office'] },
  },
  required: ['environment'],
};

export async function detectEnvironment(input: PipelineInput, context: any): Promise<EnvironmentResult> {
  const brain = await getBrain();
  
  const prompt = `You are identifying the environment for a Stanford Life Design "E" (Environment) reflection.
This data helps the user understand which settings correlate with their energy and engagement levels.

From the photo and/or text, classify:
- environment: "indoor" or "outdoor" based on visible setting cues
- subtype: "nature" (parks, trails, water, forests), "urban" (streets, buildings, cityscape),
  "home" (residential interior), or "office" (workspace, desk, meeting room) — set only if clearly identifiable

If the setting is ambiguous, set environment to your best assessment and omit subtype.

Context text: ${input.text || 'None'}
Activity detected: ${context.activityType || 'unknown'} — ${context.logName || ''}`;

  if (input.photos && input.photos.length > 0 && brain.supportsVision) {
    const raw = await brain.vision(prompt, input.photos, { temperature: 0.1 });
    return parseJsonResponse<EnvironmentResult>(raw, { environment: 'indoor' });
  }

  return brain.json<EnvironmentResult>(prompt, ENV_SCHEMA, { environment: 'indoor' }, { temperature: 0.1 });
}
