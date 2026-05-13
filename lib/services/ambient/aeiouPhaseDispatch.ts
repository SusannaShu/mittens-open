/**
 * ambient/aeiouPhaseDispatch.ts -- Incremental AEIOU phase dispatch.
 *
 * Based on Stanford Life Design's AEIOU framework:
 *   A = Activities (what are you doing?)
 *   E = Environments (where? outdoors? nature?)
 *   I = Interactions (who are you with? social context?)
 *   O = Objects (what are you using? phone? tools?)
 *   U = Users (how do you feel? engagement? energy?)
 *
 * Instead of running all 5 AEIOU dimensions on every capture, this module
 * compares the current frame's detections against the previous frame and
 * only dispatches phases for dimensions that actually changed.
 *
 * Example: if the person count went from 1 to 2, only run the Interaction
 * phase. If environment didn't change, skip it.
 */

import type { Scene } from './types';

// ─── Detection Snapshot ───

export interface FrameDetections {
  /** Scene type from classifier */
  sceneType: string;
  /** Environment: indoor/outdoor/vehicle */
  environment?: 'indoor' | 'outdoor' | 'vehicle';
  /** Number of people visible */
  personCount?: number;
  /** Objects detected (phone, laptop, book, etc.) */
  objects?: string[];
  /** Is nature visible (trees, sky, water) */
  nature?: boolean;
  /** Food items detected */
  foodItems?: string[];
  /** Screen is visible and being looked at */
  screenVisible?: boolean;
  /** Multitasking (using multiple screens or doing multiple complex tasks) */
  multitaskingDetected?: boolean;
  /** Raw description from classifier */
  description?: string;
}

/** Which AEIOU dimensions changed between frames */
export interface ChangedDimensions {
  activity: boolean;
  environment: boolean;
  interaction: boolean;
  objects: boolean;
  user: boolean;
}

/** Result from running an AEIOU phase */
export interface AEIOUPhaseResult {
  dimension: 'A' | 'E' | 'I' | 'O' | 'U';
  timestamp: number;
  /** What was detected */
  value: string;
  /** Confidence 0-1 */
  confidence: number;
  /** Frame path used for this detection */
  framePath?: string;
}

// ─── Previous Frame State (per scene) ───

const previousDetections = new Map<string, FrameDetections>();

/**
 * Compare current frame detections against previous for this scene.
 * Returns which AEIOU dimensions need to be re-evaluated.
 */
export function detectChangedDimensions(
  sceneId: string,
  current: FrameDetections,
): ChangedDimensions {
  const prev = previousDetections.get(sceneId);

  // First frame -- everything is new
  if (!prev) {
    previousDetections.set(sceneId, current);
    return {
      activity: true,
      environment: true,
      interaction: true,
      objects: true,
      user: true,
    };
  }

  const changed: ChangedDimensions = {
    activity: prev.sceneType !== current.sceneType,
    environment: prev.environment !== current.environment ||
                 prev.nature !== current.nature,
    interaction: prev.personCount !== current.personCount,
    objects: !arraysEqual(prev.objects || [], current.objects || []),
    user: false, // User/feeling only changes on explicit input
  };

  // Update stored state
  previousDetections.set(sceneId, current);

  return changed;
}

/**
 * Determine which AEIOU phases should run based on changed dimensions.
 * Returns a list of phase names for the pipeline runner.
 */
export function phasesToRun(
  changed: ChangedDimensions,
): Array<'activity' | 'environment' | 'interaction' | 'objects' | 'user'> {
  const phases: Array<'activity' | 'environment' | 'interaction' | 'objects' | 'user'> = [];

  if (changed.activity) phases.push('activity');
  if (changed.environment) phases.push('environment');
  if (changed.interaction) phases.push('interaction');
  if (changed.objects) phases.push('objects');
  if (changed.user) phases.push('user');

  return phases;
}

/**
 * Build a FrameDetections snapshot from a classifier result.
 * Extracts structured signals that map to AEIOU dimensions.
 */
export async function extractDetections(
  framePath: string,
  classifierResult: { sceneType: string; description?: string; items: any[]; detect?: any },
): Promise<FrameDetections> {
  const desc = (classifierResult.description || '').toLowerCase();

  // Environment detection from description keywords
  let environment: 'indoor' | 'outdoor' | 'vehicle' | undefined;
  if (desc.includes('outdoor') || desc.includes('park') || desc.includes('street') || desc.includes('outside')) {
    environment = 'outdoor';
  } else if (desc.includes('car') || desc.includes('bus') || desc.includes('train') || desc.includes('plane')) {
    environment = 'vehicle';
  } else if (desc.includes('indoor') || desc.includes('room') || desc.includes('desk') || desc.includes('kitchen')) {
    environment = 'indoor';
  }

  // Nature detection
  const nature = desc.includes('tree') || desc.includes('nature') ||
                 desc.includes('garden') || desc.includes('sky') || desc.includes('water');

  // Person count from description heuristics
  let personCount = 0;
  const personMatch = desc.match(/(\d+)\s*(?:person|people|friend|colleague)/);
  if (personMatch) {
    personCount = parseInt(personMatch[1], 10);
  } else if (desc.includes('alone') || desc.includes('solo')) {
    personCount = 0;
  } else if (desc.includes('person') || desc.includes('someone') || desc.includes('friend')) {
    personCount = 1;
  } else if (desc.includes('people') || desc.includes('group') || desc.includes('friends')) {
    personCount = 2;
  }

  // Object detection from description
  const objects: string[] = [];
  const objectKeywords = ['phone', 'laptop', 'book', 'tablet', 'cup', 'glass', 'headphones', 'pen', 'notebook'];
  for (const keyword of objectKeywords) {
    if (desc.includes(keyword)) objects.push(keyword);
  }

  // Food items from classifier
  const foodItems = classifierResult.items
    .map((i: any) => i.name || i.n)
    .filter(Boolean);

  // Screen and multitasking from LLM detect field
  const screenVisible = !!(classifierResult.detect?.screen_time || classifierResult.detect?.scrolling);
  const multitaskingDetected = !!(classifierResult.detect?.multitasking);

  return {
    sceneType: classifierResult.sceneType,
    environment,
    personCount,
    objects,
    nature,
    foodItems,
    screenVisible,
    multitaskingDetected,
    description: classifierResult.description,
  };
}

/**
 * Record an AEIOU phase result into a scene's timeline.
 * This builds the drill-down provenance data for the UI.
 */
export function recordPhaseResult(
  scene: Scene,
  result: AEIOUPhaseResult,
): void {
  // Initialize aeiou_timeline if not present
  if (!(scene as any).aeiou_timeline) {
    (scene as any).aeiou_timeline = [];
  }
  (scene as any).aeiou_timeline.push(result);
}

/** Clear stored detections for a closed scene */
export function clearSceneDetections(sceneId: string): void {
  previousDetections.delete(sceneId);
}

// ─── Helpers ───

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}
