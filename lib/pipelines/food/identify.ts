/**
 * Food Pipeline Phase 1: IDENTIFY
 *
 * Given meal photo(s) + optional caption, identify each food item with
 * portion estimates and cooking method. Supports iterative "what else?"
 * passes for dense meals.
 *
 * MIGRATED FROM:
 *   gemmaLocalProvider.ts → identifyFoods(), foodIdPass(), foodIdNextPass()
 *   geminiVision.js → MEAL_PROMPT (Backend, the 67-line monster prompt)
 *
 * KEY DIFFERENCES FROM OLD CODE:
 *   - Brain-agnostic: calls brain.vision() instead of LocalInferenceService
 *   - Prompt adapts to brain.contextWindow (compact for E2B, verbose for Gemini)
 *   - No nutrient estimation here (that's Phase 2)
 *   - No NOVA/gut health here (that's Phase 4)
 *   - No activity detection here (that's the activity pipeline)
 *
 * WHAT THE OLD SMARTEXTRACT TRIED TO DO IN ONE CALL:
 *   1. Classify image type          → now in triage.ts
 *   2. Temporal reasoning           → now in triage.ts resolveTimestamp()
 *   3. Food identification          → THIS FILE
 *   4. Activity detection           → activity/detect.ts
 *   5. AEIOU inference              → activity/lifeDesign.ts
 *   6. 7-pillar metadata            → activity/metadata.ts
 *   7. Dedup against existing logs  → activity/dedup.ts (deterministic)
 *   8. Memory learning              → chat/sideEffects.ts
 *   9. Nutrient estimation          → food/nutrients.ts
 *   10. Conversational reply        → chat/respond.ts
 *
 * INPUTS:
 *   - images: file:// paths or base64 strings
 *   - caption: user's text description
 *   - memory: scoped memory context (optional, for food preference hints)
 *
 * OUTPUTS:
 *   - FoodIdentifyResult: list of FoodItems with confidence scores
 *   - hasMore flag if dense meal detected (triggers "what else?" pass)
 *
 * RE-RUN TRIGGER:
 *   User taps "add missing item" or takes another photo of same meal.
 */

import { getBrain } from '../../brain/selector';
import type { FoodItem, FoodIdentifyResult } from '../types';

// ─── Helpers ───

/** Extract JSON from potentially noisy model output */
function extractJSON(raw: string): any | null {
  let cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  try {
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      const arr = JSON.parse(arrMatch[0]);
      if (Array.isArray(arr)) return { items: arr };
    }
  } catch { /* try object */ }
  try {
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) return JSON.parse(objMatch[0]);
  } catch { /* parse error */ }
  return null;
}

/** Expand compact keys to full FoodItem */
function expandItem(compact: any): FoodItem {
  return {
    name: compact.n || compact.name || '',
    portion_g: typeof (compact.g || compact.portion_g) === 'number'
      ? (compact.g || compact.portion_g)
      : parseInt(compact.g || compact.portion_g, 10) || 0,
    household_portion: compact.hp || compact.household_portion,
    cooking: compact.k || compact.cooking,
    confidence: compact.c ?? compact.confidence ?? 0.8,
  };
}

// ─── Main ───

/**
 * Phase 1: Identify foods in a meal photo.
 *
 * Uses compact prompt for small brains (E2B: ~150 tok context)
 * and verbose prompt for large brains (Gemini: ~500 tok context).
 */
export async function identifyFoods(
  images: string[],
  caption?: string,
  scopedMemory?: string,
): Promise<FoodIdentifyResult> {
  if (images.length === 0 && !caption) {
    return { foods: [] };
  }

  const brain = await getBrain();
  const isCompact = brain.contextWindow < 1000;

  const prompt = isCompact
    ? buildCompactPrompt(caption, scopedMemory)
    : buildVerbosePrompt(caption, scopedMemory);

  const raw = images.length > 0
    ? await brain.vision(prompt, images, { temperature: 0.2 })
    : await brain.text(prompt, { temperature: 0.2 });

  const parsed = extractJSON(raw);
  const items = parsed?.items || parsed?.foods || [];
  const unique = Array.from(
    new Map(items.map((i: any) => [(i.n || i.name || '').toLowerCase(), i])).values()
  ) as any[];

  const foods = unique.map(expandItem);

  // Infer meal type from time
  const hour = new Date().getHours();
  const mealType = hour < 10 ? 'breakfast' : hour < 14 ? 'lunch' : hour < 20 ? 'dinner' : 'snack';

  return {
    foods,
    mealType,
    mealName: foods.map(f => f.name).slice(0, 3).join(', '),
    hasMore: foods.length >= 3,
  };
}

/**
 * "What else?" pass -- find items not already identified.
 *
 * Called after user reviews Phase 1 results, if hasMore=true or
 * user taps "find more items".
 */
export async function identifyMoreFoods(
  images: string[],
  foundNames: string[],
): Promise<FoodIdentifyResult> {
  const brain = await getBrain();
  const foundStr = foundNames.join(', ');

  const prompt = `Found so far: ${foundStr}
Any OTHER distinct foods NOT listed? Be strict. Do not repeat items.
Rate confidence 0.0-1.0.

JSON: {"items":[{"n":"New Item","g":50,"hp":"1 medium","k":"raw","c":0.8}]}`;

  const raw = images.length > 0
    ? await brain.vision(prompt, images, { temperature: 0.2 })
    : await brain.text(prompt, { temperature: 0.2 });

  const parsed = extractJSON(raw);
  const items = (parsed?.items || []).map(expandItem);

  // Filter out duplicates against already-found items
  const filtered = items.filter(item => {
    const n = item.name.toLowerCase();
    return !foundNames.some(fn => {
      const fnl = fn.toLowerCase();
      return n.includes(fnl) || fnl.includes(n);
    });
  });

  return { foods: filtered, hasMore: false };
}

// ─── Prompt builders ───

function buildCompactPrompt(caption?: string, memory?: string): string {
  const memLine = memory ? `${memory}\n` : '';
  const captionLine = caption ? `\nUser says: "${caption}"` : '';

  return `${memLine}Identify each food item for USDA nutrition database matching.${captionLine}

Provide the most specific food name possible (e.g., "grilled chicken breast" not "chicken").
If a brand is visible, include it.

PORTION REFS: plate ~25cm, stick ~15g, small bowl ~80g, handful ~25g.
CONFIDENCE: 0.9+ clear, 0.6-0.8 likely, <0.5 uncertain.

JSON: {"items":[{"n":"Specific Food Name","g":45,"hp":"3 pieces","k":"grilled","c":0.9}]}`;
}

function buildVerbosePrompt(caption?: string, memory?: string): string {
  const memLine = memory ? `${memory}\n` : '';
  const captionLine = caption ? `\nUser says: "${caption}"` : '';

  return `${memLine}Identify each food item in this meal photo.${captionLine}

You are providing specific food names that will be matched against the USDA FoodData Central
database to retrieve accurate nutritional data. The more specific the name, the better the match.

NAMING:
- Use specific names: "grilled chicken breast" not "chicken"
- Include preparation: "steamed broccoli" not "broccoli"
- Include variety when visible: "jasmine rice" not "rice"
- If a branded product is visible, include the brand name

PORTION ESTIMATION:
- Use plate/bowl/utensils as size references (dinner plate ~25cm, fork ~20cm)
- A single stick/piece is ~15g, a small bowl ~80g, a handful ~25g
- Provide BOTH grams AND household measure (1/2 cup, 2 pieces, 1 tbsp)

CONFIDENCE:
- 0.9+ = clearly visible and identifiable
- 0.6-0.8 = likely based on appearance
- below 0.5 = uncertain, include your best guess

JSON: {"items":[{"name":"Specific Food Name","portion_g":45,"household_portion":"3 pieces","cooking":"grilled","confidence":0.9}]}`;
}
