/**
 * Watch Extract -- Phase 4 (brain, optional).
 *
 * For kept items that need structured detail extraction.
 * Skipped for sources that already have structured data (API sources).
 *
 * Text items: brain extracts {what, where, when, cost, details}
 * Visual items: brain.vision() reads image + extracts same struct
 */

import { getBrain } from '../../brain/selector';
import type { WatchFetchedItem, WatchExtractedItem } from '../types';

/**
 * Extract structured details from kept items.
 * Only runs on items that would benefit from extraction
 * (e.g., event listings, not HN links).
 */
export async function extractWatchDetails(
  items: WatchFetchedItem[],
  needsVision: boolean,
): Promise<WatchExtractedItem[]> {
  if (items.length === 0) return [];

  // Check if items already have enough structure (API sources)
  const allStructured = items.every(
    (item) => item.meta && Object.keys(item.meta).length > 0,
  );

  if (allStructured) {
    // API items (HN, Reddit, arXiv) already have title + meta -- skip extraction
    return items.map((item) => ({ ...item }));
  }

  const brain = await getBrain();
  const results: WatchExtractedItem[] = [];

  for (const item of items) {
    if (needsVision && item.imageLocalPath && brain.supportsVision) {
      // Vision extraction for image-based items
      const extracted = await extractWithVision(brain, item);
      results.push(extracted);
    } else if (item.body && item.body.length > 20) {
      // Text extraction for items with enough body text
      const extracted = await extractFromText(brain, item);
      results.push(extracted);
    } else {
      // Title-only items -- no extraction needed
      results.push({ ...item });
    }
  }

  return results;
}

async function extractFromText(
  brain: any,
  item: WatchFetchedItem,
): Promise<WatchExtractedItem> {
  const prompt = `Extract event details from this listing.

Title: "${item.title}"
${item.body ? `Details: "${item.body}"` : ''}

Return JSON: {"what":"event name","where":"location or null","when":"date/time or null","cost":"free or price","details":"extra info or null"}
If not an event, return: {"what":"${item.title}"}`;

  try {
    const raw = await brain.text(prompt, { temperature: 0.1 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        ...item,
        extracted: {
          what: parsed.what || item.title,
          where: parsed.where || undefined,
          when: parsed.when || undefined,
          cost: parsed.cost || undefined,
          details: parsed.details || undefined,
        },
      };
    }
  } catch (err: any) {
    console.error('[Watch] Extract failed for item:', item.title, err?.message);
  }

  return { ...item };
}

async function extractWithVision(
  brain: any,
  item: WatchFetchedItem,
): Promise<WatchExtractedItem> {
  if (!item.imageLocalPath) return { ...item };

  const prompt = `What event is shown in this image?
Return JSON: {"what":"event name","where":"location","when":"date/time","cost":"free or price","details":"extra info"}`;

  try {
    const raw = await brain.vision(prompt, [item.imageLocalPath], { temperature: 0.1 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        ...item,
        extracted: {
          what: parsed.what || item.title,
          where: parsed.where || undefined,
          when: parsed.when || undefined,
          cost: parsed.cost || undefined,
          details: parsed.details || undefined,
        },
      };
    }
  } catch (err: any) {
    console.error('[Watch] Vision extract failed:', err?.message);
  }

  return { ...item };
}
