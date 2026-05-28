/**
 * Nutrient-Nutrient Interaction Rules
 *
 * Well-established synergies and inhibitors from nutritional science.
 * Applied deterministically -- no AI guessing.
 *
 * References:
 * - Lynch, S.R. (2000) "The effect of calcium on iron absorption"
 * - Sandström, B. (2001) "Micronutrient interactions"
 * - Teucher, B. et al. (2004) "Enhancers of iron absorption"
 * - Hurrell, R.F. (2003) "Influence of vegetable-based antinutrients"
 */

// ──────────── Types ────────────

export type InteractionType = 'synergy' | 'inhibitor';

export interface InteractionRule {
  /** Which nutrient is affected */
  target: string;
  /** What triggers the effect */
  trigger: string;
  type: InteractionType;
  /** Multiplicative factor (>1 = enhances, <1 = inhibits) */
  factor: number;
  /** Human-readable explanation */
  reason: string;
  /** Scientific basis */
  reference: string;
}

export interface AppliedInteraction {
  target: string;
  trigger: string;
  type: InteractionType;
  factor: number;
  beforeValue: number;
  afterValue: number;
  reason: string;
  /** Which foods in the meal contributed this trigger */
  sourceFoods?: string[];
}

// ──────────── Rules ────────────

const INTERACTION_RULES: InteractionRule[] = [
  // ── Iron enhancers ──
  {
    target: 'iron', trigger: 'vitamin_c', type: 'synergy',
    factor: 1.5,
    reason: 'Vitamin C reduces Fe3+ to absorbable Fe2+, enhancing non-heme iron absorption',
    reference: 'Teucher et al. 2004',
  },

  // ── Iron inhibitors ──
  {
    target: 'iron', trigger: 'calcium', type: 'inhibitor',
    factor: 0.7,
    reason: 'Calcium competes with iron for transport, reducing absorption when consumed together',
    reference: 'Lynch 2000',
  },

  // ── Calcium inhibitors ──
  {
    target: 'calcium', trigger: '_oxalate', type: 'inhibitor',
    factor: 0.6,
    reason: 'Oxalates bind calcium forming insoluble calcium oxalate, reducing absorption',
    reference: 'Weaver & Heaney 2006',
  },

  // ── Zinc inhibitors ──
  {
    target: 'zinc', trigger: '_phytate', type: 'inhibitor',
    factor: 0.65,
    reason: 'Phytates chelate zinc in the gut, forming insoluble complexes',
    reference: 'Sandström 2001',
  },

  // ── Iron + phytate ──
  {
    target: 'iron', trigger: '_phytate', type: 'inhibitor',
    factor: 0.5,
    reason: 'Phytates strongly inhibit non-heme iron absorption through chelation',
    reference: 'Hurrell 2003',
  },

  // ── Fat-soluble vitamin absorption ──
  // USDA values assume normal absorption (meal with adequate fat).
  // WITHOUT fat, absorption of A/D/E/K drops significantly.
  // This is modeled as a PENALTY when fat is absent, not a bonus when present.
  {
    target: 'vitamin_a', trigger: '_fat_absent', type: 'inhibitor',
    factor: 0.4,
    reason: 'Vitamin A is fat-soluble; without dietary fat, absorption drops to ~40% of normal',
    reference: 'Roodenburg et al. 2000',
  },
  {
    target: 'vitamin_d', trigger: '_fat_absent', type: 'inhibitor',
    factor: 0.5,
    reason: 'Vitamin D requires fat for absorption; low-fat meals reduce uptake by ~50%',
    reference: 'Dawson-Hughes et al. 2015',
  },
  {
    target: 'vitamin_e', trigger: '_fat_absent', type: 'inhibitor',
    factor: 0.4,
    reason: 'Vitamin E absorption depends on dietary fat; without it, bioavailability drops significantly',
    reference: 'Bruno et al. 2006',
  },
  {
    target: 'vitamin_k', trigger: '_fat_absent', type: 'inhibitor',
    factor: 0.5,
    reason: 'Vitamin K is fat-soluble; meals without fat reduce absorption by ~50%',
    reference: 'Gijsbers et al. 1996',
  },

  // ── Vitamin D + Calcium ──
  {
    target: 'calcium', trigger: 'vitamin_d', type: 'synergy',
    factor: 1.3,
    reason: 'Vitamin D promotes active calcium transport in the intestine',
    reference: 'Christakos et al. 2011',
  },

  // ── Vitamin C + Folate ──
  {
    target: 'folate', trigger: 'vitamin_c', type: 'synergy',
    factor: 1.2,
    reason: 'Vitamin C helps protect folate from oxidative degradation in the gut',
    reference: 'Lucock 2000',
  },
];

// ──────────── High-phytate and high-oxalate foods ────────────

const HIGH_PHYTATE_FOODS = [
  'lentil', 'bean', 'chickpea', 'soy', 'tofu', 'tempeh',
  'wheat', 'oat', 'rice', 'corn', 'quinoa', 'barley',
  'seed', 'nut', 'almond', 'walnut', 'cashew', 'peanut',
];

const HIGH_OXALATE_FOODS = [
  'spinach', 'beet', 'rhubarb', 'swiss chard', 'sweet potato',
  'cocoa', 'chocolate', 'tea',
];

/** Educational descriptions for interaction triggers */
export const TRIGGER_EDUCATION: Record<string, {
  name: string;
  what: string;
  foods: string[];
  tip?: string;
}> = {
  _phytate: {
    name: 'Phytate (Phytic Acid)',
    what: 'A natural compound found in plant seeds that binds to minerals like iron and zinc in your gut, reducing how much your body can absorb. It\'s sometimes called an "anti-nutrient" but also has antioxidant benefits.',
    foods: ['tofu', 'tempeh', 'lentils', 'beans', 'chickpeas', 'whole grains', 'rice', 'oats', 'nuts', 'seeds'],
    tip: 'Soaking, sprouting, or fermenting these foods reduces phytate content. Eating vitamin C-rich foods alongside helps counteract the iron-blocking effect.',
  },
  _oxalate: {
    name: 'Oxalate (Oxalic Acid)',
    what: 'A compound in some plants that binds to calcium, forming crystals your body can\'t absorb. This reduces calcium availability from that meal.',
    foods: ['spinach', 'beet greens', 'rhubarb', 'swiss chard', 'sweet potatoes', 'cocoa', 'tea'],
    tip: 'Cooking reduces oxalate content by 30-90%. Pair high-oxalate foods with calcium-rich foods from a different source.',
  },
  _fat_absent: {
    name: 'Low/No Dietary Fat',
    what: 'Vitamins A, D, E, and K are fat-soluble -- they need fat to be absorbed. Without fat in your meal, your body absorbs significantly less of these vitamins from food. USDA values assume normal absorption with adequate fat.',
    foods: ['plain salad (no dressing)', 'fruit-only meals', 'fat-free snacks', 'steamed vegetables (no oil)'],
    tip: 'Add a small amount of healthy fat (olive oil, nuts, avocado) to meals rich in fat-soluble vitamins to ensure normal absorption.',
  },
};

// ──────────── Dose concentrations (mg/g) ────────────
// Approximate phytate/oxalate content per gram of food (from literature)

const PHYTATE_MG_PER_G: Record<string, number> = {
  tofu: 15, tempeh: 10, soy: 15,
  lentil: 8, bean: 8, chickpea: 8,
  wheat: 10, oat: 8, rice: 6, corn: 6, quinoa: 10, barley: 8,
  seed: 30, nut: 12, almond: 15, walnut: 10, cashew: 8, peanut: 12,
};

const OXALATE_MG_PER_G: Record<string, number> = {
  spinach: 6, beet: 5, rhubarb: 5, 'swiss chard': 4,
  'sweet potato': 1.5, cocoa: 6, chocolate: 3, tea: 0.5,
};

/** Max effect thresholds (mg of compound in meal for full effect) */
const PHYTATE_FULL_DOSE_MG = 500; // ~300g tofu = 4500mg, well above threshold
const PHYTATE_MIN_DOSE_MG = 50;   // below 50mg, negligible effect
const OXALATE_FULL_DOSE_MG = 300;
const OXALATE_MIN_DOSE_MG = 30;

/**
 * Detect triggers with dose-dependent strength.
 * Returns trigger key → { strength (0-1), sourceFoods }.
 */
function detectTriggers(
  foods: Array<{ name: string; portion_g?: number; nutrients?: Record<string, number> }>,
): Map<string, { strength: number; sources: string[] }> {
  const triggers = new Map<string, { strength: number; sources: string[] }>();

  let totalFat = 0;
  let totalPhytateMg = 0;
  let totalOxalateMg = 0;
  const fatSources: string[] = [];
  const phytateSources: string[] = [];
  const oxalateSources: string[] = [];
  // Track which food contributes each nutrient trigger
  const nutrientSources = new Map<string, string[]>();

  for (const food of foods) {
    const lower = food.name.toLowerCase();
    const portionG = food.portion_g || 100;

    // Accumulate phytate load from all foods in meal
    for (const [kw, mgPerG] of Object.entries(PHYTATE_MG_PER_G)) {
      if (lower.includes(kw)) {
        totalPhytateMg += portionG * mgPerG;
        phytateSources.push(food.name);
        break;
      }
    }

    // Accumulate oxalate load
    for (const [kw, mgPerG] of Object.entries(OXALATE_MG_PER_G)) {
      if (lower.includes(kw)) {
        totalOxalateMg += portionG * mgPerG;
        oxalateSources.push(food.name);
        break;
      }
    }

    // Accumulate nutrient amounts from all foods (for dose-dependent triggers)
    if (food.nutrients) {
      for (const [key, val] of Object.entries(food.nutrients)) {
        if (val > 0) {
          if (!nutrientSources.has(key)) nutrientSources.set(key, []);
          nutrientSources.get(key)!.push(food.name);
        }
      }
      if (food.nutrients['fat'] && food.nutrients['fat'] > 0) {
        totalFat += food.nutrients['fat'];
        fatSources.push(food.name);
      }
    }
  }

  // ── Dose-dependent nutrient triggers ──
  // Instead of binary on/off, scale strength by amount relative to thresholds.
  // Reference: Teucher 2004 (iron+VitC), Lynch 2000 (iron+Ca), Christakos 2011 (Ca+VitD)
  const NUTRIENT_DOSE_THRESHOLDS: Record<string, { min: number; full: number; unit: string }> = {
    vitamin_c:  { min: 5,    full: 50,   unit: 'mg'  },  // 25mg ≈ half effect, 50mg+ ≈ full (Teucher 2004)
    calcium:    { min: 50,   full: 300,  unit: 'mg'  },  // 300mg dairy = full inhibition of iron (Lynch 2000)
    vitamin_d:  { min: 2,    full: 10,   unit: 'mcg' },  // 10mcg (400IU) for full calcium synergy
    iron:       { min: 1,    full: 8,    unit: 'mg'  },  // relevant for calcium competition context
    folate:     { min: 50,   full: 200,  unit: 'mcg' },  // for vitamin C protection effect
  };

  // Sum nutrients across all foods in the meal
  const totalMealNutrients: Record<string, number> = {};
  for (const food of foods) {
    if (food.nutrients) {
      for (const [key, val] of Object.entries(food.nutrients)) {
        if (typeof val === 'number' && val > 0) {
          totalMealNutrients[key] = (totalMealNutrients[key] || 0) + val;
        }
      }
    }
  }

  // Set nutrient triggers with dose-scaled strength
  for (const [nutrient, total] of Object.entries(totalMealNutrients)) {
    const threshold = NUTRIENT_DOSE_THRESHOLDS[nutrient];
    if (threshold) {
      if (total >= threshold.min) {
        const strength = Math.min(1, (total - threshold.min) / (threshold.full - threshold.min));
        triggers.set(nutrient, { strength, sources: nutrientSources.get(nutrient) || [] });
      }
      // Below min dose → no trigger (not even partial)
    } else {
      // Nutrients without defined thresholds: use binary (present = full strength)
      if (total > 0) {
        triggers.set(nutrient, { strength: 1, sources: nutrientSources.get(nutrient) || [] });
      }
    }
  }

  // Phytate: scale 0→1 based on total mg
  if (totalPhytateMg > PHYTATE_MIN_DOSE_MG) {
    const strength = Math.min(1, (totalPhytateMg - PHYTATE_MIN_DOSE_MG) / (PHYTATE_FULL_DOSE_MG - PHYTATE_MIN_DOSE_MG));
    triggers.set('_phytate', { strength, sources: phytateSources });
  }

  // Oxalate: scale 0→1 based on total mg
  if (totalOxalateMg > OXALATE_MIN_DOSE_MG) {
    const strength = Math.min(1, (totalOxalateMg - OXALATE_MIN_DOSE_MG) / (OXALATE_FULL_DOSE_MG - OXALATE_MIN_DOSE_MG));
    triggers.set('_oxalate', { strength, sources: oxalateSources });
  }

  // Fat-soluble vitamin penalty: less than 3g fat in the meal
  // Strength scales inversely: 0g fat = strength 1.0 (full penalty), 3g fat = no penalty
  if (totalFat < 3) {
    const strength = 1 - (totalFat / 3); // 0g→1.0, 1g→0.67, 2g→0.33, 3g→0
    triggers.set('_fat_absent', { strength, sources: fatSources.length > 0 ? fatSources : ['(no fat in meal)'] });
  }

  return triggers;
}

/**
 * Apply nutrient interaction rules to a single food's nutrients
 * based on what other foods are present in the meal.
 *
 * Dose-dependent: phytate/oxalate effects scale with how much
 * is actually in the meal. 5g spice barely affects iron,
 * but 300g tofu significantly reduces absorption.
 */
export function applyInteractions(
  foodNutrients: Record<string, number>,
  allFoods: Array<{ name: string; portion_g?: number; nutrients?: Record<string, number> }>,
): { adjusted: Record<string, number>; interactions: AppliedInteraction[] } {
  const triggers = detectTriggers(allFoods);
  const adjusted = { ...foodNutrients };
  const interactions: AppliedInteraction[] = [];

  for (const rule of INTERACTION_RULES) {
    const triggerInfo = triggers.get(rule.trigger);
    if (!triggerInfo) continue;
    const { strength, sources } = triggerInfo;

    const currentVal = adjusted[rule.target];
    if (currentVal === undefined || currentVal <= 0) continue;

    // Scale the factor by trigger strength
    let actualFactor: number;
    if (rule.factor < 1) {
      actualFactor = 1 - (1 - rule.factor) * strength;
    } else {
      actualFactor = 1 + (rule.factor - 1) * strength;
    }

    const newVal = Math.round(currentVal * actualFactor * 100) / 100;
    if (Math.abs(newVal - currentVal) < 0.01) continue;

    adjusted[rule.target] = newVal;

    const pctChange = Math.round((1 - actualFactor) * 100);
    interactions.push({
      target: rule.target,
      trigger: rule.trigger,
      type: rule.type,
      factor: actualFactor,
      beforeValue: currentVal,
      afterValue: newVal,
      reason: `${rule.reason} (${Math.abs(pctChange)}% effect at this dose)`,
      sourceFoods: sources,
    });
  }

  return { adjusted, interactions };
}

/** Get all rules (for UI display / educational purposes) */
export function getAllRules(): InteractionRule[] {
  return [...INTERACTION_RULES];
}
