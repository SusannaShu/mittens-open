/**
 * ambient/groceryPipeline.ts -- Stateful grocery shopping tracker.
 *
 * Tracks items picked up during a shopping trip, accumulates a timeline,
 * and asks the user for a receipt photo at exit to bulk-update pantry.
 *
 * Lifecycle:
 *   1. Frame detected as grocery -> open/resume session
 *   2. Each frame: VLM detects items picked up, appends to timeline
 *   3. Exit detected (no grocery context for 3+ frames):
 *      - Mittens asks: "Can you take a receipt photo or want to hear what I saw?"
 *   4. Receipt photo -> OCR + pantry bulk add
 *      OR readout -> TTS list + confirm -> pantry add
 */

import type { GrocerySession, GroceryItem, DetectedFoodItem } from './types';
import type { PipelineLogger } from '../../pipelines/logger';

// --- Singleton Session State ---

let activeSession: GrocerySession | null = null;
let noGroceryFrameCount = 0;

/** Threshold: how many non-grocery frames before closing session */
const EXIT_FRAME_THRESHOLD = 3;

// --- Public API ---

export function getActiveGrocerySession(): GrocerySession | null {
  return activeSession;
}

/**
 * Process a frame classified as grocery context.
 * Opens a session if none active, then tracks items.
 */
export async function handleGroceryFrame(
  framePath: string,
  detectedItems: DetectedFoodItem[],
  logger: PipelineLogger,
): Promise<GroceryFrameResult> {
  noGroceryFrameCount = 0; // Reset exit counter

  if (!activeSession) {
    activeSession = openSession();
    logger.startPhase('grocery', 'openSession');
    logger.completePhase(0, `Opened grocery session #${activeSession.id}`);
    createGroceryActivity(activeSession);
  }

  // Detect items in this frame
  const trackIdx = logger.startPhase('grocery', 'trackItems');
  const newItems = await detectGroceryItems(framePath, detectedItems);

  for (const item of newItems) {
    const isDuplicate = activeSession.items.some(
      existing => existing.name.toLowerCase() === item.name.toLowerCase(),
    );
    if (!isDuplicate) {
      activeSession.items.push(item);
    }
  }

  logger.completePhase(
    trackIdx,
    `${newItems.length} new, ${activeSession.items.length} total items`,
  );

  return {
    sessionId: activeSession.id,
    totalItems: activeSession.items.length,
    newItems,
    summary: newItems.length > 0
      ? `Spotted: ${newItems.map(i => `${i.qty} ${i.name}`).join(', ')}`
      : 'Scanning...',
  };
}

/**
 * Called when a non-grocery frame arrives while a session is active.
 * After EXIT_FRAME_THRESHOLD consecutive non-grocery frames, close the session.
 */
export async function checkGroceryExit(logger: PipelineLogger): Promise<boolean> {
  if (!activeSession) return false;

  noGroceryFrameCount++;

  if (noGroceryFrameCount >= EXIT_FRAME_THRESHOLD) {
    await closeSession(logger);
    return true;
  }

  return false;
}

// --- Session Lifecycle ---

function openSession(): GrocerySession {
  let placeName: string | undefined;
  try {
    const { getCurrentPlace } = require('../location/locationService');
    placeName = getCurrentPlace() || undefined;
  } catch { /* location not available */ }

  return {
    id: Date.now(),
    startedAt: new Date().toISOString(),
    placeName,
    items: [],
    status: 'active',
  };
}

async function closeSession(logger: PipelineLogger): Promise<void> {
  if (!activeSession) return;

  activeSession.status = 'closed';
  const session = activeSession;
  activeSession = null;
  noGroceryFrameCount = 0;

  const closeIdx = logger.startPhase('grocery', 'closeSession');

  if (session.items.length === 0) {
    logger.completePhase(closeIdx, 'No items detected during session');
    return;
  }

  logger.completePhase(
    closeIdx,
    `Closed with ${session.items.length} items`,
  );

  // Ask user for receipt or readout
  emitGroceryExitMessage(session);
  armReceiptListener(session);
}

// --- Item Detection ---

async function detectGroceryItems(
  framePath: string,
  hintItems: DetectedFoodItem[],
): Promise<GroceryItem[]> {
  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    const hints = hintItems.map(i => i.name).join(', ');
    const prompt = [
      'A person is grocery shopping. What item are they picking up,',
      'putting in their cart, or scanning at checkout?',
      hints ? `Detected items hint: ${hints}` : '',
      '',
      'For each NEW item being actively picked up or added, return:',
      '{"items": [{"name":"avocado","qty":2,"unit":"whole","freshness":"fresh","conf":0.9}]}',
      '',
      'freshness: "fresh", "good", or "near_expiry" (if visible)',
      'Only include items actively being interacted with, not background shelf items.',
      'Return {"items":[]} if nothing is being picked up.',
    ].filter(Boolean).join('\n');

    const raw = brain.supportsVision
      ? await brain.vision(prompt, [framePath])
      : await brain.text(prompt);

    return parseGroceryItems(raw, framePath);
  } catch (err: any) {
    console.warn('[GroceryPipeline] Item detection failed:', err?.message);
    return [];
  }
}

function parseGroceryItems(raw: string, framePath: string): GroceryItem[] {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.items)) return [];

    return parsed.items
      .map((item: any) => ({
        name: String(item.name || '').toLowerCase().trim(),
        qty: Number(item.qty || 1),
        unit: String(item.unit || 'whole'),
        freshness: ['fresh', 'good', 'near_expiry'].includes(item.freshness)
          ? item.freshness
          : undefined,
        confidence: Number(item.conf || item.confidence || 0.7),
        framePath,
        detectedAt: new Date().toISOString(),
      }))
      .filter((item: GroceryItem) => item.name.length > 0);
  } catch {
    return [];
  }
}

// --- Activity Log ---

function createGroceryActivity(session: GrocerySession): void {
  try {
    const { getDb } = require('../../database');
    const db = getDb();

    db.runSync(
      `INSERT INTO activity_logs (
        logged_at, log_name, activity_type, duration_min, mets,
        source, location, created_at, updated_at
      ) VALUES (?, ?, 'grocery_shopping', 0, 2.3, 'pendant', ?, datetime('now'), datetime('now'))`,
      [session.startedAt, 'Grocery shopping', session.placeName || null],
    );
  } catch (err: any) {
    console.warn('[GroceryPipeline] Activity log failed:', err?.message);
  }
}

// --- Chat Messages ---

function emitGroceryExitMessage(session: GrocerySession): void {
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

  console.log(`[GroceryPipeline] Exit message sent (${count} items)`);
}

/**
 * Arm a listener for receipt photo capture.
 * When the user takes a photo after the grocery exit prompt,
 * route it to the receipt scanner instead of normal frame processing.
 */
function armReceiptListener(session: GrocerySession): void {
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
    console.warn('[GroceryPipeline] Receipt processing failed:', err?.message);
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
    console.warn('[GroceryPipeline] Visual pantry add failed:', err?.message);
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

// --- Types ---

export interface GroceryFrameResult {
  sessionId: number;
  totalItems: number;
  newItems: GroceryItem[];
  summary: string;
}
