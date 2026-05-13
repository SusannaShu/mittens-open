/**
 * ambient/scene.ts -- Scene lifecycle operations.
 *
 * A Scene represents a continuous engagement (cooking, working, commuting).
 * Opens on first qualifying frame, extends with confirming frames,
 * closes on multi-signal evidence (geofence, scene change, timeout).
 *
 * On close, persists to pendant_scene_log in SQLite.
 */

import type {
  Scene,
  SceneType,
  SubPhase,
  CloseReason,
  SceneClassification,
  PantryDelta,
  SceneFoodData,
} from './types';

let nextId = 1;

/** Generate a unique scene ID */
function generateSceneId(): string {
  return `scene_${Date.now()}_${nextId++}`;
}

/** Create a new scene from an initial classification */
export function openScene(
  classification: SceneClassification,
  place?: string,
): Scene {
  const now = Date.now();
  return {
    id: generateSceneId(),
    openedAt: now,
    lastActiveAt: now,
    type: classification.sceneType,
    subPhase: classification.subPhase,
    place,
    pantryDeltas: [],
    frameCount: 1,
    framePaths: [],
    food: isFoodScene(classification.sceneType)
      ? { ingredients: [...classification.items] }
      : undefined,
  };
}

/** Extend a scene with new frame evidence */
export function extendScene(
  scene: Scene,
  classification: SceneClassification,
  framePath?: string,
): void {
  scene.lastActiveAt = Date.now();
  scene.frameCount += 1;

  if (framePath) {
    scene.framePaths.push(framePath);
    scene.lastFramePath = framePath;
  }

  // Update sub-phase if it progressed
  if (classification.subPhase !== scene.subPhase) {
    scene.subPhase = classification.subPhase;
  }

  // Merge new food items into the scene
  if (scene.food && classification.items.length > 0) {
    mergeIngredients(scene.food, classification.items);
  }
}

/** Transition a scene's sub-phase (e.g. prep -> cook -> eat) */
export function transitionSubPhase(scene: Scene, newPhase: SubPhase): void {
  scene.subPhase = newPhase;
  scene.lastActiveAt = Date.now();
}

/** Close a scene with a reason */
export function closeScene(scene: Scene, reason: CloseReason): void {
  scene.closedAt = Date.now();
  scene.closeReason = reason;
}

/** Check if a scene should safety-timeout (30min no activity) */
export function isTimedOut(scene: Scene, nowMs: number = Date.now()): boolean {
  const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  return (nowMs - scene.lastActiveAt) >= TIMEOUT_MS;
}

/** Fast text pre-check: does scene type allow a match? (sync, no API call) */
export function matchesSceneType(
  scene: Scene,
  classification: SceneClassification,
): boolean {
  // Same scene type is a candidate
  if (scene.type === classification.sceneType) return true;

  // meal_prep can transition to eating
  if (
    scene.type === 'meal_prep' &&
    classification.sceneType === 'eating'
  ) return true;

  return false;
}

/**
 * Vision-based scene continuity check.
 * Only called when matchesSceneType returns true -- compares actual frames
 * to determine if it's the same continuous event or a new one.
 * Falls back to text match if vision is unavailable.
 */
export async function matchesSceneVision(
  scene: Scene,
  classification: SceneClassification,
  currentFramePath: string,
): Promise<{ matches: boolean; continuityScore: number; changes?: string }> {
  // Text type must match first (fast gate)
  if (!matchesSceneType(scene, classification)) {
    return { matches: false, continuityScore: 0 };
  }

  // If scene has < 2 frames, skip vision check (not enough history)
  if (scene.frameCount < 2 || !scene.lastFramePath) {
    return { matches: true, continuityScore: 0.8 };
  }

  try {
    const { checkContinuity } = require('./sceneDedup');
    const result = await checkContinuity(scene, currentFramePath);
    return {
      matches: result.isSameScene,
      continuityScore: result.score,
      changes: result.changes,
    };
  } catch {
    // Vision unavailable -- fall back to text match
    return { matches: true, continuityScore: 0.5 };
  }
}

/**
 * @deprecated Use matchesSceneType for sync checks or matchesSceneVision for full check.
 * Kept for backward compatibility with any callers not yet migrated.
 */
export function matchesScene(
  scene: Scene,
  classification: SceneClassification,
): boolean {
  return matchesSceneType(scene, classification);
}

/** Persist a closed scene to the database */
export function persistScene(scene: Scene, pipelineLog?: any): void {
  try {
    const { getDb } = require('../../database');
    const database = getDb();

    database.runSync(
      `INSERT INTO pendant_scene_log (
        scene_type, sub_phase, started_at, ended_at,
        close_reason, place_name, latitude, longitude,
        items, frame_paths, pantry_deltas,
        frame_count, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scene.type,
        scene.subPhase,
        new Date(scene.openedAt).toISOString(),
        scene.closedAt ? new Date(scene.closedAt).toISOString() : null,
        scene.closeReason || null,
        scene.place || null,
        null, // latitude -- populated by captureGate when GPS-synced
        null, // longitude
        scene.food?.ingredients
          ? JSON.stringify(scene.food.ingredients)
          : null,
        scene.framePaths.length > 0
          ? JSON.stringify(scene.framePaths)
          : null,
        scene.pantryDeltas.length > 0
          ? JSON.stringify(scene.pantryDeltas)
          : null,
        scene.frameCount,
        pipelineLog ? JSON.stringify({ pipelineLog }) : null,
      ],
    );

    console.log(
      `[Scene] Persisted scene ${scene.id}: ${scene.type}/${scene.subPhase}` +
      ` (${scene.frameCount} frames, ${scene.closeReason})`,
    );
  } catch (err: any) {
    console.error('[Scene] Failed to persist:', err?.message || err);
  }
}

// ─── Helpers ────────────────────────────

function isFoodScene(type: SceneType): boolean {
  return type === 'meal_prep' || type === 'eating';
}

/** Merge new ingredient detections into existing list (dedup by name) */
function mergeIngredients(
  food: SceneFoodData,
  newItems: SceneClassification['items'],
): void {
  for (const item of newItems) {
    const existing = food.ingredients.find(
      (i) => i.name.toLowerCase() === item.name.toLowerCase(),
    );
    if (existing) {
      // Update confidence if higher
      if (item.confidence > existing.confidence) {
        existing.confidence = item.confidence;
      }
      // Update qty if newly detected
      if (item.qty && !existing.qty) {
        existing.qty = item.qty;
        existing.unit = item.unit;
      }
    } else {
      food.ingredients.push({ ...item });
    }
  }
}
