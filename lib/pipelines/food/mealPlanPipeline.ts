import { getDb } from '../../database';
import { solveMealPlan, MealPlanCandidate, NutrientGap } from './meal-plan-solver';
import { applyBioavailability } from './mealPlanBioavailability';

export async function generateMealPlanPipeline(
  userId: string,
  gaps: NutrientGap[],
  customConstraint?: string
) {
  const { getBrain } = require('../../brain/selector');
  const brain = await getBrain();
  const db = getDb();
  const today = new Date().toLocaleDateString('en-CA');

  // 1. Gather context
  const loggedRows = db.getAllSync(
    `SELECT log_name, items, meal_type FROM nutrition_logs WHERE date(logged_at) = ? ORDER BY logged_at ASC`,
    [today]
  ) as any[];

  const eatenMealTypes = new Set(loggedRows.map(m => (m.meal_type || '').toLowerCase()).filter(Boolean));
  const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'];
  const remainingMeals = MEAL_SLOTS.filter(slot => !eatenMealTypes.has(slot));

  // If no remaining meals, just return empty plan
  if (remainingMeals.length === 0) {
    return { plan: await handleAllMealsEaten(db, today, gaps, MEAL_SLOTS) };
  }

  const pantryRows = db.getAllSync(
    `SELECT id, item_name, quantity, unit, freshness FROM smart_pantry WHERE quantity > 0 ORDER BY item_name`
  ) as any[];

  const profile = db.getFirstSync(`SELECT * FROM nutrition_profile WHERE id = 1`) as any;
  const dietInfo = profile?.dietary_preferences || 'none specified';
  const dislikedList = (profile?.disliked_foods || '').split(',').map((s: string) => s.trim()).filter(Boolean);

  // 2. Candidate Gen (LLM)
  const needMore = gaps.filter(g => g.status === 'low' || g.status === 'moderate');
  const avoidMore = gaps.filter(g => g.status === 'excess' || g.pct > 150);

  const pantryStr = buildPantryString(pantryRows);
  const gapStr = buildGapString(needMore);
  const avoidStr = avoidMore.length > 0
    ? `AVOID adding more of: ${avoidMore.map(g => `${g.name} (${g.pct}%, UL: ${g.ul || 'none'})`).join(', ')}`
    : '';

  const alreadyEatenStr = buildAlreadyEatenString(loggedRows);
  const mealSlotStr = remainingMeals.map(m => `"${m}"`).join(', ');

  const PLAN_PROMPT = buildPlanPrompt({
    profileName: profile?.name || 'User',
    pantryStr,
    dislikedList,
    alreadyEatenStr,
    gapStr,
    avoidStr,
    mealSlotStr,
    remainingMeals,
    customConstraint,
  });

  const raw = await brain.text(PLAN_PROMPT, { temperature: 0.3 });
  const match = raw.match(/\{[\\s\\S]*\}/);
  let planData: any = {};
  if (match) {
    planData = JSON.parse(match[0]);
  }

  const rawCandidates = parseCandidates(planData, remainingMeals, pantryRows);

  // 3. Nutrient Estimation (LLM)
  const itemsToEstimate = rawCandidates.map(c => ({
    name: c.name,
    portion_g: c.portion_g || 0,
    household_portion: c.name,
    cooking: 'unknown',
  }));

  let nutrientResults: any[] = [];
  if (itemsToEstimate.length > 0) {
    const ESTIMATE_PROMPT = `Estimate the comprehensive USDA nutritional profile for the following foods.
For each food, return the nutrient amounts for the EXACT portion specified.
If the food is a recipe, estimate the ingredients.

Foods to estimate:
\${JSON.stringify(itemsToEstimate, null, 2)}

Return a JSON array of objects, one per food, in the exact same order.
Each object should have:
{
  "sourceType": "animal" | "plant" | "supplement" | "fortified" | "unknown",
  "nutrients": {
    "calories": 100,
    "protein": 10,
    "carbs": 20,
    "fat": 5,
    "fiber": 3,
    "vitamin_a": 0,
    "vitamin_c": 10,
    "vitamin_d": 0,
    "vitamin_e": 1,
    "vitamin_k": 5,
    "vitamin_b6": 0.5,
    "vitamin_b12": 0,
    "folate": 20,
    "calcium": 50,
    "iron": 2,
    "magnesium": 30,
    "potassium": 200,
    "zinc": 1,
    "omega3": 0.1
  }
}

ONLY RETURN THE JSON ARRAY.`;

    const estimateRaw = await brain.text(ESTIMATE_PROMPT, { temperature: 0.1 });
    const estMatch = estimateRaw.match(/\[[\\s\\S]*\]/);
    if (estMatch) {
      try {
        nutrientResults = JSON.parse(estMatch[0]);
      } catch (e) {
        console.error('Failed to parse nutrient estimation', e);
      }
    }
  }

  for (let i = 0; i < rawCandidates.length; i++) {
    if (nutrientResults[i] && nutrientResults[i].nutrients) {
      rawCandidates[i].nutrients = nutrientResults[i].nutrients;
      rawCandidates[i].sourceType = nutrientResults[i].sourceType || 'unknown';
    } else {
      rawCandidates[i].nutrients = {};
    }
    rawCandidates[i].confidence = rawCandidates[i].confidence || 'medium';
  }

  // 4. Solve (MILP)
  const targetCalories = gaps.find(g => g.nutrient === 'calories');
  const solverConstraints = {
    targetCalories: targetCalories ? targetCalories.rda : 2000,
    dislikedFoods: dislikedList,
    mealSlots: remainingMeals,
  };

  const solverResult = solveMealPlan(rawCandidates, gaps, solverConstraints);

  // 5. Bioavailability
  const mealAssignment = assignToMeals(solverResult.selectedFoods, remainingMeals);
  const mealPlanForBio: any = {};
  for (const slot of remainingMeals) {
    const foods = mealAssignment[slot] || [];
    const mealNutrients: any = {};
    for (const food of foods) {
      for (const [k, v] of Object.entries(food.scaledNutrients || {})) {
        if (typeof v === 'number') mealNutrients[k] = (mealNutrients[k] || 0) + v;
      }
    }
    mealPlanForBio[slot] = {
      items: foods.map((f: any) => ({ name: f.name })),
      nutrients: mealNutrients,
    };
  }

  const { adjustedCoverage, notes: bioNotes } = applyBioavailability(
    mealPlanForBio, solverResult.coverage, gaps
  );

  // 6. Assemble
  const assembledPlan = assemblePlan(mealAssignment, pantryRows, adjustedCoverage, remainingMeals);

  const uncoveredGaps = Object.entries(adjustedCoverage)
    .filter(([, v]) => v.status !== 'covered' && v.currentPct < 70 && v.afterPlanPct < 70)
    .map(([k, v]) => ({ nutrient: k, name: v.name, afterPlanPct: v.afterPlanPct }));

  const existing = db.getFirstSync(`SELECT * FROM daily_meal_plans WHERE plan_date = ?`, [today]) as any;

  const payload: any = {
    plan_date: today,
    breakfast: assembledPlan.breakfast ? JSON.stringify(assembledPlan.breakfast) : (existing?.breakfast || null),
    lunch: assembledPlan.lunch ? JSON.stringify(assembledPlan.lunch) : (existing?.lunch || null),
    dinner: assembledPlan.dinner ? JSON.stringify(assembledPlan.dinner) : (existing?.dinner || null),
    snacks: assembledPlan.snacks ? JSON.stringify(assembledPlan.snacks) : (existing?.snacks || null),
    grocery_list: JSON.stringify(assembledPlan.groceryList),
    gap_coverage: JSON.stringify(adjustedCoverage),
    bioavailability_notes: JSON.stringify(bioNotes),
    solver_metadata: JSON.stringify(solverResult.metadata),
    created_at: new Date().toISOString(),
  };

  db.runSync(
    `INSERT OR REPLACE INTO daily_meal_plans (plan_date, breakfast, lunch, dinner, snacks, gap_coverage, grocery_list, bioavailability_notes, solver_metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.plan_date,
      payload.breakfast,
      payload.lunch,
      payload.dinner,
      payload.snacks,
      payload.gap_coverage,
      payload.grocery_list,
      payload.bioavailability_notes,
      payload.solver_metadata,
      payload.created_at,
    ]
  );

  return {
    plan: {
      date: today,
      breakfast: assembledPlan.breakfast,
      lunch: assembledPlan.lunch,
      dinner: assembledPlan.dinner,
      groceryList: assembledPlan.groceryList,
      gapCoverage: adjustedCoverage,
      uncoveredGaps,
      bioavailabilityNotes: bioNotes,
      solverMetadata: solverResult.metadata,
      generatedAt: payload.created_at,
    },
  };
}

// ── Helper functions ──

async function handleAllMealsEaten(db: any, today: string, gaps: NutrientGap[], MEAL_SLOTS: string[]) {
  const gapCoverage: any = {};
  for (const g of gaps) {
    gapCoverage[g.nutrient] = {
      name: g.name,
      currentPct: g.pct,
      afterPlanPct: g.pct,
      unit: g.unit,
      status: g.pct >= 70 ? 'covered' : g.pct >= 30 ? 'partial' : 'uncovered',
    };
  }

  const existing = db.getFirstSync(`SELECT * FROM daily_meal_plans WHERE plan_date = ?`, [today]) as any;

  db.runSync(
    `INSERT OR REPLACE INTO daily_meal_plans (plan_date, breakfast, lunch, dinner, snacks, gap_coverage, grocery_list, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      today,
      existing?.breakfast || null,
      existing?.lunch || null,
      existing?.dinner || null,
      existing?.snacks || null,
      JSON.stringify(gapCoverage),
      JSON.stringify([]),
    ]
  );

  return { gapCoverage };
}

function buildPantryString(pantryItems: any[]) {
  if (pantryItems.length === 0) return 'Empty pantry';
  return pantryItems.map(p => {
    let s = p.item_name;
    if (p.quantity) s += ` (\${p.quantity} \${p.unit})`;
    if (p.freshness === 'use_soon' || p.freshness === 'questionable') s += ` [\${p.freshness}]`;
    return s;
  }).join(', ');
}

function buildGapString(needMore: NutrientGap[]) {
  if (needMore.length === 0) return 'No significant gaps';

  const MACRO_KEYS = new Set(['calories', 'protein', 'carbs', 'fat', 'fiber']);
  const macroGaps = needMore.filter(g => MACRO_KEYS.has(g.nutrient));
  const microGaps = needMore.filter(g => !MACRO_KEYS.has(g.nutrient));

  const formatGap = (g: NutrientGap) => {
    const deficit = Math.max(0, g.rda - g.actual);
    return `${g.name}: currently ${g.pct}% (${Math.round(g.actual * 10) / 10}${g.unit} of ${g.rda}${g.unit} RDA). NEED ${Math.round(deficit * 10) / 10}${g.unit} more.${g.ul ? ` UL: ${g.ul}${g.unit}` : ''}`;
  };

  let result = '';
  if (macroGaps.length > 0) {
    result += '=== MACRO TARGETS (HIGHEST PRIORITY) ===\
';
    result += macroGaps.map(formatGap).join('\
');
    result += '\
\
';
  }
  if (microGaps.length > 0) {
    result += '=== MICRONUTRIENT TARGETS ===\
';
    result += microGaps.map(formatGap).join('\
');
  }
  return result;
}

function buildAlreadyEatenString(todayMeals: any[]) {
  if (todayMeals.length === 0) return '';
  return `ALREADY EATEN TODAY:\n${todayMeals.map(m => {
    let itemsStr = '';
    try {
      const items = JSON.parse(m.items || '[]');
      itemsStr = items.map((i: any) => i.name || i.foodName).join(', ');
    } catch (e) {
      itemsStr = m.items;
    }
    return `- ${m.meal_type || 'meal'}: ${itemsStr}`;
  }).join('\n')}\n\nDo NOT re-plan these meals.`;
}

function buildPlanPrompt({ profileName, pantryStr, dislikedList, alreadyEatenStr, gapStr, avoidStr, mealSlotStr, remainingMeals, customConstraint }: any) {
  return `You are a nutrition advisor generating candidate foods for ${profileName}'s meal plan. Your job is to provide a DIVERSE SET of candidate foods that close specific nutrient gaps.
${customConstraint ? `\nUSER SPECIFIC INSTRUCTION FOR THIS GENERATION (CRITICAL): ${customConstraint}\nMake sure your candidates adhere to this instruction above all else.` : ''}

PANTRY AVAILABLE (with quantities): ${pantryStr}
${dislikedList.length > 0 ? `DISLIKED FOODS (do NOT suggest): ${dislikedList.join(', ')}` : ''}

${alreadyEatenStr}

EXACT NUTRIENT TARGETS (what is still needed today):
${gapStr}
${avoidStr}

MEALS TO PLAN: ${mealSlotStr}

RULES:
1. Generate 5-8 candidate INDIVIDUAL INGREDIENTS per meal slot. Each candidate is ONE ingredient with its portion.
   CORRECT: "1 cup cooked oatmeal", "2 tablespoons peanut butter", "1 medium banana" (3 separate candidates)
   WRONG: "1 cup cooked oatmeal with 2 tablespoons peanut butter and 1 medium banana" (compound)
2. For each food, specify a realistic portion (e.g., "4 oz salmon fillet", "1 cup cooked lentils").
3. Tag each food with which gap nutrient it primarily targets.
4. STRONGLY prefer foods from the pantry. Tag pantry matches with "fromPantry": true.
5. For pantry items, use the item name exactly as listed in the pantry.
6. Include at least 2-3 non-pantry foods per meal as alternatives.
7. Prioritize items marked [use_soon] -- these should be used first.
8. MACRO BALANCE IS CRITICAL: Each meal MUST include a protein source (chicken/fish/tofu/eggs/legumes), a carb source (rice/bread/potato/grains), and vegetables. Do NOT make meals that are only vegetables or only snacks.
9. If protein is listed as a gap, at LEAST 2 candidates per meal should be high-protein foods (>15g protein per serving).
10. Include a 1-sentence prep tip per meal.
11. Do NOT try to track nutrient totals or enforce safety limits -- the solver handles that.

Return ONLY valid JSON:
{
${remainingMeals.map((m: string) => `  "${m}": {
    "candidates": [
      { "food": "1 cup cooked oatmeal", "targets_gap": "carbs", "fromPantry": false, "confidence": "high" },
      { "food": "2 tablespoons peanut butter", "targets_gap": "fat", "fromPantry": true, "pantryItemName": "peanut butter", "confidence": "high" }
    ],
    "prepTip": "Brief cooking instruction."
  }`).join(',\n')}
}`;
}

function parseCandidates(planData: any, remainingMeals: string[], pantryItems: any[]) {
  const candidates: MealPlanCandidate[] = [];
  const pantryLower = pantryItems.map(p => ({
    ...p,
    nameLower: (p.item_name || '').toLowerCase().trim(),
  }));

  for (const slot of remainingMeals) {
    const meal = planData[slot];
    if (!meal) continue;

    const items = meal.candidates || meal.items || [];
    for (const item of items) {
      const foodStr = typeof item === 'string' ? item : (item.food || item.name || '');
      if (!foodStr) continue;

      let fromPantry = item.fromPantry || false;
      let pantryItem = null;
      const pantryMatch = item.pantryItemName
        ? pantryLower.find(p => p.nameLower === item.pantryItemName.toLowerCase())
        : null;

      if (pantryMatch) {
        fromPantry = true;
        pantryItem = pantryMatch;
      } else if (!fromPantry) {
        const foodWords = foodStr.toLowerCase().split(/[\\s,]+/);
        pantryItem = pantryLower.find(p =>
          foodWords.some((w: string) => w.length > 2 && (p.nameLower.includes(w) || w.includes(p.nameLower)))
        );
        if (pantryItem) fromPantry = true;
      }

      let pantryAvailable_g = null;
      if (pantryItem && pantryItem.quantity) {
        pantryAvailable_g = estimateQuantityGrams(pantryItem.quantity + ' ' + pantryItem.unit);
      }

      candidates.push({
        id: `candidate_\${slot}_\${candidates.length}`,
        name: foodStr,
        mealSlot: slot,
        nutrients: {},
        portion_g: 0,
        fromPantry,
        pantryItemId: pantryItem ? pantryItem.id : null,
        pantryAvailable_g,
        freshness: pantryItem ? pantryItem.freshness : null,
        confidence: item.confidence || 'medium',
      } as MealPlanCandidate);
    }
  }

  return candidates;
}

function estimateQuantityGrams(quantity: string) {
  if (!quantity) return null;
  const q = quantity.toLowerCase();
  const gramMatch = q.match(/(\\d+)\\s*g\\b/);
  if (gramMatch) return parseInt(gramMatch[1]);
  if (q.includes('bag')) return 300;
  if (q.includes('bottle')) return 500;
  if (q.includes('container') || q.includes('tub')) return 400;
  if (q.includes('bunch')) return 200;
  if (q.includes('head')) return 500;
  if (q.includes('dozen')) return 720;
  if (q.includes('carton')) return 1000;
  const numMatch = q.match(/(\\d+)/);
  if (numMatch) return parseInt(numMatch[1]) * 100;
  return 500;
}

function assignToMeals(selectedFoods: MealPlanCandidate[], remainingMeals: string[]) {
  const assignment: Record<string, MealPlanCandidate[]> = {};
  for (const slot of remainingMeals) assignment[slot] = [];

  for (const food of selectedFoods) {
    const slot = food.mealSlot || remainingMeals[0];
    if (assignment[slot]) {
      assignment[slot].push(food);
    } else {
      assignment[remainingMeals[0]].push(food);
    }
  }

  for (const slot of remainingMeals) {
    if (assignment[slot].length === 0) {
      const heaviest = remainingMeals.reduce((a, b) =>
        (assignment[a] || []).length > (assignment[b] || []).length ? a : b
      );
      if (assignment[heaviest] && assignment[heaviest].length > 1) {
        const item = assignment[heaviest].pop();
        if (item) assignment[slot].push(item);
      }
    }
  }

  return assignment;
}

function assemblePlan(mealAssignment: Record<string, MealPlanCandidate[]>, pantryItems: any[], gapCoverage: any, remainingMeals: string[]) {
  const groceryList: any[] = [];
  const plan: any = {};

  for (const slot of remainingMeals) {
    const foods = mealAssignment[slot] || [];
    const mealItems = [];
    const mealNutrients: any = {};
    const fromPantry = [];
    const fromStore = [];

    for (const food of foods) {
      let displayStr = food.name;
      if (food.portionMultiplier && food.portionMultiplier !== 1) {
        displayStr = formatScaledPortion(food.name, food.portionMultiplier);
      }
      mealItems.push(displayStr);

      for (const [k, v] of Object.entries(food.scaledNutrients || {})) {
        if (typeof v === 'number') mealNutrients[k] = (mealNutrients[k] || 0) + v;
      }

      if (food.fromPantry) {
        fromPantry.push({
          food: food.name,
          pantryItem: (food as any).pantryItemName || food.name,
          usedPortion: displayStr,
        });
      } else {
        const forNutrients = [];
        const targets_gap = (food as any).targets_gap;
        if (targets_gap && gapCoverage[targets_gap]) {
          const cov = gapCoverage[targets_gap];
          forNutrients.push({
            nutrient: targets_gap,
            name: cov.name,
            currentPct: cov.currentPct,
          });
        }

        fromStore.push({
          food: food.name,
          forNutrients,
        });

        if (!groceryList.some(g => g.food.toLowerCase() === food.name.toLowerCase())) {
          const portionNote = (food.portionMultiplier && food.portionMultiplier !== 1)
            ? `\${Math.round(food.portionMultiplier * 100)}% portion`
            : '';
          groceryList.push({
            food: food.name,
            portion: portionNote,
            forMeals: [slot],
            forNutrients,
          });
        } else {
          const existing = groceryList.find(g => g.food.toLowerCase() === food.name.toLowerCase());
          if (existing && !existing.forMeals.includes(slot)) {
            existing.forMeals.push(slot);
          }
        }
      }
    }

    plan[slot] = {
      items: mealItems,
      nutrients: mealNutrients,
      fromPantry,
      fromStore,
    };
  }

  return { ...plan, groceryList };
}

function formatScaledPortion(foodString: string, multiplier: number) {
  if (!multiplier || Math.round(multiplier * 100) === 100) return foodString;
  const match = foodString.trim().match(/^(\\d+(?:\\.\\d+)?(?:[/]\\d+)?|\\d+\\s+\\d+[/]\\d+)\\s+(.*)/);
  if (!match) {
    return `\${foodString} (x\${Math.round(multiplier * 10) / 10})`;
  }
  const numStr = match[1];
  const restStr = match[2];
  let num = 0;
  if (numStr.includes(' ')) {
    const [whole, frac] = numStr.split(' ');
    const [n, d] = frac.split('/');
    num = parseInt(whole) + parseInt(n) / parseInt(d);
  } else if (numStr.includes('/')) {
    const [n, d] = numStr.split('/');
    num = parseInt(n) / parseInt(d);
  } else {
    num = parseFloat(numStr);
  }
  const scaled = Math.round(num * multiplier * 10) / 10;
  return `\${scaled} \${restStr}`;
}
