/**
 * Watch Sources -- saved source shortcuts.
 * SQLite CRUD on watch_sources table.
 *
 * When a user keeps asking about the same source, Mittens can save
 * it as a shortcut so the plan phase can skip brain inference.
 */

import { getDb } from '../../database';

export interface WatchSource {
  id: number;
  url: string;
  label: string | null;
  source_type: string;
  filter_note: string | null;
  fetch_method: string;
  platform: string | null;
  platform_id: string | null;
  created_at: string;
}

/** Get all saved sources. */
export function getSavedSources(): WatchSource[] {
  const db = getDb();
  return db.getAllSync('SELECT * FROM watch_sources ORDER BY created_at DESC') as WatchSource[];
}

/**
 * Find a saved source by keyword match.
 * Checks label, url, and platform_id for a fuzzy match.
 */
export function findSourceByKeyword(text: string): WatchSource | null {
  if (!text.trim()) return null;

  const db = getDb();
  const lower = text.toLowerCase();
  const sources = db.getAllSync('SELECT * FROM watch_sources') as WatchSource[];

  for (const source of sources) {
    const label = (source.label || '').toLowerCase();
    const url = source.url.toLowerCase();
    const platformId = (source.platform_id || '').toLowerCase();

    if (
      (label && lower.includes(label)) ||
      (platformId && lower.includes(platformId)) ||
      lower.includes(url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])
    ) {
      return source;
    }
  }

  return null;
}

/** Save a new source shortcut. */
export function saveSource(source: {
  url: string;
  label?: string;
  sourceType?: string;
  filterNote?: string;
  fetchMethod?: string;
  platform?: string;
  platformId?: string;
}): number {
  const db = getDb();
  const result = db.runSync(
    `INSERT INTO watch_sources (url, label, source_type, filter_note, fetch_method, platform, platform_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      source.url,
      source.label || null,
      source.sourceType || 'web',
      source.filterNote || null,
      source.fetchMethod || 'auto',
      source.platform || null,
      source.platformId || null,
    ],
  );
  return (result as any).lastInsertRowId || 0;
}

/** Delete a saved source. */
export function deleteSource(id: number): void {
  const db = getDb();
  db.runSync('DELETE FROM watch_sources WHERE id = ?', [id]);
}
