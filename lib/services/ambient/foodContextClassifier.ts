/**
 * ambient/foodContextClassifier.ts -- Sub-classifies nutrition frames.
 *
 * After the dual classifier detects food, this phase determines
 * WHAT the person is doing with it: eating, grocery shopping, or cooking.
 * Each context routes to a different downstream pipeline.
 */

import type { DetectedFoodItem, FoodContext } from './types';

// --- Public API ---

export interface FoodContextResult {
  context: FoodContext;
  confidence: number;
  /** Optional cooking action detail (e.g., "steaming salmon") */
  cookingAction?: string;
}

/**
 * Classify food context from a pendant frame.
 * Returns eating / grocery / cooking with confidence.
 */
export async function classifyFoodContext(
  framePath: string,
  items: DetectedFoodItem[],
  place?: string,
): Promise<FoodContextResult> {
  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    const prompt = buildPrompt(items, place);
    const raw = brain.supportsVision
      ? await brain.vision(prompt, [framePath])
      : await brain.text(prompt);

    return parseResponse(raw);
  } catch (err: any) {
    console.warn('[FoodContext] Classification failed, defaulting to eating:', err?.message);
    return { context: 'eating', confidence: 0.5 };
  }
}

// --- Prompt ---

function buildPrompt(items: DetectedFoodItem[], place?: string): string {
  const itemList = items.map(i => i.name).join(', ');

  const parts = [
    'A wearable camera captured this photo. Food/drink has been detected.',
    items.length > 0 ? `Detected items: ${itemList}` : '',
    place ? `Location: ${place}` : '',
    '',
    'Classify what the person is doing with the food. Respond JSON only:',
    '{',
    '  "context": "eating" | "grocery" | "cooking" | "pantry",',
    '  "confidence": 0-1,',
    '  "cookingAction": "steaming salmon" (only if cooking, null otherwise)',
    '}',
    '',
    'Definitions:',
    '- "eating": Person is consuming food/drink. Plated food, cup in hand, snacking.',
    '  Also applies to packaged food/drink being opened to consume.',
    '- "grocery": Person is in a store/market. Items on shelves, in shopping cart,',
    '  at checkout, or being scanned. The person is SHOPPING, not eating.',
    '- "cooking": Person is preparing food. Cutting, mixing, stirring, using stove,',
    '  oven, steamer, microwave, blender. Raw ingredients on counter being prepped.',
    '  Include the specific action in cookingAction.',
    '- "pantry": Person is looking at a fridge, freezer, pantry shelf, or food storage',
    '  area. Door is open, items visible on shelves. They are NOT eating, cooking, or',
    '  shopping. They are checking, organizing, or browsing their stored food.',
  ];

  return parts.filter(Boolean).join('\n');
}

// --- Parse ---

function parseResponse(raw: string): FoodContextResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return { context: 'eating', confidence: 0.5 };

    const parsed = JSON.parse(jsonMatch[0]);
    const validContexts: FoodContext[] = ['eating', 'grocery', 'cooking', 'pantry'];
    const context = validContexts.includes(parsed.context) ? parsed.context : 'eating';

    return {
      context,
      confidence: Number(parsed.confidence || parsed.conf || 0.5),
      cookingAction: context === 'cooking' ? parsed.cookingAction || undefined : undefined,
    };
  } catch {
    return { context: 'eating', confidence: 0.5 };
  }
}
