/**
 * ambient/groceryCheckout.ts -- Grocery exit messaging, receipt capture, and pantry update.
 *
 * Extracted from groceryPipeline.ts.
 * Handles the post-shopping flow: exit message, receipt listener,
 * receipt OCR -> pantry, or visual-only fallback.
 */

import type { GrocerySession } from './types';

// --- Public API ---

/**
 * Emit the "Done shopping" message with TTS and chat card.
 * Lists the items Mittens spotted during the session.
 */
export function emitGroceryExitMessage(session: GrocerySession): void {
  const count = session.items.length;
  const itemPreview = session.items
    .slice(0, 5)
    .map(i => `${i.qty} ${i.name}`)
    .join(', ');
  const more = count > 5 ? ` and ${count - 5} more` : '';

  const text = [
    `Done shopping! I spotted ${count} items: ${itemPreview}${more}.`,
    'Can you take a photo of your receipt for me to log accurately?',
    'Or I can read out what I saw and add them to your pantry.',
  ].join(' ');

  // TTS
  try {
    const { speak } = require('../voice/ttsService');
    speak(text);
  } catch { /* TTS not available */ }

  // Chat message
  try {
    const { DeviceEventEmitter } = require('react-native');
    DeviceEventEmitter.emit('pendantMessageAdded', {
      id: `m-grocery-${Date.now()}`,
      role: 'mittens',
      text,
      timestamp: new Date(),
      source: 'pendant',
      grocerySession: {
        items: session.items,
        placeName: session.placeName,
      },
    });
  } catch { /* emit not available */ }

  console.log(`[GroceryCheckout] Exit message sent (${count} items)`);
}

/**
 * Arm a listener for receipt photo capture.
 * When the user takes a photo after the grocery exit prompt,
 * route it to the receipt scanner instead of normal frame processing.
 * Auto-disarms after 5 minutes with visual fallback.
 */
export function armReceiptListener(session: GrocerySession): void {
  try {
    const { DeviceEventEmitter } = require('react-native');

    const sub = DeviceEventEmitter.addListener(
      'groceryReceiptPhoto',
      async (event: { framePath: string }) => {
        sub.remove();
        await processReceipt(event.framePath, session);
      },
    );

    // Auto-disarm after 5 minutes
    setTimeout(() => {
      sub.remove();
      // If no receipt, add visual items with lower confidence
      addVisualItemsToPantry(session);
    }, 5 * 60 * 1000);
  } catch { /* event system not available */ }
}

// --- Internals ---

async function processReceipt(
  framePath: string,
  session: GrocerySession,
): Promise<void> {
  try {
    const { scanReceipt } = require('./receiptScanner');
    const result = await scanReceipt(framePath, session.items);
    const { addToPantry } = require('./smartPantry');

    for (const item of result.items) {
      addToPantry(item.name, item.qty, item.unit, 'high');
    }

    const names = result.items.map((i: any) => i.name).join(', ');
    emitSimpleMessage(
      `Updated pantry with ${result.items.length} items from your receipt: ${names}.`,
    );
  } catch (err: any) {
    console.warn('[GroceryCheckout] Receipt processing failed:', err?.message);
    addVisualItemsToPantry(session);
  }
}

function addVisualItemsToPantry(session: GrocerySession): void {
  if (session.items.length === 0) return;
  try {
    const { addToPantry } = require('./smartPantry');
    for (const item of session.items) {
      addToPantry(item.name, item.qty, item.unit, 'medium');
    }
    emitSimpleMessage(
      `Added ${session.items.length} items to pantry based on what I saw. You can correct in Pantry.`,
    );
  } catch (err: any) {
    console.warn('[GroceryCheckout] Visual pantry add failed:', err?.message);
  }
}

function emitSimpleMessage(text: string): void {
  try {
    const { DeviceEventEmitter } = require('react-native');
    DeviceEventEmitter.emit('pendantMessageAdded', {
      id: `m-grocery-${Date.now()}`,
      role: 'mittens',
      text,
      timestamp: new Date(),
      source: 'pendant',
    });
  } catch { /* emit not available */ }
}
