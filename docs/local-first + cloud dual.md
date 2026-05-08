# Mittens System Architecture: Local-First + Cloud Dual Mode

Complete redesign to support two operational modes with shared UI, per-food nutrient auditability, structured memory, and proper abstraction layers.

## Two Operational Modes

| | Local Mode | Cloud Mode |
|---|---|---|
| **AI Engine** | Gemma 4 E2B (on-device) | Gemini Flash/Sonnet/Opus (cloud) |
| **Database** | SQLite (expo-sqlite) | Strapi → Postgres |
| **Storage** | ~3GB model + ~30MB USDA | None |
| **Cost** | Free, uses battery | Subscription or own API key |
| **Privacy** | All data on device | Data in cloud |
| **Photos** | Local file URIs | Cloudinary upload |
| **Sync** | Optional push to Strapi | Always synced |

---

## 1. Onboarding Flow

### Mode Selection
```
"How would you like Mittens to work?"

[LOCAL & PRIVATE]                    [CLOUD & SYNCED]
Everything on your device.           Fast, always backed up.
Download ~3GB model.                 Use our API or bring your own key.
Free forever.                        $X/mo or BYOK.
```

### Medical & Special Conditions (both modes)
```
"Do you have any medical conditions or special needs?"
(These affect how Mittens calculates your nutrition)

Examples shown as selectable chips:
[ ] Celiac / Gluten intolerance
[ ] Lactose intolerance
[ ] IBS / FODMAP sensitivity
[ ] Iron deficiency / Anemia
[ ] Vitamin D deficiency
[ ] Diabetes (Type 1 / Type 2)
[ ] Thyroid condition
[ ] PCOS
[ ] Pregnancy / Breastfeeding
[ ] Vegan / Vegetarian

Medications that affect absorption:
[ ] PPIs (acid reflux) → affects B12, iron, calcium absorption
[ ] Metformin → affects B12 absorption
[ ] Birth control → affects B6, folate, zinc
[ ] Statins → affects CoQ10
[ ] Other: [text field]

Known deficiencies or doctor-recommended targets:
[text field: "e.g., doctor said I need more iron"]
```

These are saved as **structured profile fields**, not free-text memory.

---

## 2. Memory System Redesign

### Problem: Current Memory is Spammy

Current categories (`health`, `activities`, `energy`, `preferences`, `routines`) dump everything into flat string arrays. No structure, no relevance filtering. Result: every prompt gets 30+ irrelevant notes like "family calls often involve mom complaining."

### Solution: Tiered Memory with Scoped Injection

```typescript
interface StructuredMemory {
  // TIER 1: ALWAYS injected in every inference call
  medical: {
    conditions: string[];        // "celiac", "iron deficiency"
    medications: string[];       // "PPI for acid reflux"
    knownDeficiencies: string[]; // "doctor says low vitamin D"
    allergies: string[];         // "shellfish allergy"
    dietaryRestrictions: string[]; // "vegan", "halal"
  };

  // TIER 2: Injected for meal recommendations + meal planning
  foodPreferences: {
    likes: string[];             // "prefers organic whole foods"
    dislikes: string[];          // "doesn't eat pork"
    cookingStyle: string[];      // "frequently steams vegetables"
    mealPatterns: string[];      // "eats breakfast while working"
  };

  // TIER 3: Injected for scheduling + activity context
  routines: {
    wakeTime: string;            // "6:15 AM weekdays"
    sleepTime: string;           // "11 PM"
    workSchedule: string[];      // "works from home evenings"
    mealTiming: string[];        // "dinner around 5-6 PM"
  };

  // TIER 4: NEVER injected in nutrition/analysis -- only for conversational chat
  personal: {
    hobbies: string[];           // "software and hardware dev"
    socialPatterns: string[];    // "calls family in morning"
    habits: string[];            // "bites inside of mouth during work"
  };
}
```

### Injection Rules

| Inference Type | Tier 1 (Medical) | Tier 2 (Food Prefs) | Tier 3 (Routines) | Tier 4 (Personal) |
|---|---|---|---|---|
| **Nutrient estimation** | Always | Never | Never | Never |
| **Meal recommendations** | Always | Always | Time-relevant only | Never |
| **Chat conversation** | Always | Relevant only | Relevant only | Relevant only |
| **Activity logging** | Never | Never | Always | Never |
| **Schedule planning** | Always | Time-relevant | Always | Never |

### Max Notes Per Tier
- Tier 1: Unlimited (medical is critical)
- Tier 2: 10 per subcategory
- Tier 3: 5 per subcategory
- Tier 4: 8 per subcategory

---

## 3. Complete Nutrient Field List

Current schema tracks ~20 nutrients. Must expand to ~40+ for comprehensive coverage.

### Canonical Nutrient Keys (every food item must have ALL of these, default to 0)

```typescript
const NUTRIENT_SCHEMA: Record<string, { name: string; unit: string; rda: number; category: string }> = {
  // MACROS
  calories:     { name: 'Calories',          unit: 'kcal', rda: 2133, category: 'macro' },
  water:        { name: 'Water',             unit: 'ml',   rda: 2700, category: 'macro' },
  protein:      { name: 'Protein',           unit: 'g',    rda: 95,   category: 'macro' },
  carbs:        { name: 'Carbohydrates',     unit: 'g',    rda: 236,  category: 'macro' },
  fat:          { name: 'Total Fat',         unit: 'g',    rda: 59,   category: 'macro' },
  fiber:        { name: 'Fiber',             unit: 'g',    rda: 25,   category: 'macro' },
  sugar:        { name: 'Sugar',             unit: 'g',    rda: 0,    category: 'macro' },  // track, no RDA
  added_sugar:  { name: 'Added Sugar',       unit: 'g',    rda: 0,    category: 'macro' },  // WHO: <25g/day

  // FAT BREAKDOWN
  saturated_fat:    { name: 'Saturated Fat',     unit: 'g', rda: 0, category: 'fat' },    // <10% calories
  monounsaturated:  { name: 'Monounsaturated',   unit: 'g', rda: 0, category: 'fat' },
  polyunsaturated:  { name: 'Polyunsaturated',   unit: 'g', rda: 0, category: 'fat' },
  trans_fat:        { name: 'Trans Fat',         unit: 'g', rda: 0, category: 'fat' },    // target: 0
  cholesterol:      { name: 'Cholesterol',       unit: 'mg', rda: 0, category: 'fat' },   // <300mg/day
  omega3:           { name: 'Omega-3 (ALA)',     unit: 'g', rda: 1.1, category: 'fat' },
  omega3_epa:       { name: 'EPA',               unit: 'mg', rda: 250, category: 'fat' },
  omega3_dha:       { name: 'DHA',               unit: 'mg', rda: 250, category: 'fat' },
  omega6:           { name: 'Omega-6',           unit: 'g', rda: 11, category: 'fat' },

  // VITAMINS
  vitamin_a:    { name: 'Vitamin A',         unit: 'mcg', rda: 700,  category: 'vitamin' },
  vitamin_c:    { name: 'Vitamin C',         unit: 'mg',  rda: 75,   category: 'vitamin' },
  vitamin_d:    { name: 'Vitamin D',         unit: 'mcg', rda: 15,   category: 'vitamin' },
  vitamin_e:    { name: 'Vitamin E',         unit: 'mg',  rda: 15,   category: 'vitamin' },
  vitamin_k:    { name: 'Vitamin K',         unit: 'mcg', rda: 90,   category: 'vitamin' },
  vitamin_b1:   { name: 'Thiamine (B1)',     unit: 'mg',  rda: 1.1,  category: 'vitamin' },
  vitamin_b2:   { name: 'Riboflavin (B2)',   unit: 'mg',  rda: 1.1,  category: 'vitamin' },
  vitamin_b3:   { name: 'Niacin (B3)',       unit: 'mg',  rda: 14,   category: 'vitamin' },
  vitamin_b5:   { name: 'Pantothenic (B5)',  unit: 'mg',  rda: 5,    category: 'vitamin' },
  vitamin_b6:   { name: 'Vitamin B6',        unit: 'mg',  rda: 1.3,  category: 'vitamin' },
  vitamin_b7:   { name: 'Biotin (B7)',       unit: 'mcg', rda: 30,   category: 'vitamin' },
  folate:       { name: 'Folate (B9)',       unit: 'mcg', rda: 400,  category: 'vitamin' },
  vitamin_b12:  { name: 'Vitamin B12',       unit: 'mcg', rda: 2.4,  category: 'vitamin' },
  choline:      { name: 'Choline',           unit: 'mg',  rda: 425,  category: 'vitamin' },

  // MINERALS
  calcium:      { name: 'Calcium',           unit: 'mg',  rda: 1000, category: 'mineral' },
  iron:         { name: 'Iron',              unit: 'mg',  rda: 18,   category: 'mineral' },
  magnesium:    { name: 'Magnesium',         unit: 'mg',  rda: 310,  category: 'mineral' },
  potassium:    { name: 'Potassium',         unit: 'mg',  rda: 2600, category: 'mineral' },
  zinc:         { name: 'Zinc',              unit: 'mg',  rda: 8,    category: 'mineral' },
  sodium:       { name: 'Sodium',            unit: 'mg',  rda: 0,    category: 'mineral' },  // track, <2300mg
  phosphorus:   { name: 'Phosphorus',        unit: 'mg',  rda: 700,  category: 'mineral' },
  selenium:     { name: 'Selenium',          unit: 'mcg', rda: 55,   category: 'mineral' },
  copper:       { name: 'Copper',            unit: 'mg',  rda: 0.9,  category: 'mineral' },
  manganese:    { name: 'Manganese',         unit: 'mg',  rda: 1.8,  category: 'mineral' },
  chromium:     { name: 'Chromium',          unit: 'mcg', rda: 25,   category: 'mineral' },
  iodine:       { name: 'Iodine',            unit: 'mcg', rda: 150,  category: 'mineral' },
  molybdenum:   { name: 'Molybdenum',        unit: 'mcg', rda: 45,   category: 'mineral' },

  // GUT & QUALITY INDICATORS
  fiber_soluble:   { name: 'Soluble Fiber',   unit: 'g', rda: 0, category: 'gut' },
  fiber_insoluble: { name: 'Insoluble Fiber', unit: 'g', rda: 0, category: 'gut' },
};
```

### Per-Food Meta (in addition to nutrients)
```typescript
interface FoodItemSchema {
  name: string;
  portion_g: number;
  household_portion?: string;    // "1 cup", "2 slices"
  cooking?: string;              // "stir-fried", "raw", "steamed"
  nutrients: Record<string, number>;  // ALL 45+ keys, 0 if none
  nutrientMeta: {
    source: 'usda_exact' | 'usda_adjusted' | 'ai_estimate';
    usda_match?: string;
    usda_fdc_id?: number;
    nova_class: 1 | 2 | 3 | 4;
    water_pct: number;
    fiber_type?: 'soluble' | 'insoluble' | 'mixed';
    cooking_method?: string;
    justification: string;
    adjustments: NutrientAdjustment[];
    estimatedAt: string;
    estimationStatus: 'pending' | 'complete' | 'failed';
  };
}
```

> [!IMPORTANT]
> **Every food must have ALL nutrient keys populated.** If USDA doesn't have a value and AI can't estimate it, set to 0. This ensures:
> - Consistent summation (no `undefined + 3 = NaN`)
> - Frontend can always render any nutrient
> - Sync between local SQLite and Strapi never has missing fields

---

## 4. Provider Pattern Architecture

### DataProvider Interface

```typescript
interface DataProvider {
  // Profile
  getProfile(): Promise<UserProfile>;
  updateProfile(updates: Partial<UserProfile>): Promise<void>;

  // Nutrition
  logMeal(meal: MealInput): Promise<{ id: number }>;
  getMeal(id: number): Promise<MealLog>;
  updateMeal(id: number, updates: Partial<MealLog>): Promise<void>;
  deleteMeal(id: number): Promise<void>;
  getDailyMeals(date: string): Promise<MealLog[]>;
  getDailySummary(date: string): Promise<DailySummary>;

  // Activities, Sleep, Messages, Places, Pantry, Calendar, Memory,
  // MealPlan, Schedule -- same pattern as nutrition above
  // ... (full interface mirrors ALL Strapi collections)

  // Sync
  getUnsyncedRecords(): Promise<SyncManifest>;
  markSynced(table: string, ids: number[]): Promise<void>;
}
```

Two implementations:
- `CloudDataProvider` -- wraps existing RTK Query services (no behavior change)
- `LocalDataProvider` -- SQLite via expo-sqlite

### InferenceProvider Interface

```typescript
interface InferenceProvider {
  identifyFoods(images: string[], caption?: string): Promise<FoodIdentification>;
  estimateNutrients(food: FoodItem, context: EstimationContext): Promise<NutrientEstimate>;
  chat(message: string, context: ChatContext): Promise<ChatResponse>;
}
```

Two implementations:
- `GeminiCloudProvider` -- current Strapi → Gemini flow
- `GemmaLocalProvider` -- on-device LiteRT-LM native module

---

## 5. SQLite Schema (mirrors Strapi exactly)

```sql
-- Every table has synced_at for cloud sync tracking
CREATE TABLE nutrition_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  logged_at TEXT NOT NULL,
  meal_type TEXT CHECK(meal_type IN ('breakfast','lunch','dinner','snack','drink','activity')),
  food_name TEXT,
  portion_g REAL,
  cooking TEXT,
  nutrients TEXT,           -- JSON: all 45+ keys
  log_name TEXT,
  items TEXT,               -- JSON array of FoodItemSchema
  summary_nutrients TEXT,   -- JSON: aggregated totals
  estimation_status TEXT DEFAULT 'complete' CHECK(estimation_status IN ('pending','estimating','partial','complete')),
  source TEXT DEFAULT 'vision' CHECK(source IN ('vision','manual')),
  entry_type TEXT DEFAULT 'food' CHECK(entry_type IN ('food','activity')),
  activity_meta TEXT,       -- JSON
  energy INTEGER,
  eating_context TEXT,
  image_uris TEXT,          -- JSON array of local file paths
  cloud_image_ids TEXT,     -- JSON array of Cloudinary IDs (after sync)
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  synced_at TEXT            -- NULL = never synced to cloud
);

CREATE TABLE activity_logs (...);  -- mirrors activity-log model
CREATE TABLE sleep_logs (...);     -- mirrors sleep-log model
CREATE TABLE known_places (...);   -- mirrors known-place model
CREATE TABLE mittens_messages (...); -- mirrors mittens-message model
CREATE TABLE nutrition_profile (...); -- mirrors nutrition-profile model
CREATE TABLE nutrition_pantry (...);  -- mirrors nutrition-pantry model
CREATE TABLE calendar_events (...);   -- mirrors calendar-event model
CREATE TABLE daily_meal_plans (...);  -- mirrors daily-meal-plan model
CREATE TABLE memory (...);            -- structured tiers
CREATE TABLE planned_schedules (...); -- mirrors planned-schedule model

-- USDA reference (bundled, read-only, ~8000 common foods)
CREATE TABLE usda_foods (
  fdc_id INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  category TEXT,
  nutrients TEXT NOT NULL   -- JSON: all 45+ keys
);
CREATE INDEX idx_usda_description ON usda_foods(description);
```

---

## 6. Photo Storage Strategy

```
Photo taken → stored locally (documentDirectory/photos/)
           → used for Phase 1 identification
           → shown in chat/modal display

User can choose (in Profile):
  "Photo Storage"
  [x] Keep on device (default)
  [ ] Sync to cloud (uploads to Cloudinary)
  [ ] Delete after analysis (saves space)
```

- **Local mode default**: Photos stay as local files. `image_uris` column stores local paths.
- **Cloud sync**: When enabled, photos upload to Cloudinary during sync. `cloud_image_ids` column gets populated.
- **Delete after analysis**: Photos deleted after Phase 1 identification. Chat shows placeholder "Photo analyzed" instead.

---

## 7. 2-Phase Estimation Pipeline

### Phase 1: Identify (< 3s)
```
Photo → AI Vision: "What foods, portions, cooking methods?"
→ Return chat card immediately
→ Save to DB: items with estimationStatus: "pending", nutrients: {all zeros}
```

### Phase 2: Estimate (background, per food)
```
For each food:
  1. USDA lookup (fuzzy match on food name)
  2. If USDA match: baseline from USDA, AI adjusts for cooking + pairings
  3. If no USDA match: AI estimates all 45+ nutrients from scratch
  4. AI adds: NOVA class, water %, fiber type, bioavailability adjustments
  5. Medical context injected: "User has iron deficiency → flag iron-rich foods"
  6. Save per-food nutrients + nutrientMeta to DB
  7. Recompute summaryNutrients on parent log
  → Frontend updates (spinner → checkmark) as each food completes
```

### Context Injection for Nutrient Estimation
```
ALWAYS inject (Tier 1):
- Medical conditions: "celiac, iron deficiency"
- Medications: "PPI → affects B12 absorption"
- Known deficiencies: "low vitamin D per doctor"

NEVER inject for nutrient estimation:
- Food preferences ("likes organic")
- Routines ("wakes at 6:15")
- Personal ("family calls involve mom complaining")
```

---

## 8. Frontend Changes

### [NEW] `components/FoodNutrientModal.tsx`
Per-food nutrient audit modal:
- Header: food name, portion, cooking method, NOVA badge (1-4)
- All 45+ nutrients in categorized sections (Macros / Vitamins / Minerals / Gut)
- Each row: value | unit | source tag (USDA badge / AI badge)
- Adjustments section with cooking/pairing reasoning
- Loading dimmer if still estimating
- "Ask Mittens" button to question any number

### [MODIFY] `app/results.tsx`
"View Nutrients" button → list of foods → each opens `FoodNutrientModal`

### [MODIFY] `components/NutrientRow.tsx`
"Stored from food" sources → tappable → opens `FoodNutrientModal`

### [NEW] `app/onboarding/` directory
- `mode-select.tsx` -- local vs cloud
- `medical-profile.tsx` -- conditions, medications, deficiencies
- `permissions.tsx` -- camera, location, notifications

---

## Implementation Phases

### Phase 0: Architecture Foundation
- [ ] Define `DataProvider` + `InferenceProvider` interfaces
- [ ] Wrap existing Strapi RTK Query as `CloudDataProvider`
- [ ] Wrap existing Gemini calls as `GeminiCloudProvider`
- [ ] Add provider factory with mode config
- [ ] **No behavior change** -- existing cloud flow works unchanged

### Phase 1: Memory Redesign
- [ ] Restructure memory from flat categories to tiered system
- [ ] Add injection rules (Tier 1 always, Tier 2-4 scoped)
- [ ] Clean up existing spammy memory entries
- [ ] Add medical conditions to profile schema

### Phase 2: Local Database + Nutrient Schema
- [ ] Install `expo-sqlite`
- [ ] Create SQLite schema mirroring all Strapi tables
- [ ] Build `LocalDataProvider` implementation
- [ ] Expand nutrient fields to 45+ in both SQLite and Strapi
- [ ] Bundle USDA top-8000 foods SQLite file

### Phase 3: 2-Phase Estimation Pipeline
- [ ] Split `smartSnap` into Phase 1 (identify) + Phase 2 (estimate)
- [ ] Build `nutrientEstimator` service (USDA lookup + AI adjustment)
- [ ] Add per-food `nutrientMeta` with NOVA, water %, adjustments
- [ ] Ensure ALL 45+ nutrient keys populated (0 if N/A)

### Phase 4: Frontend Auditability
- [ ] Build `FoodNutrientModal`
- [ ] Add "View Nutrients" to results screen
- [ ] Make stored food sources tappable in NutrientRow
- [ ] Add estimation progress polling hook

### Phase 5: Native Module + Onboarding
- [ ] Build Kotlin LiteRT-LM native module
- [ ] Build `GemmaLocalProvider`
- [ ] Build onboarding screens (mode select + medical profile)
- [ ] Build sync engine (local → cloud)

## Verification Plan

### Phase 0-1
- Memory injection test: nutrient estimation prompt contains ONLY medical context
- Memory injection test: meal recommendation prompt contains medical + food prefs
- Chat prompt contains all relevant tiers

### Phase 2-3
- Log 3-food meal → Phase 1 returns in < 3s with all items having 45 zero-valued nutrients
- Phase 2 runs per-food → USDA match populates baseline → AI adjusts
- Every completed food has all 45+ keys populated (no undefined)
- `nutrientMeta.nova_class` is set for every food

### Phase 4-5
- Tap food → modal shows all nutrients with source tags
- Build APK with native module → run inference on Pixel 7a
- Local mode: full flow (photo → identify → estimate → display) works without network
