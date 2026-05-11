/**
 * ambient/smartPantry.ts -- Portion-aware ingredient tracking.
 *
 * The brain estimates quantity consumed from vision frames.
 * This module tracks what's in the pantry, decrements on use,
 * and flags "running low" when quantity drops below 30% of last added.
 *
 * Confidence badges:
 *   high   -- brain clearly saw the item and quantity (e.g., "3 almonds")
 *   medium -- brain identified item, quantity estimated (e.g., "handful")
 *   guess  -- item inferred from context, quantity unknown
 *
 * "Running low" trigger: when remaining < 30% of last_added_qty
 */

import type { PantryDelta } from './types';

// ═══════════════════════════════════════
// PANTRY OPERATIONS
// ═══════════════════════════════════════

/**
 * Apply pantry deltas from a closed scene.
 * Decrements quantities for consumed items, adds new items if unseen.
 * Returns items that are now running low.
 */
export function applyPantryDeltas(
  deltas: PantryDelta[],
): Array<{ name: string; remaining: number; unit: string }> {
  const runningLow: Array<{ name: string; remaining: number; unit: string }> = [];

  for (const delta of deltas) {
    try {
      const result = applyDelta(delta);
      if (result?.isLow) {
        runningLow.push({
          name: delta.name,
          remaining: result.remaining,
          unit: delta.unit,
        });
      }
    } catch (err: any) {
      console.warn(`[Pantry] Failed to apply delta for ${delta.name}:`, err?.message);
    }
  }

  if (runningLow.length > 0) {
    console.log(
      `[Pantry] Running low: ${runningLow.map((i) => `${i.name} (${i.remaining}${i.unit})`).join(', ')}`,
    );
  }

  return runningLow;
}

/**
 * Add a new item to the pantry or restock an existing one.
 */
export function addToPantry(
  itemName: string,
  quantity: number,
  unit: string,
  confidence: 'high' | 'medium' | 'guess' = 'guess',
): void {
  try {
    const { getDb } = require('../../database');
    const db = getDb();
    const normalized = itemName.toLowerCase().trim();

    const existing = db.getFirstSync(
      'SELECT id, quantity FROM smart_pantry WHERE LOWER(item_name) = ?',
      [normalized],
    ) as any;

    if (existing?.id) {
      db.runSync(
        `UPDATE smart_pantry
         SET quantity = quantity + ?, last_added_qty = ?, confidence = ?,
             last_seen_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
        [quantity, quantity, confidence, existing.id],
      );
      console.log(`[Pantry] Restocked ${normalized}: +${quantity}${unit}`);
    } else {
      db.runSync(
        `INSERT INTO smart_pantry (item_name, quantity, unit, last_added_qty, confidence, last_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [normalized, quantity, unit, quantity, confidence],
      );
      console.log(`[Pantry] Added new item: ${normalized} (${quantity}${unit})`);
    }
  } catch (err: any) {
    console.warn('[Pantry] Add failed:', err?.message);
  }
}

/**
 * Get all pantry items, optionally filtered by running-low status.
 */
export function getPantryItems(
  onlyLow?: boolean,
): Array<{
  name: string;
  quantity: number;
  unit: string;
  isLow: boolean;
  confidence: string;
}> {
  try {
    const { getDb } = require('../../database');
    const db = getDb();

    const rows = db.getAllSync(
      'SELECT item_name, quantity, unit, last_added_qty, confidence FROM smart_pantry ORDER BY updated_at DESC',
    ) as any[];

    const items = (rows || []).map((r: any) => ({
      name: r.item_name,
      quantity: r.quantity,
      unit: r.unit,
      isLow: isRunningLow(r.quantity, r.last_added_qty),
      confidence: r.confidence,
    }));

    if (onlyLow) {
      return items.filter((i) => i.isLow);
    }
    return items;
  } catch (err: any) {
    console.warn('[Pantry] Get items failed:', err?.message);
    return [];
  }
}

// ═══════════════════════════════════════
// INTERNAL
// ═══════════════════════════════════════

function applyDelta(
  delta: PantryDelta,
): { remaining: number; isLow: boolean } | null {
  const { getDb } = require('../../database');
  const db = getDb();
  const normalized = delta.name.toLowerCase().trim();

  const existing = db.getFirstSync(
    'SELECT id, quantity, last_added_qty FROM smart_pantry WHERE LOWER(item_name) = ?',
    [normalized],
  ) as any;

  if (!existing?.id) {
    // Item not tracked yet -- we can't decrement what we don't have.
    // Log it as a first sighting instead.
    console.log(`[Pantry] Unknown item "${normalized}" consumed -- not tracked`);
    return null;
  }

  const newQty = Math.max(0, existing.quantity + delta.qtyChange);

  db.runSync(
    `UPDATE smart_pantry
     SET quantity = ?, confidence = ?,
         last_seen_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
    [newQty, delta.confidence, existing.id],
  );

  const isLow = isRunningLow(newQty, existing.last_added_qty);

  console.log(
    `[Pantry] ${normalized}: ${existing.quantity} -> ${newQty}${delta.unit}` +
    ` (${delta.reason})${isLow ? ' [RUNNING LOW]' : ''}`,
  );

  return { remaining: newQty, isLow };
}

/**
 * Item is "running low" when remaining < 30% of last added quantity.
 */
function isRunningLow(remaining: number, lastAdded: number | null): boolean {
  if (!lastAdded || lastAdded <= 0) return false;
  return remaining < lastAdded * 0.3;
}
