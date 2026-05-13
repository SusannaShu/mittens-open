/**
 * ambient/voiceMealHandler.ts -- Handles voice-commanded meal logging.
 *
 * When the user presses the pendant button and says "log two oranges",
 * this module:
 *   1. Parses the transcript for food items and quantities
 *   2. Checks for recent pendant/ambient meal logs (30-min window)
 *   3. Updates the existing log if found, or creates a new one
 *   4. Kicks off nutrient estimation for new items
 *
 * Returns a response string for TTS feedback.
 */

import { getDb } from '../../database';

// ─── Meal Command Patterns ────

const MEAL_PATTERNS = [
  // "log X", "log some X"
  /\b(?:log|record|track|add)\s+(?:some\s+)?(.+)/i,
  // "I had X", "I ate X", "I drank X"
  /\b(?:i\s+)?(?:had|ate|eaten|eating|drank|drinking|just\s+(?:had|ate))\s+(.+)/i,
  // "mittens log X for me"
  /\bmittens\s+(?:log|record|track|add)\s+(.+?)(?:\s+for\s+me)?$/i,
];

/**
 * Check if a transcript is a meal logging command.
 * Returns the food portion of the transcript if matched.
 */
export function parseMealCommand(transcript: string): string | null {
  const cleaned = transcript.trim();
  for (const pattern of MEAL_PATTERNS) {
    const match = cleaned.match(pattern);
    if (match && match[1]) {
      const foodPart = match[1].trim()
        .replace(/\s+for\s+me\s*$/i, '')
        .replace(/\s+please\s*$/i, '');
      if (foodPart.length > 1) return foodPart;
    }
  }
  return null;
}

// ─── Quantity Parser ────

interface ParsedFoodItem {
  name: string;
  quantity: number;
  unit: string;
}

const QUANTITY_MAP: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  half: 0.5, couple: 2, few: 3, some: 2,
};

/**
 * Parse "two oranges and a banana" into structured items.
 */
export function parseFoodItems(text: string): ParsedFoodItem[] {
  const items: ParsedFoodItem[] = [];

  // Split by "and", commas, "also", "plus"
  const parts = text.split(/\s*(?:,|\band\b|\balso\b|\bplus\b|\bwith\b)\s*/i);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Match "N unit of X" or "N X"
    const quantityMatch = trimmed.match(
      /^(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|half|couple|few|some)\s+(.+)/i,
    );

    if (quantityMatch) {
      const rawQty = quantityMatch[1].toLowerCase();
      const quantity = (QUANTITY_MAP[rawQty] ?? parseFloat(rawQty)) || 1;
      const rest = quantityMatch[2];

      // Check for unit: "cups of coffee", "glasses of water"
      const unitMatch = rest.match(
        /^(cups?|glasses?|bowls?|pieces?|slices?|servings?|scoops?)\s+(?:of\s+)?(.+)/i,
      );

      if (unitMatch) {
        items.push({ name: unitMatch[2], quantity, unit: unitMatch[1].toLowerCase() });
      } else {
        items.push({ name: rest, quantity, unit: 'serving' });
      }
    } else {
      items.push({ name: trimmed, quantity: 1, unit: 'serving' });
    }
  }

  return items;
}

// ─── Recent Log Check ────

const VOICE_DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

interface RecentMealLog {
  id: number;
  logged_at: string;
  items: string | null;
  log_name: string | null;
}

function findRecentMealLog(): RecentMealLog | null {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - VOICE_DEDUP_WINDOW_MS).toISOString();
    return db.getFirstSync(
      `SELECT id, logged_at, items, log_name FROM nutrition_logs
       WHERE source IN ('pendant', 'vision', 'voice') AND logged_at >= ?
       ORDER BY logged_at DESC LIMIT 1`,
      [cutoff],
    ) as RecentMealLog | null;
  } catch {
    return null;
  }
}

// ─── Main Handler ────

export interface VoiceMealResult {
  response: string;
  logId: number | null;
  action: 'created' | 'updated';
  items: ParsedFoodItem[];
}

/**
 * Handle a voice meal command: parse items, dedup, create or update log.
 */
export async function handleVoiceMealCommand(
  foodText: string,
  _framePath?: string,
): Promise<VoiceMealResult> {
  const db = getDb();
  const parsed = parseFoodItems(foodText);

  if (parsed.length === 0) {
    return {
      response: "I could not figure out what food you mentioned. Can you try again?",
      logId: null,
      action: 'created',
      items: [],
    };
  }

  // Build items array for DB storage
  const newItems = parsed.map(p => ({
    name: p.name,
    quantity: p.quantity,
    unit: p.unit,
    portion_g: null,
    nutrients: null,
  }));

  // Check for recent meal log to merge into
  const recentLog = findRecentMealLog();

  if (recentLog) {
    // Merge into existing log
    const existingItems = recentLog.items ? JSON.parse(recentLog.items) : [];
    const mergedItems = [...existingItems, ...newItems];
    const newNames = parsed.map(p =>
      p.quantity > 1 ? `${p.quantity} ${p.name}` : p.name,
    ).join(', ');

    db.runSync(
      `UPDATE nutrition_logs SET
        items = ?, log_name = ?, updated_at = datetime('now')
      WHERE id = ?`,
      [
        JSON.stringify(mergedItems),
        recentLog.log_name
          ? `${recentLog.log_name}, ${newNames}`
          : newNames,
        recentLog.id,
      ],
    );

    console.log(`[VoiceMeal] Updated log #${recentLog.id} with ${parsed.length} item(s)`);

    const itemDesc = parsed.map(p =>
      p.quantity > 1 ? `${p.quantity} ${p.name}` : p.name,
    ).join(' and ');

    return {
      response: `Added ${itemDesc} to your existing meal log.`,
      logId: recentLog.id,
      action: 'updated',
      items: parsed,
    };
  }

  // Create new meal log
  const logName = parsed.map(p =>
    p.quantity > 1 ? `${p.quantity} ${p.name}` : p.name,
  ).join(', ');

  const result = db.runSync(
    `INSERT INTO nutrition_logs (
      logged_at, meal_type, log_name, items, source,
      entry_type, created_at, updated_at
    ) VALUES (?, 'snack', ?, ?, 'voice', 'food', datetime('now'), datetime('now'))`,
    [
      new Date().toISOString(),
      logName,
      JSON.stringify(newItems),
    ],
  );

  const logId = result?.lastInsertRowId ?? null;
  console.log(`[VoiceMeal] Created meal log #${logId}: ${logName}`);

  const itemDesc = parsed.map(p =>
    p.quantity > 1 ? `${p.quantity} ${p.name}` : p.name,
  ).join(' and ');

  return {
    response: `Logged ${itemDesc}. I will estimate the nutrients for you.`,
    logId,
    action: 'created',
    items: parsed,
  };
}
