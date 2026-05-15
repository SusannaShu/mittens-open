/**
 * ambient/pantryScanPrompt.ts -- Handles fridge/pantry detection flow.
 *
 * When the food context classifier detects a pantry/fridge view,
 * this module:
 *   1. Does a quick VLM scan of the visible items
 *   2. Asks the user if they want to take a closer photo for better accuracy
 *   3. Listens for the closer photo and runs a detailed scan -> smartPantry update
 *
 * The quick scan is non-destructive (doesn't modify pantry), only the
 * confirmed closer-photo scan triggers an actual pantry update.
 */

import type { DetectedFoodItem } from './types';
import type { PipelineLogger } from '../../pipelines/logger';

// --- Debounce State ---

/** Last time we prompted the user (avoid spamming if they linger at the fridge) */
let lastPromptAt = 0;

/** Minimum gap between pantry prompts (5 minutes) */
const PROMPT_COOLDOWN_MS = 5 * 60 * 1000;

// --- Public API ---

export interface PantryScanResult {
  prompted: boolean;
  quickItems: string[];
  summary: string;
}

/**
 * Handle a frame classified as pantry/fridge context.
 * Does a quick VLM read of visible items, then asks if the user
 * wants to take a closer photo for a full pantry update.
 */
export async function handlePantryFrame(
  framePath: string,
  hintItems: DetectedFoodItem[],
  logger: PipelineLogger,
): Promise<PantryScanResult> {
  // Quick scan to see what's visible
  const scanIdx = logger.startPhase('pantry', 'quickScan');
  const visibleItems = await quickPantryScan(framePath, hintItems);
  logger.completePhase(scanIdx, `${visibleItems.length} items visible`);

  // Check cooldown
  const now = Date.now();
  if (now - lastPromptAt < PROMPT_COOLDOWN_MS) {
    return {
      prompted: false,
      quickItems: visibleItems,
      summary: `Pantry view: ${visibleItems.join(', ') || 'items detected'}. (prompt on cooldown)`,
    };
  }

  // Prompt user
  lastPromptAt = now;
  emitPantryPrompt(visibleItems);
  armPantryPhotoListener(framePath);

  return {
    prompted: true,
    quickItems: visibleItems,
    summary: `Pantry view: ${visibleItems.join(', ') || 'items detected'}. Asked for closer photo.`,
  };
}

// --- Quick Scan ---

/**
 * Fast VLM scan of fridge/pantry contents from the ambient frame.
 * Returns item names only (no pantry mutation).
 */
async function quickPantryScan(
  framePath: string,
  hintItems: DetectedFoodItem[],
): Promise<string[]> {
  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    const hints = hintItems.map(i => i.name).join(', ');
    const prompt = [
      'A wearable camera is looking at a fridge, freezer, or pantry shelf.',
      'List the food items you can see. Be specific about brands if visible.',
      hints ? `Hints: ${hints}` : '',
      '',
      'Return JSON only:',
      '{"items": ["milk", "eggs", "cheddar cheese", "leftover rice"]}',
      '',
      'Include everything visible. If items are hard to identify, skip them.',
    ].filter(Boolean).join('\n');

    const raw = brain.supportsVision
      ? await brain.vision(prompt, [framePath])
      : await brain.text(prompt);

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed.items) ? parsed.items.map(String) : [];
  } catch (err: any) {
    console.warn('[PantryScan] Quick scan failed:', err?.message);
    return [];
  }
}

// --- User Prompt ---

function emitPantryPrompt(visibleItems: string[]): void {
  const preview = visibleItems.slice(0, 4).join(', ');
  const more = visibleItems.length > 4 ? ` and ${visibleItems.length - 4} more` : '';

  let text: string;
  if (visibleItems.length > 0) {
    text = [
      `I can see your pantry! Looks like you have ${preview}${more}.`,
      'Want to take a closer photo so I can update your pantry inventory?',
    ].join(' ');
  } else {
    text = [
      'I see you are checking your fridge or pantry.',
      'Want to take a closer photo so I can update your pantry inventory?',
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
      id: `m-pantry-${Date.now()}`,
      role: 'mittens',
      text,
      timestamp: new Date(),
      source: 'pendant',
      pantryPrompt: true,
    });
  } catch { /* emit not available */ }
}

// --- Photo Listener ---

/**
 * Listen for a closer pantry photo.
 * When received, run a detailed scan and update smartPantry.
 * Auto-disarms after 3 minutes.
 */
function armPantryPhotoListener(originalFramePath: string): void {
  try {
    const { DeviceEventEmitter } = require('react-native');

    const sub = DeviceEventEmitter.addListener(
      'pantryCloseupPhoto',
      async (event: { framePath: string }) => {
        sub.remove();
        await processDetailedPantryScan(event.framePath);
      },
    );

    // Auto-disarm after 3 minutes
    setTimeout(() => {
      sub.remove();
      // User didn't take a photo -- do a best-effort update from the original frame
      processDetailedPantryScan(originalFramePath);
    }, 3 * 60 * 1000);
  } catch { /* event system not available */ }
}

/**
 * Detailed pantry scan: identifies items with quantities and updates smartPantry.
 */
async function processDetailedPantryScan(framePath: string): Promise<void> {
  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    const prompt = [
      'A photo of a fridge, freezer, or pantry shelf.',
      'For each food item visible, estimate quantity and unit.',
      '',
      'Return JSON only:',
      '{"items": [{"name":"milk","qty":1,"unit":"gallon"},{"name":"eggs","qty":6,"unit":"whole"}]}',
      '',
      'Be thorough. Include condiments, leftovers, drinks, everything visible.',
    ].join('\n');

    const raw = brain.supportsVision
      ? await brain.vision(prompt, [framePath])
      : await brain.text(prompt);

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return;

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.items)) return;

    const { syncPantryFromScan } = require('./smartPantry');
    const result = syncPantryFromScan(
      parsed.items.map((item: any) => ({
        name: String(item.name || ''),
        qty: Number(item.qty || 1),
        unit: String(item.unit || 'whole'),
        confidence: 'medium' as const,
        framePath,
      })),
    );

    const summary = `Updated pantry: ${result.added} added, ${result.updated} updated.`;
    emitSimpleMessage(summary);
    console.log(`[PantryScan] ${summary}`);
  } catch (err: any) {
    console.warn('[PantryScan] Detailed scan failed:', err?.message);
  }
}

function emitSimpleMessage(text: string): void {
  try {
    const { DeviceEventEmitter } = require('react-native');
    DeviceEventEmitter.emit('pendantMessageAdded', {
      id: `m-pantry-${Date.now()}`,
      role: 'mittens',
      text,
      timestamp: new Date(),
      source: 'pendant',
    });
  } catch { /* emit not available */ }
}
