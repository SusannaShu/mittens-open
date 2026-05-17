/**
 * ambient/sceneClassifier.ts -- Multi-signal scene triage for pendant frames.
 *
 * Single VLM call that extracts independent health signals from every frame:
 *   - nature (touch grass score)
 *   - outdoors (vitamin D score)
 *   - movement + type (MET health score)
 *   - screenUse (sedentary timer)
 *   - foodContext (eating/grocery/cooking/pantry triggers deeper pipeline)
 *
 * Every frame always gets a title and description -- no more "Nothing detected."
 */

import type {
  SceneTriage,
  SceneSignals,
  DetectedFoodItem,
  ClassifierContext,
} from './types';

const DEFAULT_SIGNALS: SceneSignals = {
  nature: false,
  outdoors: false,
  movement: false,
  screenUse: false,
  foodContext: null,
};

/** Triage a pendant frame into multi-signal health data */
export async function triageFrame(
  framePath: string,
  context: ClassifierContext,
): Promise<SceneTriage> {
  const { getBrain } = require('../../brain/selector');
  const brain = await getBrain();

  const prompt = buildPrompt(context);

  const fallback: SceneTriage = {
    title: 'Capture',
    description: '',
    signals: { ...DEFAULT_SIGNALS },
    foodItems: [],
    people: 0,
  };

  try {
    const raw = await brain.vision(prompt, [framePath]);
    return parseTriage(raw, fallback);
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('[Classifier] Vision failed:', msg);

    const isConnectivityError =
      err?.name === 'ConnectionError' ||
      msg.includes('Network request failed') ||
      msg.includes('Failed to fetch') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('Cannot reach') ||
      msg.includes('AbortError') ||
      msg.includes('Model file not downloaded');

    if (isConnectivityError) {
      return { ...fallback, error: `Brain offline: ${msg}` };
    }

    return fallback;
  }
}

// --- Prompt Construction ---

function buildPrompt(ctx: ClassifierContext): string {
  const parts: string[] = [
    'Analyze this photo from a wearable camera. The person wearing the camera is the subject.',
    'You MUST always provide a title and description for the scene.',
    'Respond JSON only:',
    '{',
    '  "title": "short scene title (2-5 words, e.g. Park afternoon, Morning commute, Desk work)",',
    '  "description": "one-line description of the overall scene",',
    '  "signals": {',
    '    "nature": true/false (trees, grass, water, flowers, parks, garden visible?),',
    '    "outdoors": true/false (is this outside, not inside a building?),',
    '    "movement": true/false (person is walking, running, cycling, exercising?),',
    '    "movementType": "walking" or null (free-form: walking, running, cycling, hiking, gym, yoga, dancing, swimming, etc),',
    '    "screenUse": true/false (laptop, phone, tablet, monitor visible and being used?),',
    '    "foodContext": "eating"|"grocery"|"cooking"|"pantry"|null',
    '  },',
    '  "foodItems": [{"name":"...", "qty":1, "unit":"whole", "conf":0.9}] or [] (only if food visible),',
    '  "people": 0 (number of visible faces/people),',
    '  "sleepContext": {"isDark": true/false, "screensVisible": true/false} or null',
    '}',
    '',
    'foodContext definitions:',
    '- "eating": consuming food/drink, plated food, cup in hand, snacking',
    '- "grocery": in a store/market, items on shelves, shopping cart, checkout',
    '- "cooking": preparing food, cutting, stirring, using stove/oven/blender',
    '- "pantry": looking at fridge, freezer, pantry shelf, food storage',
    '- null: no food-related activity',
  ];

  if (ctx.place) {
    parts.push(`Location: ${ctx.place}`);
  }

  if (ctx.motionType) {
    parts.push(`Motion sensor: ${ctx.motionType}`);
  }

  if (ctx.recentMemory) {
    parts.push(`Notes: ${ctx.recentMemory}`);
  }

  return parts.join('\n');
}

// --- Response Parsing ---

function parseTriage(
  raw: string,
  fallback: SceneTriage,
): SceneTriage {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = JSON.parse(jsonMatch[0]);

    // Parse signals
    const rawSig = parsed.signals || {};
    const validFoodContexts = ['eating', 'grocery', 'cooking', 'pantry'];
    const signals: SceneSignals = {
      nature: Boolean(rawSig.nature),
      outdoors: Boolean(rawSig.outdoors),
      movement: Boolean(rawSig.movement),
      movementType: rawSig.movementType || undefined,
      screenUse: Boolean(rawSig.screenUse),
      foodContext: validFoodContexts.includes(rawSig.foodContext)
        ? rawSig.foodContext
        : null,
    };

    // Parse food items
    const foodItems: DetectedFoodItem[] = Array.isArray(parsed.foodItems)
      ? parsed.foodItems
          .map((item: any) => ({
            name: String(item.name || item.n || ''),
            qty: item.qty || item.q || undefined,
            unit: item.unit || item.u || undefined,
            confidence: Number(item.conf || item.confidence || 0.5),
          }))
          .filter((item: any) => item.name.length > 0)
      : [];

    // Parse sleep context
    const rawSleep = parsed.sleepContext;
    const sleepContext = rawSleep
      ? {
          isDark: Boolean(rawSleep.isDark),
          screensVisible: Boolean(rawSleep.screensVisible),
        }
      : undefined;

    return {
      title: parsed.title || fallback.title,
      description: parsed.description || parsed.desc || '',
      signals,
      foodItems,
      people: Number(parsed.people || parsed.ppl || 0),
      sleepContext,
    };
  } catch (err) {
    console.warn('[Classifier] Parse failed, using fallback');
    return fallback;
  }
}
