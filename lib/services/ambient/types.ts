/**
 * ambient/types.ts -- Type definitions for the ambient intelligence pipeline.
 *
 * Covers scene lifecycle, capture cadence, and pendant integration types.
 * All pendant-triggered intelligence flows through these types.
 */

// ═══════════════════════════════════════
// SCENE TYPES
// ═══════════════════════════════════════

/** High-level scene classifications */
export type SceneType =
  | 'meal_prep'    // legacy: cooking, assembling food
  | 'eating'       // legacy: actively consuming food
  | 'cooking_at_home'
  | 'eating_at_home'
  | 'eating_out'
  | 'work'         // desk work, laptop, reading
  | 'exercise'     // physical activity
  | 'commute'      // walking, biking, transit
  | 'social'       // conversation, gathering
  | 'rest'         // lounging, napping
  | 'errands'      // shopping, chores
  | 'grocery_shopping'
  | 'unknown';

/** Sub-phases within a scene -- tracks progression */
export type SubPhase =
  | 'prep'         // meal_prep: gathering ingredients
  | 'cook'         // meal_prep: actively cooking
  | 'plate'        // meal_prep: plating / serving
  | 'eat'          // eating: consuming
  | 'cleanup'      // eating: washing dishes
  | 'active'       // work/exercise/social: engaged
  | 'break'        // work: on break
  | 'transit'      // commute: moving
  | 'idle';        // default / no specific phase

/** Reasons a scene can close */
export type CloseReason =
  | 'geofence_exit'   // left the location
  | 'scene_change'    // new frame doesn't match this scene
  | 'timeout'         // 30min safety net
  | 'user';           // manual close

// ═══════════════════════════════════════
// SCENE DATA
// ═══════════════════════════════════════

/** Food items identified during a meal scene */
export interface SceneFoodItem {
  name: string;
  qty?: number;
  unit?: string;
  confidence: number;
}

/** Food-specific data attached to meal scenes */
export interface SceneFoodData {
  ingredients: SceneFoodItem[];
  method?: string;
  cookStartAt?: number;
  cookFinishAt?: number;
  plateAt?: number;
  methodRecommendation?: {
    method: string;
    score: number;
    reason: string;
  };
}

/** Eating context for metabolism estimation */
export interface SceneEatingContext {
  pace?: 'rushed' | 'moderate' | 'slow';
  chewing?: 'minimal' | 'moderate' | 'thorough';
  distraction?: 'focused' | 'some' | 'distracted';
  stress?: 'calm' | 'moderate' | 'stressed';
  social?: 'alone' | 'with_others';
}

/** Pantry changes detected during a scene */
export interface PantryDelta {
  name: string;
  qtyChange: number;
  unit: string;
  confidence: 'high' | 'medium' | 'guess';
  reason: string;
  framePath?: string;
}

/** A single scene -- the core unit of ambient intelligence */
export interface Scene {
  id: string;
  openedAt: number;
  lastActiveAt: number;
  closedAt?: number;
  closeReason?: CloseReason;

  type: SceneType;
  subPhase: SubPhase;
  place?: string;

  /** Food-specific (populated when type involves food) */
  food?: SceneFoodData;
  eatingContext?: SceneEatingContext;
  pantryDeltas: PantryDelta[];

  /** People tracking */
  detectedPeopleDetails?: Array<{
    name: string;
    timestamp: number;
    imageUri: string;
  }>;

  /** Frames that built this scene */
  frameCount: number;
  framePaths: string[];
  lastFramePath?: string;
}

// ═══════════════════════════════════════
// CLASSIFIER TYPES
// ═══════════════════════════════════════

/** Output from scene classification (what the brain sees in a frame) */
export interface SceneClassification {
  sceneType: SceneType;
  subPhase: SubPhase;
  items: SceneFoodItem[];
  confidence: number;
  /** Free-text description from the brain */
  description?: string;
  /** Number of people/faces detected in the frame */
  detectedPeople: number;
}

/** Context provided to the classifier alongside the frame */
export interface ClassifierContext {
  place?: string;
  motionType?: string;
  currentScenes?: Array<{ type: SceneType; subPhase: SubPhase }>;
  recentMemory?: string;
}

// ═══════════════════════════════════════
// CAPTURE CADENCE
// ═══════════════════════════════════════

/** Pendant capture mode (matches firmware modes) */
export type CaptureMode = 'passive' | 'active';

/** Capture gate state for managing pendant modes */
export interface CaptureGateState {
  mode: CaptureMode;
  lastModeChange: number;
  /** When in active mode, tag frames with GPS coords */
  pendingGpsTag?: {
    lat: number;
    lon: number;
    timestamp: number;
  };
}

// ═══════════════════════════════════════
// PIPELINE LOG
// ═══════════════════════════════════════

/** Result from a scene pipeline run, stored for debug trace */
export interface ScenePipelineResult {
  sceneId: string;
  classification: SceneClassification;
  action: 'opened' | 'extended' | 'closed' | 'ignored';
  memoryTierUsed?: 1 | 2 | 3;
  pantryDeltas?: PantryDelta[];
}
