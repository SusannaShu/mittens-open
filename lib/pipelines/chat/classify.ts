import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { ChatClassifyResult } from '../types';

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    dataNeeded: { type: 'array', items: { type: 'string' } },
    searchQuery: { type: 'string' },
    directReply: { type: 'string' },
    action: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['dismiss_item', 'regenerate_slot', 'generate_plan', 'set_preference', 'sun_exposure', 'none'] },
        slot: { type: 'string' },
        foodItem: { type: 'string' },
        preference: { type: 'string' },
        persistPref: { type: 'boolean' },
      },
    },
  },
  required: ['dataNeeded'],
};

export async function classifyChat(input: PipelineInput): Promise<ChatClassifyResult> {
  const brain = await getBrain();
  
  const prompt = `Classify this user chat message. Does the AI need data (like logs, profile, DB search) to respond properly?

dataNeeded: array of needed data sources like "profile", "activity_logs", "meal_logs", "meal_plan", "pantry", "people", "web_search", or empty array
searchQuery: string if DB search needed, otherwise null
directReply: string if no data needed and you can answer immediately (respond naturally, do not just echo the user's text), otherwise null

ACTION DETECTION:
If the user wants to CHANGE something (not just ask about it), set the "action" field:
- dismiss_item: "remove X from lunch", "I don't want X", "swap out the X" → {type: "dismiss_item", slot: "lunch", foodItem: "X"}
- regenerate_slot: "give me different dinner", "regenerate breakfast" → {type: "regenerate_slot", slot: "dinner"}
- generate_plan: "make a meal plan", "I want pasta tonight" → {type: "generate_plan", preference: "pasta"}
- set_preference: "I'm vegan", "add vegetarian to preferences" → {type: "set_preference", preference: "vegan", persistPref: true}
- sun_exposure: "how much sun today?", "vitamin D recommendation" → {type: "sun_exposure"}
- none: just a question or conversation → omit action field

If action is set (and type is not "none"), dataNeeded and directReply should be empty — the action handler will respond.

CRITICAL RULES:
- If the user asks for meal or food recommendations (e.g., "what should I eat?"), do NOT provide a directReply. Instead, set dataNeeded to ["meal_plan", "pantry"].
- If the user wants to MODIFY the meal plan (remove item, regenerate, set preference), use the action field instead.

User Message: ${input.text || 'None'}`;

  return brain.json(prompt, CLASSIFY_SCHEMA, { dataNeeded: [] }, { temperature: 0.1 });
}
