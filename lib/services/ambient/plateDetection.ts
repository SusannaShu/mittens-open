/**
 * ambient/plateDetection.ts -- Detect what's on the plate after cooking.
 *
 * Extracted from cookingPipeline.ts.
 * When cooking ends and eating begins, this module detects what's
 * actually on the plate/bowl rather than logging all cooking ingredients.
 * Cross-references against cooking session ingredients for better ID.
 */

import type { CookingIngredient, CookingSession } from './types';

// --- Types ---

export interface PlateItem {
  name: string;
  portion_g: number;
  confidence: number;
}

export interface PlateDetectionResult {
  action: 'ask_confirm' | 'no_session';
  plateItems: PlateItem[];
  cookingIngredients?: CookingIngredient[];
}

// --- Public API ---

/**
 * Detect what's on the plate using VLM.
 * Cross-references against cooking ingredients for better identification.
 */
export async function detectPlateItems(
  framePath: string,
  cookingIngredients: CookingIngredient[],
): Promise<PlateItem[]> {
  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    const ingredientList = cookingIngredients
      .map(i => `${i.name} (${i.qty} ${i.unit})`)
      .join(', ');

    const prompt = [
      'The person just finished cooking and is now eating.',
      `During cooking, these ingredients were used: ${ingredientList}`,
      '',
      'Look at what is ACTUALLY ON THE PLATE/BOWL in this photo.',
      'Do NOT list all cooking ingredients -- only what is being eaten right now.',
      'The person may have cooked a big batch but only plated a portion.',
      '',
      'Return JSON only:',
      '{"plate": [{"name":"salmon fillet","portion_g":150,"conf":0.9}]}',
      '',
      'Use the cooking ingredient context to improve identification',
      '(e.g., "that brown piece is the salmon that was being steamed").',
    ].join('\n');

    const raw = brain.supportsVision
      ? await brain.vision(prompt, [framePath])
      : await brain.text(prompt);

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.plate)) return [];

    return parsed.plate
      .map((item: any) => ({
        name: String(item.name || ''),
        portion_g: Number(item.portion_g || 100),
        confidence: Number(item.conf || item.confidence || 0.7),
      }))
      .filter((i: PlateItem) => i.name.length > 0);
  } catch (err: any) {
    console.warn('[PlateDetection] Failed:', err?.message);
    return [];
  }
}

// --- Chat Message ---

/**
 * Emit a chat message asking the user to confirm plate contents.
 */
export function emitPlateConfirmMessage(
  plateItems: PlateItem[],
  session: CookingSession,
): void {
  const plateNames = plateItems.map(i => i.name).join(', ');
  const ingredientNames = session.ingredients.map(i => i.name).join(', ');

  let text: string;
  if (plateItems.length > 0) {
    text = [
      `Your meal is ready! I see ${plateNames} on your plate.`,
      'Want me to log this, or can you take a closer photo of your bowl?',
      'You can also tell me what you are eating.',
    ].join(' ');
  } else {
    text = [
      `Done cooking with ${ingredientNames}!`,
      'What are you eating? Take a closer photo of your bowl,',
      'or tell me and I will log it for you.',
    ].join(' ');
  }

  // TTS
  try {
    const { speak } = require('../voice/ttsService');
    speak(text);
  } catch { /* TTS not available */ }

  // Chat message
  try {
    const { DeviceEventEmitter } = require('react-native');
    DeviceEventEmitter.emit('pendantMessageAdded', {
      id: `m-cook-${Date.now()}`,
      role: 'mittens',
      text,
      timestamp: new Date(),
      source: 'pendant',
      cookingContext: {
        plateItems,
        cookingIngredients: session.ingredients,
        sessionId: session.id,
      },
    });
  } catch { /* emit not available */ }
}
