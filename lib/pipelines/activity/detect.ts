import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { ActivityDetectResult } from '../types';

const ACTIVITY_SCHEMA = {
  type: 'object',
  properties: {
    activityType: { type: 'string', enum: ['walk', 'run', 'bike', 'workout', 'sun', 'work', 'social', 'rest', 'stress', 'soul', 'cooking', 'commute', 'other'] },
    logName: { type: 'string' },
    duration_min: { type: 'number' },
    intensity: { type: 'string', enum: ['low', 'moderate', 'high'] },
    location: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['activityType', 'logName', 'duration_min', 'intensity', 'confidence'],
};

const ACTIVITY_FALLBACK: ActivityDetectResult = {
  activityType: 'other',
  logName: 'Unknown Activity',
  duration_min: 30,
  intensity: 'moderate',
  confidence: 0.5,
};

export async function detectActivity(input: PipelineInput): Promise<ActivityDetectResult> {
  const brain = await getBrain();
  
  const prompt = `You are identifying the specific activity for a personal time-tracking and well-being journal.

Classify the activity from the photo and/or text into one category.
This classification feeds into a Stanford Life Design dashboard where users
track how they spend their time across Work, Health, Play, and Love dimensions.

Provide:
- activityType: the single best-fit category from: walk, run, bike, workout, sun, work, social, rest, stress, soul, cooking, commute, other
- logName: a concise 2-5 word title the user would recognize in their journal (e.g., "Morning walk in park", "Team standup meeting")
- duration_min: estimated duration in minutes based on context clues
- intensity: physical effort level (low, moderate, high)
- location: where the activity is happening, if identifiable
- confidence: how certain you are (0.9+ = clear evidence, 0.5-0.8 = reasonable inference, below 0.5 = set activityType to "other")

Context text: ${input.text || 'None'}
Manual hints: ${JSON.stringify(input.manualData || {})}`;

  // For vision inputs, still use brain.vision() then parse
  if (input.photos && input.photos.length > 0 && brain.supportsVision) {
    const raw = await brain.vision(prompt, input.photos, { temperature: 0.1 });
    return parseJsonResponse<ActivityDetectResult>(raw, ACTIVITY_FALLBACK);
  }

  // Text-only: use grammar-constrained json()
  return brain.json<ActivityDetectResult>(prompt, ACTIVITY_SCHEMA, ACTIVITY_FALLBACK, { temperature: 0.1 });
}

/** Parse JSON from raw brain text output (used for vision responses that can't use grammar) */
export function parseJsonResponse<T>(text: string, defaultFallback: T): T {
  try {
    // Strip thinking blocks before extracting JSON
    let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '');
    if (!cleaned.includes('<think>') && cleaned.includes('</think>')) {
      cleaned = cleaned.slice(cleaned.lastIndexOf('</think>') + '</think>'.length);
    }
    cleaned = cleaned.replace(/<\/?think>/g, '');

    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn('[Pipeline] No JSON found in brain response. Cleaned text:', cleaned.slice(0, 300));
      return defaultFallback;
    }
    return { ...defaultFallback, ...JSON.parse(match[0]) };
  } catch (err) {
    console.error('[Pipeline] Failed to parse JSON from brain response:', text.slice(0, 300));
    console.error('[Pipeline] Parse error:', err);
    return defaultFallback;
  }
}
