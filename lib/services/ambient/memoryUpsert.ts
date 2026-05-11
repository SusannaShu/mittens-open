/**
 * ambient/memoryUpsert.ts -- Three-tier memory retrieval and upsert.
 *
 * Provides context to the scene classifier by retrieving relevant memories.
 * Also handles learning new facts from user responses to mittensAsk queries.
 *
 * Three tiers:
 *   Tier 1: Session memory (in-memory, current session only)
 *           e.g. "just told Mittens this is kefir, not yogurt"
 *   Tier 2: SQLite long-term memory (persisted)
 *           e.g. "Susanna always drinks kefir, not yogurt"
 *   Tier 3: Brain inference (no explicit memory, rely on model)
 *           e.g. model sees white liquid in jar and guesses
 *
 * Retrieval priority: Tier 1 > Tier 2 > Tier 3
 * On mittensAsk resolution, the answer is stored as Tier 1 + Tier 2.
 */

// ═══════════════════════════════════════
// TIER 1: Session Memory (in-memory)
// ═══════════════════════════════════════

interface MemoryNote {
  category: string;
  note: string;
  timestamp: number;
  source: 'user' | 'inferred';
}

/** In-memory session notes -- cleared on app restart */
const sessionMemory: MemoryNote[] = [];

/** Max session notes to keep */
const MAX_SESSION_NOTES = 50;

/**
 * Add a note to session memory.
 * Called when user answers a mittensAsk question or when
 * the pipeline infers something with high confidence.
 */
export function addSessionNote(
  category: string,
  note: string,
  source: 'user' | 'inferred' = 'user',
): void {
  sessionMemory.push({
    category,
    note,
    timestamp: Date.now(),
    source,
  });

  if (sessionMemory.length > MAX_SESSION_NOTES) {
    sessionMemory.shift();
  }

  console.log(`[Memory] Session note added: ${category} -- "${note}"`);
}

/**
 * Retrieve session notes matching a category keyword.
 */
export function getSessionNotes(keyword: string): MemoryNote[] {
  const lower = keyword.toLowerCase();
  return sessionMemory.filter(
    (n) =>
      n.category.toLowerCase().includes(lower) ||
      n.note.toLowerCase().includes(lower),
  );
}

// ═══════════════════════════════════════
// TIER 2: SQLite Long-Term Memory
// ═══════════════════════════════════════

/**
 * Upsert a memory note to the SQLite `memory_notes` table.
 * If a note with the same category exists, update it.
 * Otherwise, insert a new row.
 */
export function upsertLongTermNote(
  category: string,
  note: string,
  source: 'user' | 'inferred' = 'user',
): void {
  try {
    const { getDb } = require('../../database');
    const db = getDb();

    // Check if a note with this category already exists
    const existing = db.getFirstSync(
      'SELECT id FROM memory_notes WHERE category = ?',
      [category],
    ) as any;

    if (existing?.id) {
      db.runSync(
        `UPDATE memory_notes
         SET note = ?, source = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [note, source, existing.id],
      );
      console.log(`[Memory] Updated long-term note: ${category}`);
    } else {
      db.runSync(
        `INSERT INTO memory_notes (category, note, source, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        [category, note, source],
      );
      console.log(`[Memory] Inserted long-term note: ${category}`);
    }
  } catch (err: any) {
    console.warn('[Memory] Long-term upsert failed:', err?.message);
  }
}

/**
 * Retrieve long-term memory notes matching a keyword.
 */
export function getLongTermNotes(keyword: string): Array<{ category: string; note: string }> {
  try {
    const { getDb } = require('../../database');
    const db = getDb();

    const rows = db.getAllSync(
      `SELECT category, note FROM memory_notes
       WHERE category LIKE ? OR note LIKE ?
       ORDER BY updated_at DESC LIMIT 5`,
      [`%${keyword}%`, `%${keyword}%`],
    ) as any[];

    return rows || [];
  } catch (err: any) {
    console.warn('[Memory] Long-term retrieve failed:', err?.message);
    return [];
  }
}

// ═══════════════════════════════════════
// THREE-TIER RETRIEVAL
// ═══════════════════════════════════════

/**
 * Retrieve the most relevant memory for a given context.
 * Checks Tier 1 (session) first, then Tier 2 (SQLite).
 * Returns a compact string for the classifier prompt, or undefined.
 *
 * @returns { tier, text } or null if nothing found
 */
export function retrieveMemory(
  keyword: string,
): { tier: 1 | 2; text: string } | null {
  // Tier 1: session memory (most recent, highest priority)
  const sessionNotes = getSessionNotes(keyword);
  if (sessionNotes.length > 0) {
    const text = sessionNotes
      .slice(-3) // Last 3 relevant notes
      .map((n) => n.note)
      .join('; ');
    return { tier: 1, text };
  }

  // Tier 2: long-term memory
  const ltNotes = getLongTermNotes(keyword);
  if (ltNotes.length > 0) {
    const text = ltNotes
      .slice(0, 3)
      .map((n) => n.note)
      .join('; ');
    return { tier: 2, text };
  }

  // Tier 3: no explicit memory -- classifier relies on model inference
  return null;
}

/**
 * Learn from a mittensAsk response.
 * Stores the answer as both session and long-term memory.
 */
export function learnFromResponse(
  question: string,
  answer: string,
): void {
  // Derive a category from the question
  const category = deriveCategory(question);

  // Session memory
  addSessionNote(category, answer, 'user');

  // Long-term memory
  upsertLongTermNote(category, answer, 'user');

  console.log(`[Memory] Learned: ${category} = "${answer}"`);
}

// ─── Helpers ────────────────────────────

/**
 * Derive a memory category from a question.
 * Simple heuristic: extract the key noun/topic from the question.
 */
function deriveCategory(question: string): string {
  // Remove common question patterns
  const cleaned = question
    .replace(/^(is that|are you|what is|what are|did you)/i, '')
    .replace(/\?/g, '')
    .trim();

  // Take first 3 words as category
  const words = cleaned.split(/\s+/).slice(0, 3);
  return words.join('_').toLowerCase() || 'general';
}
