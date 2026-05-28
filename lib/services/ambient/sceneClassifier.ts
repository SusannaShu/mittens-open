/**
 * ambient/sceneClassifier.ts -- Context-aware scene triage for pendant frames.
 *
 * Single VLM call that replaces the old quality gate + classifier pipeline.
 * Now handles legibility, scene-change detection, and signal extraction
 * in one pass with full context: time, place, recent scenes, motion, and
 * optionally the previous frame for multi-image context.
 *
 * Key design decisions:
 *   - `usable: false` ONLY for pitch-black/fully covered (not for blur/low-res)
 *   - `sameScene` replaces the separate VLM dedup call
 *   - `roomType` feeds into visual place learning
 *   - Wearable images are EXPECTED to be low-res/blurry — never reject on quality
 */

import type {
  SceneTriage,
  SceneSignals,
  DetectedFoodItem,
} from './types';
import type { ContextSnapshot } from './contextWindow';

const DEFAULT_SIGNALS: SceneSignals = {
  nature: false,
  outdoors: false,
  movement: false,
  screenUse: false,
  foodContext: null,
};

/** Triage a pendant frame with rich context + optional previous frame */
export async function triageFrame(
  framePath: string,
  snapshot: ContextSnapshot,
): Promise<SceneTriage> {
  const { getBrain } = require('../../brain/selector');
  const brain = await getBrain();

  const prompt = buildPrompt(snapshot);

  // Multi-image: [previous frame, current frame] for context
  const images: string[] = [];
  if (snapshot.lastFramePath) {
    images.push(snapshot.lastFramePath);
  }
  images.push(framePath);

  const fallback: SceneTriage = {
    usable: true,
    title: 'Capture',
    description: '',
    signals: { ...DEFAULT_SIGNALS },
    foodItems: [],
    people: 0,
  };

  try {
    const raw = await brain.vision(prompt, images);
    return parseTriage(raw, fallback);
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.warn('[Classifier] Vision attempt 1 failed:', msg);

    // Retry once -- transient model loading / memory pressure errors usually succeed
    try {
      const raw = await brain.vision(prompt, images);
      return parseTriage(raw, fallback);
    } catch (retryErr: any) {
      const retryMsg = retryErr?.message || String(retryErr);
      console.error('[Classifier] Vision retry failed:', retryMsg);

      const isConnectivityError =
        retryErr?.name === 'ConnectionError' ||
        retryMsg.includes('Network request failed') ||
        retryMsg.includes('Failed to fetch') ||
        retryMsg.includes('ECONNREFUSED') ||
        retryMsg.includes('Cannot reach') ||
        retryMsg.includes('Model file not downloaded');

      if (isConnectivityError) {
        return { ...fallback, error: `Brain offline: ${retryMsg}` };
      }

      return fallback;
    }
  }
}

// --- Prompt Construction ---

function buildPrompt(snapshot: ContextSnapshot): string {
  const hasLastFrame = !!snapshot.lastFramePath;

  const parts: string[] = [
    // Image context
    hasLastFrame
      ? 'Two photos from a chest-mounted wearable camera. Photo 1 is the previous capture. Photo 2 is the current capture.'
      : 'Photo from a chest-mounted wearable camera.',
    'These images are EXPECTED to be low-resolution, motion-blurred, and poorly lit. That is normal for wearable cameras.',
    'Your job is to figure out what the user is DOING right now. Do NOT judge image quality.',
    '',

    // Temporal & spatial context
    `Time: ${snapshot.time}`,
  ];

  if (snapshot.place) parts.push(`Place: ${snapshot.place}`);
  if (snapshot.visualPlace) parts.push(`Known room: ${snapshot.visualPlace}`);
  if (snapshot.motion) parts.push(`Motion sensor: ${snapshot.motion}`);
  if (snapshot.currentSession) {
    const elapsed = Math.round((Date.now() - snapshot.currentSession.startedAt) / 60000);
    parts.push(`Current activity: ${snapshot.currentSession.type} for ${elapsed}min`);
  }

  // Recent scene history
  if (snapshot.recentScenes.length > 0) {
    parts.push(`Recent scenes:`);
    snapshot.recentScenes.forEach((s, i) => {
      parts.push(`  ${i + 1}. ${s}`);
    });
  }

  parts.push('');
  parts.push('Respond JSON only:');
  parts.push('{');
  parts.push('  "usable": true/false (false ONLY if pitch-black, fully covered, or absolutely nothing visible),');
  if (hasLastFrame) {
    parts.push('  "sameScene": true/false (has anything meaningful changed between the two photos?),');
  }
  parts.push('  "title": "short action + place (2-5 words, e.g. Walking in Central Park, Working at desk, Cooking dinner)",');
  parts.push('  "description": "one sentence: what is the user doing right now",');
  parts.push('  "signals": {');
  parts.push('    "nature": true/false (trees, grass, water, flowers, parks visible?),');
  parts.push('    "outdoors": true/false (outside, not inside a building?),');
  parts.push('    "movement": true/false (walking, running, cycling, exercising?),');
  parts.push('    "movementType": "walking" or null (walking, running, cycling, hiking, gym, etc),');
  parts.push('    "screenUse": true/false (laptop, phone, tablet being used?),');
  parts.push('    "foodContext": "eating"|"grocery"|"cooking"|"pantry"|null');
  parts.push('  },');
  parts.push('  "foodItems": [{"name":"...", "qty":1, "unit":"whole", "conf":0.9}] or [],');
  parts.push('  "people": 0,');
  parts.push('  "faceLegible": true/false,');
  parts.push('  "sleepContext": {"isDark": true/false, "screensVisible": true/false} or null,');
  parts.push('  "roomType": "kitchen"|"bathroom"|"office"|"bedroom"|"hallway"|"living_room"|"outdoor"|"store"|"gym"|null');
  parts.push('}');
  parts.push('');
  parts.push('foodContext definitions:');
  parts.push('- "eating": consuming food/drink, plated food, cup in hand, snacking');
  parts.push('- "grocery": in a store/market, items on shelves, shopping cart');
  parts.push('- "cooking": preparing food, cutting, stirring, using stove/oven');
  parts.push('- "pantry": looking at fridge, freezer, pantry shelf, food storage');
  parts.push('- null: no food-related activity');

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
      usable: parsed.usable !== false, // Default to usable (wearable-tolerant)
      sameScene: parsed.sameScene !== undefined ? Boolean(parsed.sameScene) : undefined,
      title: parsed.title || fallback.title,
      description: parsed.description || parsed.desc || '',
      signals,
      foodItems,
      people: Number(parsed.people || parsed.ppl || 0),
      faceLegible: parsed.faceLegible !== undefined ? Boolean(parsed.faceLegible) : undefined,
      sleepContext,
      roomType: parsed.roomType || undefined,
    };
  } catch (err) {
    console.warn('[Classifier] Parse failed, using fallback');
    return fallback;
  }
}
