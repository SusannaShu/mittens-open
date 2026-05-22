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

export function singularize(name: string): string {
  const clean = name.trim().toLowerCase();
  const manualMap: Record<string, string> = {
    'strawberries': 'strawberry',
    'blueberries': 'blueberry',
    'raspberries': 'raspberry',
    'blackberries': 'blackberry',
    'potatoes': 'potato',
    'sweet potatoes': 'sweet potato',
    'tomatoes': 'tomato',
    'avocados': 'avocado',
    'oranges': 'orange',
    'apples': 'apple',
    'bananas': 'banana',
    'carrots': 'carrot',
    'onions': 'onion',
    'cucumbers': 'cucumber',
    'zucchinis': 'zucchini',
    'lemons': 'lemon',
    'limes': 'lime',
    'peaches': 'peach',
    'pears': 'pear',
    'plums': 'plum',
    'peppers': 'pepper',
    'bell peppers': 'bell pepper',
    'mushrooms': 'mushroom',
    'eggs': 'egg',
    'almonds': 'almond',
    'walnuts': 'walnut',
    'nuts': 'nut',
  };
  if (manualMap[clean]) return manualMap[clean];
  if (clean.endsWith('ies')) return clean.slice(0, -3) + 'y';
  if (clean.endsWith('oes')) return clean.slice(0, -2);
  if (clean.endsWith('s') && !clean.endsWith('ss') && !clean.endsWith('us') && !clean.endsWith('is') && !clean.endsWith('as')) {
    return clean.slice(0, -1);
  }
  return clean;
}

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
    const sName = singularize(itemName);
    const displayName = sName.charAt(0).toUpperCase() + sName.slice(1);

    const existing = db.getFirstSync(
      'SELECT id, quantity FROM smart_pantry WHERE LOWER(item_name) = ?',
      [sName],
    ) as any;

    if (existing?.id) {
      db.runSync(
        `UPDATE smart_pantry
         SET quantity = quantity + ?, last_added_qty = ?, confidence = ?,
             last_seen_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
        [quantity, quantity, confidence, existing.id],
      );
      console.log(`[Pantry] Restocked ${sName}: +${quantity}${unit}`);
    } else {
      db.runSync(
        `INSERT INTO smart_pantry (item_name, quantity, unit, last_added_qty, confidence, last_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [displayName, quantity, unit, quantity, confidence],
      );
      console.log(`[Pantry] Added new item: ${sName} (${quantity}${unit})`);
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

/**
 * Get history of changes for a specific pantry item
 */
export function getPantryHistory(itemId: number): Array<{
  id: number;
  qtyChange: number;
  reason: string;
  framePath?: string;
  createdAt: string;
}> {
  try {
    const { getDb } = require('../../database');
    const db = getDb();

    const rows = db.getAllSync(
      'SELECT id, qty_change, reason, frame_path, created_at FROM pantry_history WHERE item_id = ? ORDER BY created_at DESC',
      [itemId],
    ) as any[];

    return (rows || []).map((r: any) => ({
      id: r.id,
      qtyChange: r.qty_change,
      reason: r.reason,
      framePath: r.frame_path,
      createdAt: r.created_at,
    }));
  } catch (err: any) {
    console.warn(`[Pantry] Get history failed for item ${itemId}:`, err?.message);
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
  const sName = singularize(delta.name);
  const displayName = sName.charAt(0).toUpperCase() + sName.slice(1);

  const existing = db.getFirstSync(
    'SELECT id, quantity, last_added_qty FROM smart_pantry WHERE LOWER(item_name) = ?',
    [sName],
  ) as any;

  let itemId = existing?.id;
  if (!itemId) {
    if (delta.qtyChange > 0) {
      // Add new item from grocery shopping
      const result = db.runSync(
        `INSERT INTO smart_pantry (item_name, quantity, unit, last_added_qty, confidence, last_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [displayName, delta.qtyChange, delta.unit, delta.qtyChange, delta.confidence]
      );
      itemId = result.lastInsertRowId;
      console.log(`[Pantry] Added new item from shopping: ${sName} (${delta.qtyChange}${delta.unit})`);
    } else {
      // Consumption of untracked item
      console.log(`[Pantry] Unknown item "${sName}" consumed -- adding as 0 remaining.`);
      const result = db.runSync(
        `INSERT INTO smart_pantry (item_name, quantity, unit, last_added_qty, confidence, last_seen_at, updated_at)
         VALUES (?, 0, ?, 0, ?, datetime('now'), datetime('now'))`,
        [displayName, delta.unit, delta.confidence]
      );
      itemId = result.lastInsertRowId;
    }
  }

  const newQty = Math.max(0, (existing?.quantity || 0) + delta.qtyChange);

  if (existing?.id) {
    db.runSync(
      `UPDATE smart_pantry
       SET quantity = ?, confidence = ?,
           last_seen_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
      [newQty, delta.confidence, existing.id],
    );
  }

  const isLow = isRunningLow(newQty, existing?.last_added_qty || (delta.qtyChange > 0 ? delta.qtyChange : 0));

  console.log(
    `[Pantry] ${sName}: ${existing?.quantity || 0} -> ${newQty}${delta.unit}` +
    ` (${delta.reason})${isLow ? ' [RUNNING LOW]' : ''}`,
  );

  if (itemId) {
    db.runSync(
      `INSERT INTO pantry_history (item_id, qty_change, reason, frame_path)
       VALUES (?, ?, ?, ?)`,
      [itemId, delta.qtyChange, delta.reason, delta.framePath || null]
    );
  }

  return { remaining: newQty, isLow };
}

/**
 * Item is "running low" when remaining < 30% of last added quantity.
 */
function isRunningLow(remaining: number, lastAdded: number | null): boolean {
  if (!lastAdded || lastAdded <= 0) return false;
  return remaining < lastAdded * 0.3;
}

/**
 * Synchronize pantry from a vision scan.
 * Adds new items, updates quantities of existing ones, and records history.
 */
export function syncPantryFromScan(
  scannedItems: Array<{
    name: string;
    qty: number;
    unit: string;
    confidence: 'high' | 'medium' | 'guess';
    framePath: string;
  }>
): { added: number; updated: number } {
  let added = 0;
  let updated = 0;

  const { getDb } = require('../../database');
  const db = getDb();
  const now = new Date().toISOString();

  // First consolidate duplicates in scannedItems to make sure we don't insert/update duplicates!
  const consolidated: Record<string, { qty: number; unit: string; confidence: 'high' | 'medium' | 'guess' }> = {};

  for (const item of scannedItems) {
    const sName = singularize(item.name);
    if (consolidated[sName]) {
      consolidated[sName].qty += item.qty;
      if (item.unit !== 'units' && item.unit !== 'whole' && item.unit !== 'each' && (consolidated[sName].unit === 'units' || consolidated[sName].unit === 'whole' || consolidated[sName].unit === 'each')) {
        consolidated[sName].unit = item.unit;
      }
    } else {
      consolidated[sName] = {
        qty: item.qty,
        unit: item.unit,
        confidence: item.confidence,
      };
    }
  }

  for (const [name, data] of Object.entries(consolidated)) {
    const existing = db.getFirstSync(
      'SELECT id, quantity, unit FROM smart_pantry WHERE LOWER(item_name) = ?',
      [name]
    ) as any;

    if (existing?.id) {
      const finalUnit = (existing.unit && (data.unit === 'units' || data.unit === 'whole' || data.unit === 'each') && existing.unit !== 'units' && existing.unit !== 'whole' && existing.unit !== 'each')
        ? existing.unit
        : data.unit;

      db.runSync(
        `UPDATE smart_pantry
         SET quantity = quantity + ?, unit = ?, confidence = ?,
             last_seen_at = datetime('now'), updated_at = datetime('now'), last_added_qty = ?
         WHERE id = ?`,
        [data.qty, finalUnit, data.confidence, data.qty, existing.id]
      );

      db.runSync(
        `INSERT INTO pantry_history (item_id, qty_change, reason, frame_path)
         VALUES (?, ?, ?, ?)`,
        [existing.id, data.qty, 'Vision Scan Update', scannedItems[0]?.framePath || null]
      );

      updated++;
    } else {
      const displayName = name.charAt(0).toUpperCase() + name.slice(1);
      const result = db.runSync(
        `INSERT INTO smart_pantry (item_name, quantity, unit, confidence, last_seen_at, updated_at, last_added_qty)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
        [displayName, data.qty, data.unit, data.confidence, data.qty]
      );

      db.runSync(
        `INSERT INTO pantry_history (item_id, qty_change, reason, frame_path)
         VALUES (?, ?, ?, ?)`,
        [result.lastInsertRowId, data.qty, 'Vision Scan Add', scannedItems[0]?.framePath || null]
      );

      added++;
    }
  }

  return { added, updated };
}
