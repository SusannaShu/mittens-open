/**
 * Watch Items -- result cache for dedup + history.
 * SQLite CRUD on watch_items table.
 */

import { getDb } from '../../database';

/** Generate a deterministic hash for dedup. */
export function hashItem(title: string, url: string): string {
  // Simple string hash -- good enough for dedup within a session
  const str = `${title.toLowerCase().trim()}|${(url || '').toLowerCase().trim()}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32-bit int
  }
  return Math.abs(hash).toString(36);
}

/** Save shown items to the cache. */
export function saveWatchItems(
  items: Array<{
    sourceId?: number;
    itemHash: string;
    title?: string;
    url?: string;
    summary?: string;
    imageUrl?: string;
    imageLocalPath?: string;
    author?: string;
    publishedAt?: string;
    extractedData?: any;
    filterReason?: string;
  }>,
): void {
  const db = getDb();

  for (const item of items) {
    db.runSync(
      `INSERT INTO watch_items
        (source_id, item_hash, title, url, summary, image_url, image_local_path,
         author, published_at, extracted_data, filter_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.sourceId || null,
        item.itemHash,
        item.title || null,
        item.url || null,
        item.summary || null,
        item.imageUrl || null,
        item.imageLocalPath || null,
        item.author || null,
        item.publishedAt || null,
        item.extractedData ? JSON.stringify(item.extractedData) : null,
        item.filterReason || null,
      ],
    );
  }
}

/** Get hashes of items shown in the last N hours (for dedup). */
export function getRecentItemHashes(hours: number = 24): string[] {
  const db = getDb();
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const rows = db.getAllSync(
    'SELECT item_hash FROM watch_items WHERE shown_at > ?',
    [cutoff],
  ) as Array<{ item_hash: string }>;

  return rows.map((r) => r.item_hash);
}

/** Check if a specific item has been shown recently. */
export function isItemShown(hash: string, hours: number = 24): boolean {
  const db = getDb();
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const row = db.getFirstSync(
    'SELECT id FROM watch_items WHERE item_hash = ? AND shown_at > ?',
    [hash, cutoff],
  );

  return !!row;
}
