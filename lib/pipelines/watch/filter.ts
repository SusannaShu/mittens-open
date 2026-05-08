/**
 * Watch Filter -- Phase 3 (brain).
 *
 * Every item goes through the brain for relevance filtering.
 * The brain only sees pre-split titles + short snippets (never raw HTML).
 *
 * Two modes:
 *   - Text batch: groups of 5 items, brain keeps/skips by filter
 *   - Vision per-image: brain.vision() on each story image (future)
 *
 * If no explicit filter, uses user's interests from profile memory.
 */

import { getBrain } from '../../brain/selector';
import type { WatchFetchedItem, WatchFilterResult } from '../types';

const BATCH_SIZE = 5;

/**
 * Filter fetched items using the brain.
 * Returns kept items and skipped items with reasons.
 */
export async function filterWatchItems(
  items: WatchFetchedItem[],
  filter: string,
  needsVision: boolean,
): Promise<WatchFilterResult> {
  if (items.length === 0) {
    return { kept: [], skipped: [] };
  }

  // If no filter, keep everything (user didn't specify what to filter for)
  if (!filter.trim()) {
    return { kept: items, skipped: [] };
  }

  const brain = await getBrain();

  if (needsVision) {
    return filterWithVision(brain, items, filter);
  } else {
    return filterTextBatch(brain, items, filter);
  }
}

/**
 * Filter text items in batches of 5.
 * Brain sees: numbered list of titles, returns which to keep.
 */
async function filterTextBatch(
  brain: any,
  items: WatchFetchedItem[],
  filter: string,
): Promise<WatchFilterResult> {
  const kept: WatchFetchedItem[] = [];
  const skipped: Array<{ item: WatchFetchedItem; reason: string }> = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    // Build a compact numbered list for the brain
    const listing = batch
      .map((item, idx) => {
        const snippet = item.body ? ` -- ${item.body.slice(0, 80)}` : '';
        return `${idx + 1}. ${item.title}${snippet}`;
      })
      .join('\n');

    const prompt = `Filter for user. Keep only: "${filter}"
Items:
${listing}
Return JSON: {"keep":[1,3],"skip":[2,4,5],"reasons":{"2":"not relevant","4":"off topic","5":"not matching"}}`;

    try {
      const raw = await brain.text(prompt, { temperature: 0.1 });
      const parsed = parseFilterResponse(raw, batch.length);

      for (let j = 0; j < batch.length; j++) {
        const itemNum = j + 1;
        if (parsed.keep.includes(itemNum)) {
          kept.push(batch[j]);
        } else {
          skipped.push({
            item: batch[j],
            reason: parsed.reasons?.[String(itemNum)] || 'filtered out',
          });
        }
      }
    } catch (err: any) {
      // On brain error, keep the whole batch (fail open)
      console.error('[Watch] Filter batch failed, keeping all:', err?.message);
      kept.push(...batch);
    }
  }

  return { kept, skipped };
}

/**
 * Filter visual items (IG stories) one at a time with brain.vision().
 * Deferred until IG fetch is implemented.
 */
async function filterWithVision(
  brain: any,
  items: WatchFetchedItem[],
  filter: string,
): Promise<WatchFilterResult> {
  const kept: WatchFetchedItem[] = [];
  const skipped: Array<{ item: WatchFetchedItem; reason: string }> = [];

  for (const item of items) {
    if (!item.imageLocalPath || !brain.supportsVision) {
      // No image to analyze, keep by default
      kept.push(item);
      continue;
    }

    try {
      const prompt = `Is this image about: "${filter}"?
Return JSON: {"keep":true|false,"reason":"one line"}`;

      const raw = await brain.vision(prompt, [item.imageLocalPath], { temperature: 0.1 });
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.keep) {
          kept.push(item);
        } else {
          skipped.push({ item, reason: parsed.reason || 'not matching filter' });
        }
      } else {
        kept.push(item); // fail open
      }
    } catch {
      kept.push(item); // fail open
    }
  }

  return { kept, skipped };
}

function parseFilterResponse(
  raw: string,
  batchSize: number,
): { keep: number[]; skip: number[]; reasons?: Record<string, string> } {
  const defaults = {
    keep: Array.from({ length: batchSize }, (_, i) => i + 1),
    skip: [] as number[],
  };

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return defaults;
    const parsed = JSON.parse(match[0]);
    return {
      keep: parsed.keep || defaults.keep,
      skip: parsed.skip || [],
      reasons: parsed.reasons,
    };
  } catch {
    return defaults;
  }
}
