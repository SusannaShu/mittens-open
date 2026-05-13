/**
 * ambient/logWriterHelpers.ts -- Shared helpers for the scene log writer.
 *
 * Contains AEIOU phase runner, meal type guesser, nutrient aggregator,
 * and food item dedup/merge logic.
 */

import type { SceneClassification } from './types';
import type { PipelineLogger } from '../../pipelines/logger';

// ─── AEIOU Phase Runner ────

/**
 * Runs only the AEIOU phases that were triaged as detectable.
 * Appends results into the mutable `aeiou` record.
 */
export async function runAEIOUPhases(
  phases: string[],
  framePath: string,
  classification: SceneClassification,
  aeiou: Record<string, string>,
  logger: PipelineLogger,
): Promise<void> {
  const input = { photos: framePath ? [framePath] : [], text: classification.description };

  if (phases.includes('environment')) {
    const idx = logger.startPhase('activity', 'environment');
    try {
      const { inferEnvironment } = require('../../pipelines/activity/environment');
      const result = await inferEnvironment(input);
      if (result.environment) aeiou.environment = result.environment;
      logger.completePhase(idx, result.environment || 'none');
    } catch (err: any) { logger.failPhase(idx, err?.message); }
  }

  if (phases.includes('social')) {
    const idx = logger.startPhase('activity', 'social');
    try {
      const { inferSocial } = require('../../pipelines/activity/social');
      const result = await inferSocial(input);
      if (result.interactions) {
        // Append to existing instead of replacing
        const prev = aeiou.interactions || '';
        aeiou.interactions = prev
          ? `${prev}; ${result.interactions}`
          : result.interactions;
      }
      logger.completePhase(idx, result.interactions || 'none');
    } catch (err: any) { logger.failPhase(idx, err?.message); }
  }

  if (phases.includes('objects')) {
    const idx = logger.startPhase('activity', 'objects');
    try {
      const { inferObjects } = require('../../pipelines/activity/objects');
      const result = await inferObjects(input);
      if (result.objects?.length) {
        const names = result.objects.map((o: any) => o.name || o).join(', ');
        aeiou.objects = aeiou.objects ? `${aeiou.objects}, ${names}` : names;
      }
      logger.completePhase(idx, `${result.objects?.length ?? 0} objects`);
    } catch (err: any) { logger.failPhase(idx, err?.message); }
  }
}

// ─── Meal Helpers ────

export function guessMealType(ts: number): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const hour = new Date(ts).getHours();
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 21) return 'dinner';
  return 'snack';
}

export function aggregateNutrients(results: any[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const r of results) {
    if (!r?.nutrients) continue;
    for (const [key, val] of Object.entries(r.nutrients)) {
      if (typeof val === 'number') {
        totals[key] = (totals[key] || 0) + val;
      }
    }
  }
  return totals;
}

/** Merge new food items into existing list by name (case-insensitive dedup) */
export function mergeItems(existing: any[], incoming: any[]): any[] {
  const map = new Map<string, any>();
  for (const item of existing) {
    map.set((item.name || item.n || '').toLowerCase(), item);
  }
  for (const item of incoming) {
    const key = (item.name || item.n || '').toLowerCase();
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}
