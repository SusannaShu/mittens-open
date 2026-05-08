/**
 * Pipeline Types -- shared type definitions across all pipelines.
 *
 * Every pipeline phase has typed input/output so the UI can:
 *   1. Show progressive loading per phase
 *   2. Let users edit any phase's output and re-run from there
 *   3. Same types for AI-generated AND manual entry
 */

// ═══════════════════════════════════════
// TRIAGE: what pipelines should run?
// ═══════════════════════════════════════

/** All possible pipeline types that triage can trigger */
export type PipelineType = 'meal' | 'activity' | 'pantry' | 'sleep' | 'chat' | 'email' | 'watch';

/** A single detected intent from triage */
export interface DetectedIntent {
  pipeline: PipelineType;
  confidence: number;
  /** Which photo(s) this intent relates to (0-indexed) */
  photoIndices?: number[];
  /**
   * Which phases within this pipeline have visible/textual evidence to analyze.
   * Phases NOT in this list should be skipped (no evidence to infer from).
   *
   * Activity pipeline phases: 'detect', 'environment', 'social', 'objects', 'lifeDesign'
   * Food pipeline phases: 'identify', 'eatingContext', 'bioavailability', 'validate'
   *
   * If undefined/empty, all phases run (backward compat / fallback).
   */
  inferrablePhases?: string[];
  /** Extracted context from classification */
  context?: {
    /** For meal: inferred meal type */
    mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink';
    /** For activity: inferred activity type */
    activityType?: string;
    /** For pantry: detected storage type */
    storageType?: 'fridge' | 'freezer' | 'pantry' | 'shelf';
  };
}

/** Triage output: can trigger multiple pipelines from one input */
export interface TriageResult {
  intents: DetectedIntent[];
  /** Short reply acknowledging what was detected */
  reply?: string;
}

// ═══════════════════════════════════════
// TEMPORAL: when did this happen?
// ═══════════════════════════════════════

/**
 * Phase 0 for ALL log pipelines: determine the timestamp.
 *
 * Sources (by priority):
 *   1. User explicitly said "yesterday", "tuesday", "this morning"
 *   2. Photo EXIF timestamp (e.g. 2:14pm Friday)
 *   3. User's manual time picker selection
 *   4. Current time (default fallback)
 *
 * MIGRATED FROM:
 *   - Backend smartExtract TEMPORAL REASONING section
 *   - gemmaLocalProvider.triage() logTime field
 */
export interface TemporalResult {
  /** Resolved ISO timestamp for this log entry */
  loggedAt: string;
  /** Source of the timestamp for auditability */
  source: 'user_text' | 'exif' | 'manual' | 'now';
  /** Confidence in the timestamp (lower for inferred dates) */
  confidence: number;
}

// ═══════════════════════════════════════
// FOOD PIPELINE
// ═══════════════════════════════════════

/** A single identified food item (Phase 1 output) */
export interface FoodItem {
  name: string;
  portion_g: number;
  household_portion?: string;
  cooking?: string;
  confidence: number;
}

/** Phase 1: Food identification result */
export interface FoodIdentifyResult {
  foods: FoodItem[];
  mealType?: string;
  mealName?: string;
  /** If true, more items may be found with a "what else?" pass */
  hasMore?: boolean;
}

/** Phase 2: Nutrient estimation for a single food */
export interface NutrientResult {
  nutrients: Record<string, number>;
  meta: {
    source: 'usda_ref' | 'ai_estimate';
    usedRef?: { fdcId: number; name: string; score: number };
    allRefs: Array<{ fdcId: number; name: string; score: number }>;
    adjustments: Array<{
      nutrient: string;
      usdaValue: number;
      adjustedValue: number;
      reason: string;
    }>;
    reasoning?: string;
  };
}

/** Phase 3: Bioavailability adjustments for the whole meal */
export interface BioavailabilityResult {
  adjustments: Array<{
    food: string;
    nutrient: string;
    factor: number;
    before: number;
    after: number;
    reason: string;
  }>;
  mealNote: string;
  cookingTip?: string;
}

/** Phase 4: Gut health validation */
export interface ValidationResult {
  novaScale: 1 | 2 | 3 | 4;
  isFermented: boolean;
  sourceType: 'animal' | 'plant' | 'supplement' | 'fortified';
}

// ═══════════════════════════════════════
// ACTIVITY PIPELINE
// ═══════════════════════════════════════
// The key of a customizable ActivityType
export type ActivityType = string;

export interface ActivityTypeModel {
  key: string;
  label: string;
  icon?: string;
  defaultLifeCategories?: Record<string, number>;
  subCategories?: string[];
  defaultMets?: number;
  isStrength: boolean;
  isNature: boolean;
  defaultIntensity: 'low' | 'moderate' | 'high';
  defaultOutdoors: boolean;
  showInTimer: boolean;
  showInManualLog: boolean;
  sortOrder: number;
  isBuiltIn: boolean;
}

export interface LifeBalanceGauge {
  label: string;
  icon: string;
  subCategories: string[];
}

export interface SubCategoryDef {
  label: string;
  source: string;
  positiveSignal?: string;
  negativeSignal?: string;
}

export interface LifeBalanceConfig {
  categories: Record<string, LifeBalanceGauge>;
  subCategoryDefinitions: Record<string, SubCategoryDef>;
}

export interface Person {
  id?: number;
  name: string;
  nickname?: string;
  teamRole?: 'supporter' | 'player' | 'intimate' | 'mentor';
  context?: string;
  interactionCount: number;
  avgEngagement?: number;
  avgEnergy?: number;
  lastSeenAt?: string;
}

/** Phase 1: Activity detection */
export interface ActivityDetectResult {
  activityType: string;
  logName: string;
  duration_min: number;
  intensity: 'low' | 'moderate' | 'high';
  location?: string;
  confidence: number;
}

/** Phase 2: Activity metadata (from vision + context) */
export interface ActivityMetadataResult {
  /** Metabolic Equivalent of Task */
  mets: number;
  /** Resistance/strength training? */
  isStrength: boolean;
  /** Biologically dominant natural environment? */
  isNature: boolean;
  /** Does AI need more info to classify properly? */
  needsReflection: boolean;
}

/**
 * Phase 3: Environment detection (from photo + location)
 *
 * MAPS TO UI: the Environment toggle buttons in ActivityEditModal
 * (Indoor/Outdoor/Nature/Urban/Home/Office)
 */
export interface EnvironmentResult {
  environment: 'indoor' | 'outdoor';
  subtype?: 'nature' | 'urban' | 'home' | 'office';
  /** Only if outdoor: skin exposure for UV/vitamin D estimation */
  uvExposure?: {
    coverage_pct: number;     // 10=face, 25=+arms, 50=+legs, 75=swim, 90=full
    sunscreen: boolean;
    /** Retrieved from weather/location API for accurate vitamin D calc */
    uvIndex?: number;
    /** Estimated vitamin D synthesis in mcg */
    vitaminD_mcg?: number;
  };
}

/**
 * Phase 4: Social context (from photo + text)
 *
 * MAPS TO UI: Interactions toggle in ActivityEditModal
 * (Solo / 1-2 people / Small group / Large group)
 */
export interface SocialResult {
  interactions: 'solo' | '1-2' | 'small_group' | 'large_group';
}

/**
 * Phase 5: Life categories + AEIOU (from accumulated context)
 *
 * MAPS TO UI: the life design fields in ActivityEditModal
 * These are only estimated if the user doesn't fill them manually.
 */
export interface LifeDesignResult {
  lifeCategories: {
    work: number;   // 0-1, sum to 1.0
    health: number;
    play: number;
    love: number;
  };
  aeiou?: {
    activity?: string;
    environment?: string;
    interactions?: string;
    objects?: string;
    users?: string;
  };
}

// ═══════════════════════════════════════
// PANTRY PIPELINE
// ═══════════════════════════════════════

/** Phase 1: Item identification */
export interface PantryItem {
  name: string;
  quantity: string;
  confidence: number;
}

/** Phase 2: Freshness + storage location */
export interface PantryFreshnessResult {
  freshness: 'fresh' | 'good' | 'use_soon' | 'questionable';
  storageLocation: 'fridge' | 'freezer' | 'pantry' | 'counter';
  /** Estimated check-by date */
  checkBy?: string;
  reason?: string;
}

// ═══════════════════════════════════════
// SLEEP PIPELINE
// ═══════════════════════════════════════

/**
 * Sleep detection from chat or manual entry.
 *
 * MAPS TO UI: Sleep tab in Manual Entry modal
 * Fields: bedtime, duration, quality, energy on waking,
 *         environment (temp, light, noise, screen, caffeine)
 */
export interface SleepResult {
  sleepStart?: string;
  sleepEnd?: string;
  totalMinutes?: number;
  quality?: 'poor' | 'fair' | 'good' | 'great';
  energy?: number;  // -5 to +5
  environment?: {
    temperature?: 'too_hot' | 'comfortable' | 'too_cold';
    light?: 'dark' | 'some_light' | 'bright';
    noise?: 'quiet' | 'some_noise' | 'loud';
    screenBeforeBed?: 'none' | 'under_30min' | 'over_30min';
    caffeine?: 'none' | 'before_2pm' | 'after_2pm';
  };
}

// ═══════════════════════════════════════
// CHAT PIPELINE
// ═══════════════════════════════════════

/** C1: What data sources does the chat response need? */
export interface ChatClassifyResult {
  dataNeeded: string[];
  searchQuery?: string;
  /** If no data needed, brain can reply directly */
  directReply?: string;
}

/** C2: Chat response */
export interface ChatRespondResult {
  reply: string;
}

/** C3: Side effects extracted from conversation */
export interface ChatSideEffects {
  memoryUpdates?: Array<{
    action: 'add' | 'update' | 'remove';
    category: string;
    note: string;
    oldNote?: string;
  }>;
  pantryUpdate?: {
    action: 'add' | 'remove' | 'update';
    foodName: string;
    quantity?: string;
  };
  sleepLog?: SleepResult;
  failureLog?: {
    failure: string;
    category: 'screwup' | 'weakness' | 'growth_opportunity';
    insight?: string;
    relatedActivityId?: number;
    relatedMealId?: number;
  };
  knownPlaceUpdate?: {
    name: string;
    placeType: string;
  };
  /** If chat detected a new activity/meal to log, trigger those pipelines */
  triggeredPipelines?: DetectedIntent[];
}

// ═══════════════════════════════════════
// EATING CONTEXT (meal-specific)
// ═══════════════════════════════════════

/**
 * Eating context for metabolism impact estimation.
 *
 * MAPS TO UI: "HOW DID YOU EAT?" section in Manual Entry meal tab
 * Fields: eating pace, chewing, distraction, stress, social context
 *
 * RESEARCH NEEDED:
 *   - How eating pace affects glycemic response (slower = lower spike)
 *   - Chewing thoroughness → nutrient absorption (mechanical digestion)
 *   - Parasympathetic state (calm vs stressed) → digestive enzyme output
 *   - Social eating context → portion size and pace effects
 *   - Quantified multipliers for each factor on absorption_baseline
 */
export interface EatingContext {
  pace?: 'rushed' | 'moderate' | 'slow';
  chewing?: 'minimal' | 'moderate' | 'thorough';
  distraction?: 'focused' | 'some' | 'distracted';
  stress?: 'calm' | 'moderate' | 'stressed';
  social?: 'alone' | 'with_others';
}

// ═══════════════════════════════════════
// ESP32 CAMERA INTEGRATION (future)
// ═══════════════════════════════════════

/**
 * Xiao ESP32 camera frames for passive activity timeline.
 *
 * The ESP32 takes photos on large IMU movement. These create a visual
 * timeline that the activity pipeline can process:
 *   frame[0] 9:30 — got out of bed → activity: waking up
 *   frame[1] 9:32 — opening fridge → activity: preparing breakfast (start)
 *   frame[2] 9:45 — returned to desk → activity: preparing breakfast (end)
 *
 * RESEARCH NEEDED:
 *   - BLE protocol for receiving frames from ESP32
 *   - Image quality: can we identify food? (probably not -- focus on activity)
 *   - Privacy: all processing on-device, frames never uploaded
 *   - Battery optimization on ESP32 side
 *   - IMU threshold calibration for "large movement"
 */
export interface ESP32Frame {
  timestamp: string;
  imagePath: string;
  imuMagnitude: number;
}

export interface ESP32Timeline {
  frames: ESP32Frame[];
  /** Inferred activity segments from frame analysis */
  segments?: Array<{
    startFrame: number;
    endFrame: number;
    activity: ActivityType;
    confidence: number;
  }>;
}

// ═══════════════════════════════════════
// EMAIL PIPELINE
// ═══════════════════════════════════════

/** What the user wants to do with email */
export type EmailActionType =
  | 'search_orders'      // find order confirmations -> review cards
  | 'search_read'        // find + read emails -> answer question
  | 'search_read_act'    // find + read -> do something (calendar, reply)
  | 'compose_send';      // write + send a new email

/** Phase 1: Brain plans the action sequence */
export interface EmailPlanResult {
  actionType: EmailActionType;
  /** Gmail search strategy (for actions that start with search) */
  search?: {
    keywords: string[];
    senders?: string[];
    subjectPatterns?: string[];
    timeRange?: { after?: string; before?: string };
  };
  /** What to do after reading (for search_read_act) */
  downstreamAction?: 'add_to_calendar' | 'reply' | 'forward';
  /** For compose_send: recipient info */
  recipient?: {
    name: string;
    emailHint?: string;
  };
  /** For compose_send: what to say */
  messageIntent?: string;
  /** The question to answer (for search_read) */
  question?: string;
  /** Order search category (for search_orders) */
  category?: 'fashion' | 'tech' | 'food' | 'general';
  confidence: number;
}

/** Email candidate after search + fetch */
export interface EmailCandidate {
  id: string;
  threadId: string;
  from: string;
  to?: string;
  subject: string;
  date: string;
  snippet: string;
  cleanedBody?: string;
  score?: number;
}

/** Extracted order item (for search_orders flow) */
export interface EmailOrderItem {
  itemName: string;
  brand?: string;
  price?: { amount: number; currency: string };
  size?: string;
  color?: string;
  category: 'dress' | 'top' | 'bottom' | 'shoes' | 'bag' | 'accessory' | 'other';
  imageUrl?: string;
  orderNumber?: string;
  orderDate?: string;
  retailer?: string;
  status?: 'ordered' | 'shipped' | 'delivered';
}

/** Extracted calendar event from email */
export interface EmailExtractedEvent {
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  participants?: string[];
}

/** Composed email draft */
export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
}

/** Final result varies by action type */
export interface EmailPipelineResult {
  plan: EmailPlanResult;
  orderItems?: EmailOrderItem[];
  answer?: string;
  extractedEvent?: EmailExtractedEvent;
  draft?: EmailDraft;
  sentMessageId?: string;
  stats?: { searched: number; read: number };
}

// ═══════════════════════════════════════
// WATCH PIPELINE
// ═══════════════════════════════════════

/** Source type for web content fetching */
export type WatchSourceType = 'web' | 'ig_stories';
export type WatchFetchMethod = 'rss' | 'json_api' | 'html' | 'instaloader' | 'auto';

/** Phase 1: Brain plans what to fetch and how to filter */
export interface WatchPlanResult {
  sources: Array<{
    url: string;
    type: WatchSourceType;
    handle?: string;
    platform?: string;
  }>;
  filter: string;
  needsVision: boolean;
  savedSourceId?: number;
  confidence: number;
}

/** A single fetched content item (Phase 2 output) */
export interface WatchFetchedItem {
  id: string;
  sourceUrl: string;
  title: string;
  url?: string;
  body?: string;
  imageUrl?: string;
  imageLocalPath?: string;
  author?: string;
  publishedAt?: string;
  meta?: Record<string, any>;
}

/** Phase 3: Filter result */
export interface WatchFilterResult {
  kept: WatchFetchedItem[];
  skipped: Array<{ item: WatchFetchedItem; reason: string }>;
}

/** Phase 4: Extracted structured details for a kept item */
export interface WatchExtractedItem extends WatchFetchedItem {
  extracted?: {
    what?: string;
    where?: string;
    when?: string;
    cost?: string;
    details?: string;
  };
  filterReason?: string;
}

/** Final pipeline result */
export interface WatchPipelineResult {
  plan: WatchPlanResult;
  items: WatchExtractedItem[];
  stats: { fetched: number; kept: number; extracted: number };
}
