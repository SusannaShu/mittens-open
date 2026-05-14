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
      const { detectEnvironment } = require('../../pipelines/activity/environment');
      const result = await detectEnvironment(input, classification);
      if (result.environment) aeiou.environment = result.environment;
      logger.completePhase(idx, result.environment || 'none');
    } catch (err: any) { logger.failPhase(idx, err?.message); }
  }

  if (phases.includes('social')) {
    const idx = logger.startPhase('activity', 'social');
    try {
      const { detectSocial } = require('../../pipelines/activity/social');
      const result = await detectSocial(input, classification);
      if (result.interactions) {
        // Dedup: merge with existing values via Set
        const existing = (aeiou.interactions || '')
          .split(/[;,]/)
          .map((s: string) => s.trim().toLowerCase())
          .filter(Boolean);
        const merged = new Set(existing);
        merged.add(result.interactions.trim().toLowerCase());
        aeiou.interactions = [...merged].join(', ');
      }
      logger.completePhase(idx, result.interactions || 'none');
    } catch (err: any) { logger.failPhase(idx, err?.message); }
  }

  if (phases.includes('objects')) {
    const idx = logger.startPhase('activity', 'objects');
    try {
      const { detectObjects } = require('../../pipelines/activity/objects');
      const result = await detectObjects(input, classification);
      if (result.objects?.length) {
        const newNames = result.objects.map((o: any) => (o.name || o).toString().trim().toLowerCase());
        const existing = (aeiou.objects || '')
          .split(/[;,]/)
          .map((s: string) => s.trim().toLowerCase())
          .filter(Boolean);
        const merged = new Set([...existing, ...newNames]);
        aeiou.objects = [...merged].join(', ');
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
