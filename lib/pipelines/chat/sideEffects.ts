import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { ChatSideEffects } from '../types';

const EFFECTS_SCHEMA = {
  type: 'object',
  properties: {
    effects: { type: 'array', items: { type: 'string', enum: ['memory', 'none'] } },
  },
  required: ['effects'],
};

const MEMORY_SCHEMA = {
  type: 'object',
  properties: {
    memoryUpdates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'remove'] },
          category: { type: 'string', enum: ['preference', 'fact'] },
          note: { type: 'string' },
        },
        required: ['action', 'category', 'note'],
      },
    },
  },
  required: ['memoryUpdates'],
};

/**
 * Side effects triage -- the agent decides which effects to run.
 * Returns a list of effect types to execute, or empty if none needed.
 *
 * NOTE: Pantry is NOT a side effect. It's a separate pipeline that triage
 * routes to independently. Side effects are strictly things that are
 * ancillary to a conversation (learning about the user, updating memory).
 */
async function triageSideEffects(
  input: PipelineInput,
  classifyResult: any,
): Promise<string[]> {
  // If classify already determined a direct reply with no data needed,
  // the message is simple chat -- no side effects.
  if (classifyResult?.directReply && (!classifyResult?.dataNeeded || classifyResult.dataNeeded.length === 0)) {
    return [];
  }

  const brain = await getBrain();
  const prompt = `Given this user message, should we learn anything new about the user?
Options: "memory" (learn a preference, allergy, fact, or goal about user), "none"

Rules:
- "memory": user reveals a preference, allergy, dislike, life fact, routine, or goal
  Examples: "I'm vegetarian", "I hate running", "I wake up at 6am", "I'm training for a marathon"
- "none": greetings, questions, status checks, casual chat, food/activity logging

User: ${input.text || 'None'}`;

  const result = await brain.json<{ effects: string[] }>(prompt, EFFECTS_SCHEMA, { effects: [] }, { temperature: 0.1 });
  return result.effects || [];
}

/**
 * Execute memory extraction.
 */
async function executeMemoryEffect(input: PipelineInput): Promise<any> {
  const brain = await getBrain();
  const prompt = `Extract what we should remember about this user from their message.
If nothing to remember, return empty memoryUpdates array.

User: ${input.text || 'None'}`;

  return brain.json<{ memoryUpdates: any[] }>(prompt, MEMORY_SCHEMA, { memoryUpdates: [] }, { temperature: 0.1 });
}

/**
 * Main entry: triage first, then run only the effects the agent selected.
 */
export async function runSideEffects(
  input: PipelineInput,
  classifyResult: any,
): Promise<ChatSideEffects> {
  const effectsToRun = await triageSideEffects(input, classifyResult);

  if (effectsToRun.length === 0) {
    return { memoryUpdates: [], pantryUpdate: null, failureLog: null };
  }

  const result: ChatSideEffects = {
    memoryUpdates: [],
    pantryUpdate: null,
    failureLog: null,
  };

  for (const effect of effectsToRun) {
    if (effect === 'memory') {
      const mem = await executeMemoryEffect(input);
      if (mem?.memoryUpdates) result.memoryUpdates = mem.memoryUpdates;
    }
  }

  return result;
}
