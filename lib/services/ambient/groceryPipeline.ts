/**
 * ambient/groceryPipeline.ts -- Stateful grocery shopping tracker.
 *
 * Tracks items picked up during a shopping trip, accumulates a timeline,
 * and asks the user for a receipt photo at exit to bulk-update pantry.
 *
 * Lifecycle:
 *   1. User is dwelling (GPS not moving much for 3+ min) AND
 *      consecutive frames classify as grocery -> open session
 *   2. Each frame: VLM detects items picked up, appends to timeline
 *   3. GPS shows sustained movement (left store) for 3+ min:
 *      - Close session and ask for receipt photo or readout
 *   4. Receipt photo -> OCR + pantry bulk add
 *      OR readout -> TTS list + confirm -> pantry add
 */

import type { GrocerySession, GroceryItem, DetectedFoodItem } from './types';
import type { PipelineLogger } from '../../pipelines/logger';
import { emitGroceryExitMessage, armReceiptListener } from './groceryCheckout';

// --- Singleton Session State ---

let activeSession: GrocerySession | null = null;

/** GPS anchor of the store -- set when session opens */
let storeAnchor: { lat: number; lon: number } | null = null;

/** Consecutive grocery-classified frames (before session starts) */
let consecutiveGroceryFrames = 0;

/** Timestamp when movement away from store started (for 3-min exit gate) */
let movementStartedAt: number | null = null;

/** How many consecutive grocery frames needed to open a session */
const GROCERY_FRAME_CONFIRM = 3;

/** How long the user must be moving away before we close (ms) */
const EXIT_MOVEMENT_MS = 3 * 60 * 1000; // 3 minutes

/** Distance in meters to consider "left the store" */
const EXIT_DISTANCE_M = 100;

// --- Public API ---

export function getActiveGrocerySession(): GrocerySession | null {
  return activeSession;
}

/**
 * Process a frame classified as grocery context.
 * Only opens a session if user is dwelling (GPS-stationary).
 * If session already active, tracks items.
 */
export async function handleGroceryFrame(
  framePath: string,
  detectedItems: DetectedFoodItem[],
  logger: PipelineLogger,
): Promise<GroceryFrameResult> {
  // Reset movement exit tracker since we're still seeing grocery
  movementStartedAt = null;

  if (!activeSession) {
    // Only open session if user is dwelling (not in transit)
    if (!isDwelling()) {
      consecutiveGroceryFrames = 0;
      return {
        sessionId: 0,
        totalItems: 0,
        newItems: [],
        summary: 'Grocery detected but not dwelling yet.',
      };
    }

    consecutiveGroceryFrames++;

    if (consecutiveGroceryFrames < GROCERY_FRAME_CONFIRM) {
      return {
        sessionId: 0,
        totalItems: 0,
        newItems: [],
        summary: `Grocery detected (${consecutiveGroceryFrames}/${GROCERY_FRAME_CONFIRM} to confirm).`,
      };
    }

    // Confirmed: dwelling + consecutive grocery frames -> open session
    activeSession = openSession();
    consecutiveGroceryFrames = 0;

    const openIdx = logger.startPhase('grocery', 'openSession');
    logger.completePhase(openIdx, `Opened grocery session #${activeSession.id} at ${activeSession.placeName || 'unknown'}`);
    createGroceryActivity(activeSession);
  }

  // Track items in this frame
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
 * Check if the user has left the store.
 * Called on every frame when a grocery session is active (even non-grocery frames).
 *
 * Exit condition: GPS shows sustained movement away from the store anchor
 * for EXIT_MOVEMENT_MS (3 minutes). This means the user has left and is in
 * transit, not just walking around inside the store.
 */
export async function checkGroceryExit(logger: PipelineLogger): Promise<boolean> {
  if (!activeSession) return false;

  // Check if user has moved away from the store
  if (!hasLeftStore()) {
    movementStartedAt = null;
    return false;
  }

  // User is away from store -- start or check the movement timer
  if (!movementStartedAt) {
    movementStartedAt = Date.now();
    return false;
  }

  const movingDuration = Date.now() - movementStartedAt;
  if (movingDuration < EXIT_MOVEMENT_MS) {
    return false; // Not 3 minutes yet
  }

  // 3+ minutes of movement away from store -> close session
  console.log(`[GroceryPipeline] User left store (${Math.round(movingDuration / 1000)}s of movement)`);
  await closeSession(logger);
  return true;
}

// --- GPS Helpers ---

/**
 * Check if user is dwelling (GPS not moving much).
 * Uses the location service's motion type -- stationary or very slow movement.
 */
function isDwelling(): boolean {
  try {
    const { getLastMotionType } = require('../location/locationService');
    const motionType = getLastMotionType();

    // Stationary = clearly dwelling
    // Walking could be walking around a store, which is fine
    // Driving/cycling/running = definitely not shopping
    return motionType === 'stationary' || motionType === 'walking' || motionType === null;
  } catch {
    // If location service unavailable, allow session to start based on frames alone
    return true;
  }
}

/**
 * Check if the user has physically left the store area.
 * Compares current GPS against the store anchor.
 */
function hasLeftStore(): boolean {
  if (!storeAnchor) return false;

  try {
    const { getCurrentLocation, getLastMotionType } = require('../location/locationService');
    const loc = getCurrentLocation();
    if (!loc) return false;

    const motionType = getLastMotionType();

    // Must be actively moving (not just GPS drift)
    const isMoving = motionType !== 'stationary' && motionType !== null;
    if (!isMoving) return false;

    // Check distance from store anchor
    const dist = haversineMeters(storeAnchor.lat, storeAnchor.lon, loc.lat, loc.lon);
    return dist > EXIT_DISTANCE_M;
  } catch {
    return false;
  }
}

function haversineMeters(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- Session Lifecycle ---

function openSession(): GrocerySession {
  let placeName: string | undefined;
  try {
    const { getCurrentPlace, getCurrentLocation } = require('../location/locationService');
    placeName = getCurrentPlace() || undefined;

    // Anchor the store location for exit detection
    const loc = getCurrentLocation();
    if (loc) {
      storeAnchor = { lat: loc.lat, lon: loc.lon };
    }
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
  storeAnchor = null;
  movementStartedAt = null;
  consecutiveGroceryFrames = 0;

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

// --- Types ---

export interface GroceryFrameResult {
  sessionId: number;
  totalItems: number;
  newItems: GroceryItem[];
  summary: string;
}


