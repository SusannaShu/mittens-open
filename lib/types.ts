/**
 * API types for the Mittens Nutrition system.
 * Matches the Strapi controller response shapes.
 */

export interface NutrientValues {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  vitamin_a?: number;
  vitamin_c?: number;
  vitamin_d?: number;
  vitamin_e?: number;
  vitamin_k?: number;
  vitamin_b6?: number;
  vitamin_b12?: number;
  folate?: number;
  calcium?: number;
  iron?: number;
  magnesium?: number;
  potassium?: number;
  zinc?: number;
  omega3?: number;
  [key: string]: number | undefined;
}

export interface Food {
  name: string;
  portion_g: number;
  cooking?: string;
  nutrients: NutrientValues;
  nutrient_source?: 'usda' | 'open_food_facts' | 'database' | 'ai_estimate';
  verified?: boolean;
  usda_fdc_id?: number;
  food_entry_id?: number;
}

export interface FridgeFood {
  name: string;
  quantity: string;
  freshness: 'fresh' | 'good' | 'use_soon' | 'questionable';
  nutrients: NutrientValues;
}

export interface MealEntry {
  id: number;
  loggedAt: string;
  logName: string;
  mealType: string | null;
  items: any[];
  summaryNutrients: NutrientValues;
  source: 'vision' | 'manual';
  entryType?: 'food' | 'activity';
  activityMeta?: {
    activitySubtype?: string;
    duration_min?: number;
    intensity?: 'low' | 'moderate' | 'high';
    nutrientImpact?: Record<string, number>;
    absorptionMultiplier?: number;
    summary?: string;
    coverage_pct?: number;
    sunscreen?: boolean;
    skinType?: string;
    outdoors?: boolean;
    reasoning?: string;
    refined?: boolean;
  };
  imageUrl?: string | null;
  imageUrls?: string[];
  failure_logs?: any[];
}

export interface NutrientGap {
  nutrient: string;
  name: string;
  unit: string;
  rda: number;
  ul?: number | null;             // tolerable upper limit
  intake: number;
  actual: number;
  pct: number;
  ulPct?: number | null;          // percentage of upper limit
  status: 'good' | 'moderate' | 'low' | 'high' | 'excess';
  excessWarning?: string | null;
  period: 'daily' | 'stored';
  avgDays?: number | null;
  foodIntake?: number;
  activityDelta?: number;
  absorptionMultiplier?: number;
}

export interface FoodRecommendation {
  food: string;
  portion?: string;
  amountPerServing?: number;
  helpsWith: string;
  gapPct: number;
  deficit?: number;
  unit?: string;
  nutrientKey?: string;
  allSources?: { food: string; portion?: string; amount?: number }[];
}

export interface SnapResponse {
  foods: Food[];
  logged: boolean;
  count: number;
  ids: number[];
  totals: NutrientValues;
  gaps: NutrientGap[];
}

export interface PantryItem {
  id: number;
  foodName: string;
  quantity: string;
  freshness: 'fresh' | 'good' | 'use_soon' | 'questionable';
  originalFreshness?: string;
  scannedAt?: string;
  daysSinceScan?: number;
}

export interface ActivitySummary {
  totalImpact: Record<string, number>;
  absorptionModifier: number;
  activities: string[];
}

export interface DailySummary {
  date: string;
  meals: MealEntry[];
  totals: NutrientValues;
  gaps: NutrientGap[];
  recommendations: FoodRecommendation[];
  pantry?: PantryItem[];
  storedSources?: Record<string, { name: string; value: number; days: number; nutrient_source: string }[]>;
  groceryList?: { food: string; helpsWith: string; portion: string }[];
  activitySummary?: ActivitySummary | null;
  metabolicStory?: string | null;
}

export interface WeeklySummary {
  period: string;
  dailyAverage: NutrientValues;
  todayTotals: NutrientValues;
  gaps: NutrientGap[];
  recommendations: FoodRecommendation[];
}

export interface SupplementRec {
  nutrient: string;
  name: string;
  deficitAmount: number;
  form: string;
  suggestedDose: number;
  unit: string;
  rationale: string;
  timingNote?: string;
  avoidWith?: string[];
  cautions?: string[];
}

export interface BioavailabilityNote {
  meal: string;
  note: string;
  effect: 'positive' | 'negative';
  nutrient: string;
  ruleId?: string;
}

export interface SolverMetadata {
  solveTimeMs: number;
  candidateCount: number;
  selectedCount: number;
  feasible: boolean;
  loops: number;
  fallback?: boolean;
}

/** Alias for convenience */
export type Meal = MealEntry;

export interface AnchorTransition {
  fromLongitude: number;
  toLongitude: number;
  startedAt: string;       // ISO
  completesAt: string;     // ISO
  perDayShiftMinutes: number;
}

export interface ScheduleProfile {
  homeLongitude: number | null;
  homeLatitude: number | null;
  homeLabel: string | null;
  wakeTimeLmstMinutes: number;       // 0-1439; minutes from LMST midnight
  sleepHours: number;
  chronotype: 'morning' | 'intermediate' | 'evening';
  breakfastOffsetMinutes: number;    // minutes after wake
  dinnerBeforeBedMinutes: number;    // minutes before bedtime
  scheduleMode: 'local_clock' | 'lmst';
  scheduleTravelMode: 'home' | 'short_trip' | 'transitioning';
  anchorTransition: AnchorTransition | null;
  scheduleEnabled?: boolean;
}
