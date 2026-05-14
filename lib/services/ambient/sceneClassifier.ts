/**
 * ambient/sceneClassifier.ts -- Vision-based scene classification.
 *
 * Wraps E2B vision() with a compact prompt to classify what the pendant sees.
 * Uses phone context (place, motion) to narrow classification.
 * Returns scene type, sub-phase, identified items, and confidence.
 *
 * Prompt stays minimal (~150 tokens) to fit E2B's effective context window.
 * Three-tier memory retrieval happens before classification when needed.
 */

import type {
  SceneClassification,
  ClassifierContext,
  SceneType,
  SubPhase,
} from './types';

/** Classify a pendant frame into a scene type */
export async function classifyFrame(
  framePath: string,
  context: ClassifierContext,
): Promise<SceneClassification> {
  const { getBrain } = require('../../brain/selector');
  const brain = await getBrain();

  const prompt = buildPrompt(context);

  const fallback: SceneClassification = {
    sceneType: 'unknown',
    subPhase: 'idle',
    items: [],
    confidence: 0,
  };

  try {
    const raw = await brain.vision(prompt, [framePath]);
    return parseClassification(raw, fallback);
  } catch (err: any) {
    console.error('[SceneClassifier] Vision failed:', err?.message || err);
    return fallback;
  }
}

// ─── Prompt Construction ────────────────

function buildPrompt(ctx: ClassifierContext): string {
  const parts: string[] = [
    'Classify this photo. Respond JSON only.',
    '{',
    '  "t": scene type (cooking_at_home|eating_at_home|eating_out|work|exercise|commute|social|rest|grocery_shopping|errands|unknown),',
    '  "p": phase (prep|cook|plate|eat|cleanup|active|break|transit|idle),',
    '  "items": [{name, qty, unit, conf}] if food visible else [],',
    '  "conf": 0-1 confidence,',
    '  "desc": 1-line description',
    '}',
  ];

  // Add place context if known
  if (ctx.place) {
    parts.push(`Location: ${ctx.place}`);
  }

  // Add motion context
  if (ctx.motionType) {
    parts.push(`Motion: ${ctx.motionType}`);
  }

  // Add active scene context so the brain can detect transitions
  if (ctx.currentScenes && ctx.currentScenes.length > 0) {
    const active = ctx.currentScenes
      .map((s) => `${s.type}/${s.subPhase}`)
      .join(', ');
    parts.push(`Active scenes: ${active}`);
  }

  // Inject retrieved memory notes (from tier 1/2)
  if (ctx.recentMemory) {
    parts.push(`Notes: ${ctx.recentMemory}`);
  }

  return parts.join('\n');
}

// ─── Response Parsing ───────────────────

function parseClassification(
  raw: string,
  fallback: SceneClassification,
): SceneClassification {
  try {
    // Extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = JSON.parse(jsonMatch[0]);

    const sceneType = normalizeSceneType(parsed.t || parsed.type || parsed.sceneType);
    const subPhase = normalizeSubPhase(parsed.p || parsed.phase || parsed.subPhase);

    const items = Array.isArray(parsed.items)
      ? parsed.items.map((item: any) => ({
          name: String(item.name || item.n || ''),
          qty: item.qty || item.q || undefined,
          unit: item.unit || item.u || undefined,
          confidence: Number(item.conf || item.confidence || 0.5),
        })).filter((item: any) => item.name.length > 0)
      : [];

    return {
      sceneType,
      subPhase,
      items,
      confidence: Number(parsed.conf || parsed.confidence || 0.5),
      description: parsed.desc || parsed.description || undefined,
    };
  } catch (err) {
    console.warn('[SceneClassifier] Parse failed, using fallback');
    return fallback;
  }
}

// ─── Normalization ──────────────────────

const VALID_SCENE_TYPES: Set<string> = new Set([
  'cooking_at_home', 'eating_at_home', 'eating_out', 'meal_prep', 'eating',
  'work', 'exercise', 'commute', 'social', 'rest', 'grocery_shopping', 'errands', 'unknown',
]);

const VALID_SUB_PHASES: Set<string> = new Set([
  'prep', 'cook', 'plate', 'eat', 'cleanup',
  'active', 'break', 'transit', 'idle',
]);

function normalizeSceneType(raw: string): SceneType {
  const cleaned = (raw || '').toLowerCase().trim();
  if (VALID_SCENE_TYPES.has(cleaned)) return cleaned as SceneType;

  // Common aliases
  if (cleaned.includes('cook') || cleaned.includes('kitchen')) return 'cooking_at_home';
  if (cleaned.includes('eat') || cleaned.includes('food') || cleaned.includes('meal')) return 'eating_out';
  if (cleaned.includes('grocery') || cleaned.includes('market')) return 'grocery_shopping';
  if (cleaned.includes('desk') || cleaned.includes('laptop') || cleaned.includes('office')) return 'work';
  if (cleaned.includes('walk') || cleaned.includes('bike') || cleaned.includes('drive')) return 'commute';
  if (cleaned.includes('gym') || cleaned.includes('run') || cleaned.includes('sport')) return 'exercise';

  return 'unknown';
}

function normalizeSubPhase(raw: string): SubPhase {
  const cleaned = (raw || '').toLowerCase().trim();
  if (VALID_SUB_PHASES.has(cleaned)) return cleaned as SubPhase;
  return 'active';
}
