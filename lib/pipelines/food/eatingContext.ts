import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { EatingContext } from '../types';
import { parseJsonResponse } from '../activity/detect';

const EATING_CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    pace: { type: 'string', enum: ['rushed', 'moderate', 'slow'] },
    chewing: { type: 'string', enum: ['minimal', 'moderate', 'thorough'] },
    distraction: { type: 'string', enum: ['focused', 'some', 'distracted'] },
    stress: { type: 'string', enum: ['calm', 'moderate', 'stressed'] },
    social: { type: 'string', enum: ['alone', 'with_others'] },
  },
  required: ['pace', 'chewing', 'distraction', 'stress', 'social'],
};

const EATING_FALLBACK: EatingContext = {
  pace: 'moderate',
  chewing: 'moderate',
  distraction: 'some',
  stress: 'calm',
  social: 'alone',
};

export async function inferEatingContext(input: PipelineInput): Promise<EatingContext> {
  const brain = await getBrain();
  
  const prompt = `You are assessing eating context for a metabolism and digestion impact estimation.
Research shows eating pace, mindfulness, and stress level significantly affect
nutrient absorption and glycemic response.

From the photo and/or text, assess:
- pace: "rushed" (eating on the go, mentions being late), "moderate" (normal meal setting), "slow" (leisurely dining, mentions savoring)
- chewing: "minimal" (soft/liquid foods, fast eating), "moderate" (typical), "thorough" (mentions mindful eating, crunchy foods requiring more chewing)
- distraction: "focused" (eating mindfully, at table), "some" (casual setting), "distracted" (screen visible, mentions working while eating)
- stress: "calm" (relaxed setting), "moderate" (neutral), "stressed" (mentions deadline, rushing, tense body language)
- social: "alone" or "with_others" (other people visible or mentioned)

Base assessment on visible cues and text context only.
If no eating context cues are present, respond with all "moderate" defaults.

Context text: ${input.text || 'None'}`;

  if (input.photos && input.photos.length > 0 && brain.supportsVision) {
    const raw = await brain.vision(prompt, input.photos, { temperature: 0.1 });
    return parseJsonResponse<EatingContext>(raw, EATING_FALLBACK);
  }

  if (input.text) {
    return brain.json<EatingContext>(prompt, EATING_CONTEXT_SCHEMA, EATING_FALLBACK, { temperature: 0.1 });
  }

  return EATING_FALLBACK;
}
