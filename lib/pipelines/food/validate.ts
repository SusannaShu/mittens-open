/**
 * Food Pipeline Phase 4: VALIDATE (Gut Health + 7-Pillar)
 *
 * Classify each food for gut health markers and processing level.
 * This is mostly deterministic (lookup tables) with AI fallback
 * for unusual foods.
 *
 * MIGRATED FROM:
 *   geminiVision.estimateNutrients() → the NOVA/isFermented/sourceType part
 *   (was crammed into the nutrient estimation prompt in Strapi)
 *
 * FIELDS:
 *   - novaScale (1-4): NOVA food processing classification
 *     1: Unprocessed (whole foods, raw nuts, fresh meat)
 *     2: Culinary ingredients (oils, butter, sugar, salt)
 *     3: Processed (canned veg, fresh bread, cheese)
 *     4: Ultra-processed (instant ramen, soda, packaged snacks)
 *   - isFermented: live-culture fermented food (yogurt, kefir, kimchi, natto)
 *     NOT vinegar-pickled or just cooked
 *   - sourceType: animal / plant / supplement / fortified
 *
 * RESEARCH NEEDED:
 *   - Build a local NOVA classification database for common foods
 *     (currently relies on AI which costs tokens)
 *   - Fermented food database (which brands are truly live-culture?)
 *   - How NOVA classification maps to gut microbiome impact
 *   - Quantified gut health score from meal composition
 *
 * INPUTS:
 *   - foods: identified foods from Phase 1
 *
 * OUTPUTS:
 *   - ValidationResult per food: novaScale, isFermented, sourceType
 *
 * TODO:
 *   - Build local lookup tables for common foods (deterministic, 0 tokens)
 *   - Only use AI for unusual/ambiguous foods
 *   - Eventually: compute a composite "gut health score" for the meal
 */

import { getBrain } from '../../brain/selector';
import type { ValidationResult } from '../types';

// ─── Local lookup tables (0 tokens) ───

const KNOWN_FERMENTED: Set<string> = new Set([
  'yogurt', 'kefir', 'kimchi', 'sauerkraut', 'natto', 'miso',
  'tempeh', 'kombucha', 'sourdough',
]);

const KNOWN_NOVA: Record<string, 1 | 2 | 3 | 4> = {
  // NOVA 1: Whole foods
  'chicken': 1, 'salmon': 1, 'rice': 1, 'egg': 1, 'broccoli': 1,
  'spinach': 1, 'avocado': 1, 'banana': 1, 'apple': 1, 'oats': 1,
  'lentils': 1, 'almonds': 1, 'sweet potato': 1, 'tomato': 1,
  // NOVA 2: Culinary ingredients
  'olive oil': 2, 'butter': 2, 'sugar': 2, 'salt': 2, 'honey': 2,
  // NOVA 3: Processed
  'cheese': 3, 'canned beans': 3, 'bread': 3, 'tofu': 3,
  // NOVA 4: Ultra-processed
  'instant ramen': 4, 'soda': 4, 'chips': 4, 'candy': 4,
};

/**
 * Validate gut health markers for a food item.
 *
 * Strategy:
 *   1. Check local lookup tables first (0 tokens)
 *   2. If unknown, use brain.text() to classify (costs tokens)
 */
export async function validateFood(
  food: { name: string; cooking?: string },
): Promise<ValidationResult> {
  const nameLower = food.name.toLowerCase();

  // Try local lookup first
  const knownNova = findNova(nameLower);
  const isFermented = KNOWN_FERMENTED.has(nameLower);
  const sourceType = inferSourceType(nameLower);

  if (knownNova !== null) {
    return { novaScale: knownNova, isFermented, sourceType };
  }

  // Unknown food: ask brain
  const brain = await getBrain();
  const prompt = `Classify "${food.name}" (${food.cooking || 'unknown cooking'}):
novaScale: 1=whole, 2=ingredient, 3=processed, 4=ultra-processed
isFermented: true only if live-culture (yogurt/kefir/kimchi, NOT vinegar-pickled)
sourceType: animal/plant/supplement/fortified

JSON: {"nova":1,"ferm":false,"src":"plant"}`;

  const raw = await brain.text(prompt, { temperature: 0.0 });
  try {
    const match = raw.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        novaScale: parsed.nova || parsed.novaScale || 1,
        isFermented: parsed.ferm ?? parsed.isFermented ?? false,
        sourceType: parsed.src || parsed.sourceType || sourceType,
      };
    }
  } catch { /* parse error */ }

  // Fallback
  return { novaScale: 1, isFermented, sourceType };
}

/**
 * Batch validate multiple foods.
 */
export async function validateFoodsBatch(
  foods: Array<{ name: string; cooking?: string }>,
): Promise<ValidationResult[]> {
  return Promise.all(foods.map(validateFood));
}

// ─── Helpers ───

function findNova(name: string): 1 | 2 | 3 | 4 | null {
  if (KNOWN_NOVA[name]) return KNOWN_NOVA[name];
  // Fuzzy match: check if any key is contained in the name
  for (const [key, val] of Object.entries(KNOWN_NOVA)) {
    if (name.includes(key)) return val;
  }
  return null;
}

function inferSourceType(name: string): 'animal' | 'plant' | 'supplement' | 'fortified' {
  const animalWords = ['chicken', 'beef', 'pork', 'fish', 'salmon', 'egg', 'milk',
    'cheese', 'yogurt', 'kefir', 'butter', 'cream', 'shrimp', 'turkey'];
  const supplementWords = ['supplement', 'vitamin', 'pill', 'capsule', 'powder'];

  if (animalWords.some(w => name.includes(w))) return 'animal';
  if (supplementWords.some(w => name.includes(w))) return 'supplement';
  return 'plant';
}
