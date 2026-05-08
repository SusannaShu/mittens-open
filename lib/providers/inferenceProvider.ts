/**
 * InferenceProvider interface -- abstraction over AI inference engines.
 *
 * Two implementations:
 * - GeminiCloudProvider: routes through Backend -> Gemini (current flow)
 * - GemmaLocalProvider: on-device LiteRT-LM native module
 */

export interface FoodIdentification {
  foods: Array<{
    name: string;
    portion_g: number;
    household_portion?: string;
    cooking?: string;
    confidence?: number;
  }>;
  mealType?: string;
  dishName?: string;
  rawResponse?: string;
  /** If true, more items may be found with identifyMoreFoods() */
  hasMore?: boolean;
}

/** What AI changed from the USDA reference and why */
export interface NutrientAdjustment {
  nutrient: string;
  usdaValue: number | null;
  adjustedValue: number;
  reason: string;
}

/** Cooking/absorption effect on a nutrient */
export interface BioAdjustment {
  nutrient: string;
  factor: number;
  beforeValue: number;
  afterValue: number;
  reason: string;
}

/** USDA reference entry shown to user */
export interface USDARef {
  fdcId: number;
  name: string;
  score: number;
}

export interface NutrientEstimate {
  /** Final nutrient values (numbers, null -> 0 for storage) */
  nutrients: Record<string, number>;
  meta: {
    source: 'usda_ref' | 'ai_estimate';
    /** Which USDA entry was used as AI's reference */
    usedRef?: USDARef;
    /** All USDA candidates found (for user to compare/switch) */
    allRefs: USDARef[];
    /** What AI adjusted from the USDA reference and why */
    adjustments: NutrientAdjustment[];
    /** AI's reasoning for its adjustments */
    reasoning?: string;
    water_pct?: number;
    justification?: string;
  };
}

/** Separate bioavailability result (pipeline step 4) */
export interface BioavailabilityResult {
  /** Cooking/absorption adjustments with reasoning */
  adjustments: BioAdjustment[];
  /** Overall meal note */
  mealNote: string;
  /** Educational tip about best cooking method for nutrients */
  cookingTip?: string;
}

export interface EstimationContext {
  medicalConditions?: string[];
  medications?: string[];
  knownDeficiencies?: string[];
}

export interface ChatContext {
  message: string;
  messageId?: string;
  tzOffset?: number;
}

export interface ChatResponse {
  reply: string;
  memoryUpdates?: Array<{ category: string; note: string }>;
  dataNeeded?: string[];
  actions?: Array<{ type: string; payload: any }>;
}

export interface InferenceProvider {
  /** Phase 1: Identify foods from image(s) + optional caption */
  identifyFoods(images: string[], caption?: string): Promise<FoodIdentification>;

  /** Phase 2: Estimate nutrients (USDA-referenced AI estimation) */
  estimateNutrients(
    food: { name: string; portion_g: number; cooking?: string },
    context: EstimationContext
  ): Promise<NutrientEstimate>;

  /** Phase 3: Bioavailability analysis (separate, photo-based) */
  analyzeBioavailability?(
    images: string[],
    foods: Array<{ name: string; portion_g: number; cooking?: string }>,
    baseNutrients: Record<string, Record<string, number>>,
  ): Promise<BioavailabilityResult>;

  /** Conversational chat */
  chat(context: ChatContext): Promise<ChatResponse>;

  /** Raw text generation (for stage 1 routing, etc.) */
  generateRaw(prompt: string): Promise<string>;

  /** Raw text + image generation (for vision tasks) */
  generateWithImage?(prompt: string, imagePath: string): Promise<string>;
}
