/**
 * ambient/types.ts -- Type definitions for the ambient intelligence pipeline.
 *
 * Simplified dual-classifier architecture:
 *   - Each frame produces independent nutrition and activity signals
 *   - No rigid scene-type taxonomy; activity type is free-form for display
 *   - Quality gate decides frame legibility before classification
 */

// =============================================
// QUALITY GATE
// =============================================

/** Result from the quality gate (Phase 1) */
export interface QualityGateResult {
  /** Is the frame clear enough to analyze? */
  legible: boolean;
  /** Is this essentially the same scene as the last processed frame? */
  sameAsBefore: boolean;
  /** Brief explanation for the decision */
  reason: string;
}

// =============================================
// DUAL CLASSIFIER
// =============================================

/** Food/drink item detected in a frame */
export interface DetectedFoodItem {
  name: string;
  qty?: number;
  unit?: string;
  confidence: number;
}

/** Nutrition signal from the dual classifier */
export interface NutritionSignal {
  /** Whether food/drink/pantry items are visible */
  detected: boolean;
  /** Identified food items */
  items: DetectedFoodItem[];
  /** Free-form context (e.g. "snacking at desk", "cooking pasta") */
  context?: string;
}

/** Activity signal from the dual classifier */
export interface ActivitySignal {
  /** Whether a recognizable activity is happening */
  detected: boolean;
  /** Free-form activity label for display (e.g. "working", "cooking", "gym") */
  type?: string;
  /** One-line description of what the person is doing */
  description?: string;
  /** 0-1 confidence */
  confidence: number;
}

/** Combined output from the dual classifier (Phase 2) */
export interface FrameClassification {
  nutrition: NutritionSignal;
  activity: ActivitySignal;
  /** Number of people/faces visible */
  people: number;
  /** One-line scene description */
  description: string;
  /** Set when classification failed due to brain connectivity */
  error?: string;
}

/** Context provided to the classifier alongside the frame */
export interface ClassifierContext {
  place?: string;
  motionType?: string;
  recentMemory?: string;
}

// =============================================
// CAPTURE CADENCE
// =============================================

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

// =============================================
// FOOD CONTEXT
// =============================================

/** What the person is doing with the food */
export type FoodContext = 'eating' | 'grocery' | 'cooking' | 'pantry';

/** Grocery session state */
export interface GrocerySession {
  id: number;
  startedAt: string;
  placeName?: string;
  items: GroceryItem[];
  status: 'active' | 'checkout' | 'closed';
}

export interface GroceryItem {
  name: string;
  qty: number;
  unit: string;
  freshness?: 'fresh' | 'good' | 'near_expiry';
  confidence: number;
  framePath?: string;
  detectedAt: string;
}

/** Cooking session state */
export interface CookingSession {
  id: number;
  startedAt: string;
  ingredients: CookingIngredient[];
  timers: CookingTimer[];
  status: 'active' | 'plating' | 'closed';
}

export interface CookingIngredient {
  name: string;
  qty: number;
  unit: string;
  confidence: number;
  framePath?: string;
}

export interface CookingTimer {
  ingredient: string;
  /** Cooking method: "steaming", "boiling", "baking", etc. */
  method: string;
  /** Brain-estimated optimal cook time in seconds */
  durationSec: number;
  /** Epoch ms when timer started */
  startedAt: number;
  cancelled: boolean;
}

// =============================================
// PANTRY
// =============================================

/** Pantry changes detected during a scene */
export interface PantryDelta {
  name: string;
  qtyChange: number;
  unit: string;
  confidence: 'high' | 'medium' | 'guess';
  reason: string;
  framePath?: string;
}

// =============================================
// SLEEP NUDGE
// =============================================

/** Sleep nudge classification result */
export interface SleepNudgeResult {
  /** What the camera sees near bedtime */
  scene: 'black' | 'screen_work' | 'winding_down' | 'other';
  /** Whether to send a nudge */
  nudge: boolean;
  /** Custom nudge message (if nudge is true) */
  message?: string;
  /** Explanation */
  reason: string;
}

// =============================================
// PIPELINE LOG (kept for debug trace)
// =============================================

/** Result from a pipeline run, stored for debug trace */
export interface PipelineResult {
  classification: FrameClassification;
  nutritionLogId?: number | null;
  activityLogId?: number | null;
  /** Natural language summary of what the nutrition pipeline did */
  nutritionSummary?: string | null;
  /** Food items for MealPipelineCard in chat */
  pipelineFoods?: any[] | null;
  /** Log name for meal metadata */
  logName?: string | null;
  /** Meal type for meal metadata */
  mealType?: string | null;
}

