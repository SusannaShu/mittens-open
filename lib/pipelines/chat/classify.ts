import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { ChatClassifyResult } from '../types';

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    dataNeeded: { type: 'array', items: { type: 'string' } },
    searchQuery: { type: 'string' },
    directReply: { type: 'string' },
  },
  required: ['dataNeeded'],
};

export async function classifyChat(input: PipelineInput): Promise<ChatClassifyResult> {
  const brain = await getBrain();
  
  const prompt = `Classify this user chat message. Does the AI need data (like logs, profile, DB search) to respond properly?

dataNeeded: array of needed data sources like "profile", "activity_logs", "meal_logs", "meal_plan", "pantry", "people", "web_search", or empty array
searchQuery: string if DB search needed, otherwise null
directReply: string if no data needed and you can answer immediately (respond naturally, do not just echo the user's text), otherwise null

CRITICAL RULE: If the user asks for meal or food recommendations (e.g., "what should I eat?"), do NOT provide a directReply. Instead, set dataNeeded to ["meal_plan", "pantry"].

User Message: ${input.text || 'None'}`;

  return brain.json<ChatClassifyResult>(prompt, CLASSIFY_SCHEMA, { dataNeeded: [] }, { temperature: 0.1 });
}
