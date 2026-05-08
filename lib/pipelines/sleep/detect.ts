import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { SleepResult } from '../types';

const SLEEP_SCHEMA = {
  type: 'object',
  properties: {
    sleepStart: { type: 'string' },
    sleepEnd: { type: 'string' },
    totalMinutes: { type: 'number' },
    quality: { type: 'string', enum: ['poor', 'fair', 'good', 'great'] },
    energy: { type: 'number' },
    environment: {
      type: 'object',
      properties: {
        temperature: { type: 'string', enum: ['too_hot', 'comfortable', 'too_cold'] },
        light: { type: 'string', enum: ['dark', 'some_light', 'bright'] },
        noise: { type: 'string', enum: ['quiet', 'some_noise', 'loud'] },
        screenBeforeBed: { type: 'string', enum: ['none', 'under_30min', 'over_30min'] },
        caffeine: { type: 'string', enum: ['none', 'before_2pm', 'after_2pm'] },
      },
    },
  },
  required: ['quality', 'energy'],
};

export async function detectSleep(input: PipelineInput): Promise<SleepResult> {
  const brain = await getBrain();
  
  const prompt = `Extract sleep log data from the user's description.
quality: poor, fair, good, or great
energy: number -5 to 5
sleepStart/sleepEnd: ISO timestamp or null
totalMinutes: number or null
environment: temperature, light, noise, screenBeforeBed, caffeine

Context text: ${input.text || 'None'}`;

  return brain.json<SleepResult>(prompt, SLEEP_SCHEMA, { quality: 'good', energy: 1 }, { temperature: 0.1 });
}
