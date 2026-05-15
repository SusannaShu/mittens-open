/**
 * ambient/nutritionCorrection.ts -- Programmatic updates to pendant nutrition logs.
 *
 * Called by voice dispatch corrections and chat card UI handlers.
 * Handles: replace items, update quantity, remove log entirely.
 */

// --- Public API ---

/**
 * Replace all items in a nutrition log with new items.
 * Re-runs nutrient estimation for the new items.
 *
 * Use case: "No, I'm eating carrot" -> replace orange with carrot.
 */
export async function replaceNutritionLogItems(
  logId: number,
  newItems: Array<{ name: string; portion_g?: number; qty?: number }>,
): Promise<void> {
  const { getDb } = require('../../database');
  const db = getDb();

  const logName = newItems.map(i => i.name).join(', ');
  const nutrients = await estimateNutrientsForItems(newItems);

  db.runSync(
    `UPDATE nutrition_logs SET
      items = ?, log_name = ?, nutrients = ?, updated_at = datetime('now')
    WHERE id = ?`,
    [
      JSON.stringify(newItems),
      logName,
      nutrients ? JSON.stringify(nutrients) : null,
      logId,
    ],
  );

  console.log(`[NutritionCorrection] Replaced items in log #${logId}: ${logName}`);
}

/**
 * Update the quantity of a specific item in a nutrition log.
 * Only re-runs nutrient estimation (not food identification).
 *
 * Use case: "I ate 2 oranges not just one"
 */
export async function updateItemQuantity(
  logId: number,
  itemName: string,
  newQty: number,
): Promise<void> {
  const { getDb } = require('../../database');
  const db = getDb();

  const row = db.getFirstSync(
    'SELECT items FROM nutrition_logs WHERE id = ?',
    [logId],
  ) as any;
  if (!row?.items) return;

  const items = JSON.parse(row.items);
  const target = items.find(
    (i: any) => (i.name || i.n || '').toLowerCase() === itemName.toLowerCase(),
  );

  if (target) {
    target.qty = newQty;
    if (target.portion_g) {
      // Scale portion proportionally
      target.portion_g = Math.round(target.portion_g * newQty / (target.qty || 1));
    }
  }

  const nutrients = await estimateNutrientsForItems(items);

  db.runSync(
    `UPDATE nutrition_logs SET
      items = ?, nutrients = ?, updated_at = datetime('now')
    WHERE id = ?`,
    [
      JSON.stringify(items),
      nutrients ? JSON.stringify(nutrients) : null,
      logId,
    ],
  );

  console.log(`[NutritionCorrection] Updated qty in log #${logId}: ${itemName} x${newQty}`);
}

/**
 * Soft-delete a nutrition log.
 *
 * Use case: "I'm not eating it, it's a gift for my friend"
 */
export function removeNutritionLog(logId: number): void {
  const { getDb } = require('../../database');
  const db = getDb();

  db.runSync(
    `UPDATE nutrition_logs SET deleted_at = datetime('now') WHERE id = ?`,
    [logId],
  );

  console.log(`[NutritionCorrection] Soft-deleted nutrition log #${logId}`);
}

/**
 * Add a single new item to an existing nutrition log.
 * Runs nutrient estimation for the full item list.
 */
export async function addItemToLog(
  logId: number,
  newItem: { name: string; portion_g?: number; qty?: number },
): Promise<void> {
  const { getDb } = require('../../database');
  const db = getDb();

  const row = db.getFirstSync(
    'SELECT items, log_name FROM nutrition_logs WHERE id = ?',
    [logId],
  ) as any;

  const existingItems = row?.items ? JSON.parse(row.items) : [];
  existingItems.push(newItem);

  const logName = existingItems.map((i: any) => i.name || i.n).join(', ');
  const nutrients = await estimateNutrientsForItems(existingItems);

  db.runSync(
    `UPDATE nutrition_logs SET
      items = ?, log_name = ?, nutrients = ?, updated_at = datetime('now')
    WHERE id = ?`,
    [
      JSON.stringify(existingItems),
      logName,
      nutrients ? JSON.stringify(nutrients) : null,
      logId,
    ],
  );

  console.log(`[NutritionCorrection] Added ${newItem.name} to log #${logId}`);
}

// --- Nutrient Estimation Helper ---

async function estimateNutrientsForItems(
  items: any[],
): Promise<Record<string, number> | null> {
  try {
    const { estimateNutrients } = require('../../pipelines/food/nutrients');
    const { aggregateNutrients } = require('./logWriterHelpers');

    const results = await Promise.all(
      items.map(async (food: any) => {
        try {
          return await estimateNutrients({
            name: food.name || food.n,
            portion_g: food.portion_g || food.g || 100,
            cooking: food.cooking || food.k || '',
          });
        } catch { return null; }
      }),
    );

    const totals = aggregateNutrients(results.filter(Boolean));
    return Object.keys(totals).length > 0 ? totals : null;
  } catch (err: any) {
    console.warn('[NutritionCorrection] Nutrient estimation failed:', err?.message);
    return null;
  }
}
