/**
 * @deprecated This monolith provider is superseded by the modular pipeline
 * architecture in `lib/pipelines/`. It remains only as a thin wrapper for the
 * on-device E2B agent (triage + voice). All food, activity, sleep, and chat
 * pipeline logic should use `PipelineRunner` instead.
 *
 * GemmaLocalProvider -- on-device inference using LiteRT-LM native module.
 *
 * Legacy micro-pipeline architecture (being migrated):
 *   1. TRIAGE  -> lib/pipelines/triage.ts
 *   2. FOOD_ID -> lib/pipelines/food/identify.ts
 *   3. NUTRIENT -> lib/pipelines/food/nutrients.ts
 *   4. BIOAVAILABILITY -> lib/pipelines/food/bioavailability.ts
 *   5. REPLY   -> lib/pipelines/chat/respond.ts
 */

import {
  InferenceProvider,
  FoodIdentification,
  NutrientEstimate,
  BioavailabilityResult,
  EstimationContext,
  ChatContext,
  ChatResponse,
} from './inferenceProvider';
import { LocalInferenceService } from '../services/ai/localInference';
import { estimateNutrients as estimateNutrientsUSDA, flattenNutrients } from '../services/food/nutrientEstimator';
import { formatScopedMemory, getTimeOfDay, MemoryContext } from '../services/food/memoryRetrieval';
import { resizeForVision } from '../imageUtils';

// ──────────── Types ────────────

export interface TriageResult {
  logs: Array<{ type: 'meal' | 'pantry' | 'activity'; mealType?: string; sub?: string }>;
  logTime?: string;
}

export interface FoodItem {
  name: string;
  portion_g: number;
  household_portion?: string;
  cooking?: string;
  confidence: number;
}

// ──────────── Helpers ────────────

/** Extract JSON from a potentially noisy model response */
function extractJSON(raw: string): any | null {
  // Strip markdown code fences (```json ... ```)
  let cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  try {
    // Try array first: [{...}]
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      const arr = JSON.parse(arrMatch[0]);
      if (Array.isArray(arr)) {
        console.log('[Pipeline] extractJSON: matched array with', arr.length, 'items');
        return { items: arr }; // wrap in {items:[]} for consistent handling
      }
    }
  } catch { /* try object fallback */ }
  try {
    // Object: {...}
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
      const parsed = JSON.parse(objMatch[0]);
      console.log('[Pipeline] extractJSON: matched object', JSON.stringify(parsed).substring(0, 200));
      return parsed;
    }
    console.log('[Pipeline] extractJSON: no JSON match in response');
  } catch (e: any) {
    console.log('[Pipeline] extractJSON: parse error:', e?.message);
  }
  return null;
}

/** Strip emoji characters from model output (project rule: no emojis) */
function stripEmoji(text: string): string {
  return text
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Expand compact food ID keys to full names */
function expandFoodItem(compact: any): FoodItem {
  const rawG = compact.g || compact.portion_g || 0;
  return {
    name: compact.n || compact.name || '',
    portion_g: typeof rawG === 'number' ? rawG : (parseInt(rawG, 10) || 0),
    household_portion: compact.hp || compact.household_portion,
    cooking: compact.k || compact.cooking,
    confidence: compact.c ?? compact.confidence ?? 0.8,
  };
}

/** Resize image for vision, with fallback to original */
async function prepareImage(imagePath: string): Promise<string> {
  console.log('[Pipeline] prepareImage input:', imagePath?.substring(0, 80));
  try {
    if (imagePath.startsWith('file://') || imagePath.startsWith('/')) {
      const resized = await resizeForVision(imagePath);
      console.log('[Pipeline] prepareImage resized:', resized?.substring(0, 80));
      return resized;
    }
  } catch (e: any) {
    console.log('[Pipeline] prepareImage resize FAILED:', e?.message);
  }
  console.log('[Pipeline] prepareImage: using original path');
  return imagePath;
}

// ──────────── Provider ────────────

export class GemmaLocalProvider implements InferenceProvider {

  // ═══════════════════════════════════════
  // Pipeline 1: TRIAGE
  // ═══════════════════════════════════════

  async triage(images: string[], caption: string, now: Date): Promise<TriageResult> {
    const timeStr = now.toLocaleString('en-US', {
      weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
    });

    const prompt = `Time: ${timeStr}
User says: "${caption || '(photo only)'}"

Is this a MEAL (food being eaten/prepared) or PANTRY (fridge/shelf/groceries)?

JSON: {"logs":[{"type":"meal","mealType":"lunch"}],"logTime":"${now.toISOString()}"}
type: meal / pantry. mealType: breakfast/lunch/dinner/snack/drink (infer from time + caption)`;

    let raw: string;
    if (images.length > 0) {
      const resized = await prepareImage(images[0]);
      raw = await LocalInferenceService.generateWithImage(prompt, resized);
    } else {
      raw = await LocalInferenceService.generateLocalResponse(prompt);
    }

    const parsed = extractJSON(raw);
    if (parsed?.logs) {
      return { logs: parsed.logs, logTime: parsed.logTime };
    }

    // Default: assume meal if we can't parse
    const hour = now.getHours();
    const mealType = hour < 10 ? 'breakfast' : hour < 14 ? 'lunch' : hour < 20 ? 'dinner' : 'snack';
    return { logs: [{ type: 'meal', mealType }] };
  }

  // ═══════════════════════════════════════
  // Pipeline 2: FOOD_ID (iterative)
  // ═══════════════════════════════════════

  async identifyFoods(images: string[], caption?: string, memory?: Record<string, string[]>): Promise<FoodIdentification> {
    console.log('[Pipeline] identifyFoods called:', { imageCount: images.length, images: images.map(i => i?.substring(0, 60)), caption });
    if (images.length === 0 && !caption) {
      console.log('[Pipeline] identifyFoods: no images and no caption, returning empty');
      return { foods: [] };
    }

    // Build scoped memory for food context
    const memoryContext: MemoryContext = {
      currentTime: getTimeOfDay(new Date().getHours()),
    };
    if (caption) {
      memoryContext.foodNames = caption.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    }
    const scopedMemory = memory ? formatScopedMemory(memory, memoryContext) : '';

    // Pass 1 only: focus on precision, not completeness
    console.log('[Pipeline] === PASS 1: Initial food ID ===');
    const pass1Items = await this.foodIdPass(images, caption, scopedMemory);
    console.log('[Pipeline] Pass 1 result:', pass1Items.length, 'items:', pass1Items.map(i => `${i.name}(${i.confidence})`));

    // Determine meal type from time
    const hour = new Date().getHours();
    const mealType = hour < 10 ? 'breakfast' : hour < 14 ? 'lunch' : hour < 20 ? 'dinner' : 'snack';

    console.log('[Pipeline] identifyFoods PASS 1:', pass1Items.length, 'foods:', pass1Items.map(i => i.name));
    return {
      foods: pass1Items.map(i => ({
        name: i.name,
        portion_g: i.portion_g,
        household_portion: i.household_portion,
        cooking: i.cooking,
        confidence: i.confidence,
      })),
      mealType,
      hasMore: pass1Items.length >= 3, // signal that there may be more items
    };
  }

  /** Pass 2+: \"What else?\" -- call after pass 1 displayed */
  async identifyMoreFoods(images: string[], foundNames: string[]): Promise<FoodIdentification> {
    const foundStr = foundNames.map((n, i) => `${n} (${(0.9).toFixed(1)})`).join(', ');

    for (let pass = 2; pass <= 3; pass++) {
      console.log(`[Pipeline] === PASS ${pass}: What else? ===`);
      const moreItems = await this.foodIdNextPass(images, foundStr);

      // Filter out items that are already in foundNames (cross-pass dedup)
      const filteredItems = moreItems.filter(item => {
        const n = item.name.toLowerCase();
        return !foundNames.some(fn => {
          const fnl = fn.toLowerCase();
          // strict substring match to prevent 'Carrot' from duplicating 'Carrot sticks'
          return String(n).includes(fnl) || String(fnl).includes(n);
        });
      });

      console.log(`[Pipeline] Pass ${pass} result:`, moreItems.length, 'raw,', filteredItems.length, 'filtered');

      if (filteredItems.length > 0) {
        return {
          foods: filteredItems.map(i => ({
            name: i.name,
            portion_g: i.portion_g,
            household_portion: i.household_portion,
            cooking: i.cooking,
            confidence: i.confidence,
          })),
          hasMore: pass < 3,
        };
      }
    }
    return { foods: [], hasMore: false };
  }

  /** Pass 1: Initial food identification with confidence */
  private async foodIdPass(images: string[], caption?: string, scopedMemory?: string): Promise<FoodItem[]> {
    const memLine = scopedMemory ? `${scopedMemory}\n` : '';
    const captionLine = caption ? `\nUser says: "${caption}"` : '';

    const prompt = `${memLine}Identify the MAIN food items in this photo. Focus on PRECISION over completeness -- get portions right.${captionLine}

PORTION ESTIMATION RULES:
- Use plate/bowl/utensils as size references (dinner plate ~25cm, fork ~20cm)
- A single stick/piece is ~15g, a small bowl ~80g, a handful ~25g
- ALWAYS provide BOTH grams AND a household measure (1/2 cup, 2 pieces, 1 tbsp, etc.)

Rate confidence 0.0-1.0: 0.9+ clearly visible, 0.6-0.8 likely, <0.5 guess.

JSON DRAFT ONLY: {"items":[{"n":"Example Food","g":45,"hp":"3 pieces","k":"raw","c":0.9},{"n":"Another Item","g":30,"hp":"2 tbsp","k":"cooked","c":0.8}]}
n=name g=grams hp=household portion k=cooking c=confidence`;

    console.log('[Pipeline] foodIdPass prompt:', prompt.substring(0, 120));
    console.log('[Pipeline] foodIdPass images:', images.length, images[0]?.substring(0, 60));

    let raw: string;
    if (images.length > 0) {
      const resized = await prepareImage(images[0]);
      console.log('[Pipeline] foodIdPass: calling generateWithImage...');
      raw = await LocalInferenceService.generateWithImage(prompt, resized);
    } else {
      console.log('[Pipeline] foodIdPass: no images, text-only');
      raw = await LocalInferenceService.generateLocalResponse(prompt);
    }

    console.log('[Pipeline] foodIdPass RAW RESPONSE:', raw?.substring(0, 300));
    console.log('[Pipeline] foodIdPass RAW length:', raw?.length);

    const parsed = extractJSON(raw);
    const items = parsed?.items || parsed?.foods || [];
    // Deduplicate any exact copies the AI might hallucinate
    const uniqueItems = Array.from(new Map(items.map((i: any) => [i.n || '', i])).values()) as any[];
    console.log('[Pipeline] foodIdPass parsed items:', uniqueItems.length, JSON.stringify(uniqueItems).substring(0, 200));

    // DEBUG: The user wants to see if the photo was correctly resized. 
    // If the model fails to parse items and gives a strange response, we can artificially throw an error 
    // with the resized URI so it prints on the screen, verifying it's not corrupt.
    if (uniqueItems.length === 0 && images.length > 0) {
      const resized = await prepareImage(images[0]);
      console.log('[Pipeline] No items found, emitting debug error with image.');
      throw new Error(`DEBUG Image: ${resized}\nModel said: ${raw}`);
    }

    return uniqueItems.map(expandFoodItem);
  }

  /** Pass 2+: "What else?" -- find items not already identified */
  private async foodIdNextPass(images: string[], foundSoFar: string): Promise<FoodItem[]> {
    const prompt = `Found so far: ${foundSoFar}
Any OTHER distinct foods NOT listed? Be strict. Do not repeat items.
Rate confidence 0.0-1.0.

JSON DRAFT ONLY: {"items":[{"n":"New Item","g":50,"hp":"1 medium","k":"raw","c":0.8}]}
n=name g=grams hp=household portion k=cooking c=confidence`;

    let raw: string;
    if (images.length > 0) {
      const resized = await prepareImage(images[0]);
      raw = await LocalInferenceService.generateWithImage(prompt, resized);
    } else {
      raw = await LocalInferenceService.generateLocalResponse(prompt);
    }

    const parsed = extractJSON(raw);
    const items = parsed?.items || [];
    // Deduplicate internal repeats
    const uniqueItems = Array.from(new Map(items.map((i: any) => [i.n || '', i])).values()) as any[];
    return uniqueItems.map(expandFoodItem);
  }

  // ═══════════════════════════════════════
  // Pipeline 3: NUTRIENT (USDA-referenced AI estimation)
  // ═══════════════════════════════════════

  async estimateNutrients(
    food: { name: string; portion_g: number; cooking?: string },
    _context: EstimationContext
  ): Promise<NutrientEstimate> {
    const result = await estimateNutrientsUSDA(food.name, food.portion_g, food.cooking || '');
    const { allReferences, usedReference, adjustments, reasoning } = result.meta;

    return {
      nutrients: flattenNutrients(result.nutrients),
      meta: {
        source: allReferences.length > 0 ? 'usda_ref' : 'ai_estimate',
        usedRef: usedReference ? {
          fdcId: usedReference.fdcId,
          name: usedReference.name,
          score: usedReference.score,
        } : undefined,
        allRefs: allReferences.map(r => ({
          fdcId: r.fdcId, name: r.name, score: r.score,
        })),
        adjustments: adjustments.map(a => ({
          nutrient: a.key,
          usdaValue: a.usdaValue,
          adjustedValue: a.adjustedValue,
          reason: a.reason,
        })),
        reasoning,
        justification: usedReference
          ? `Ref: ${usedReference.name}${adjustments.length > 0 ? ` (${adjustments.length} adjustments)` : ''}`
          : reasoning || 'AI estimated',
      },
    };
  }

  // ═══════════════════════════════════════
  // Pipeline 4: BIOAVAILABILITY (photo-based, separate)
  // ═══════════════════════════════════════

  async analyzeBioavailability(
    images: string[],
    foods: Array<{ name: string; portion_g: number; cooking?: string }>,
    baseNutrients: Record<string, Record<string, number>>,
  ): Promise<BioavailabilityResult> {
    if (foods.length === 0) return { adjustments: [], mealNote: '' };

    // Build food list with their current nutrient values for context
    const foodLines = foods.map(f => {
      const nuts = baseNutrients[f.name] || {};
      const nutStr = Object.entries(nuts)
        .filter(([, v]) => v > 0)
        .slice(0, 8)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      return `${f.name} ${f.portion_g}g (${f.cooking || 'unknown'}): ${nutStr}`;
    }).join('\n');

    const prompt = `Meal with these foods and their estimated nutrients:
${foodLines}

Analyze the PHOTO for actual cooking state. For each food:
1. How does the cooking method affect nutrient retention?
2. Are there nutrient interactions between these foods? (e.g. vitamin C + iron = better absorption)

JSON: {"adj":[
{"food":"name","nutrient":"vitamin_c","factor":0.91,"before":19.2,"after":17.5,"why":"steaming retains ~91% vs boiling ~65%"}
],"note":"overall meal note","tip":"best cooking tip for this food"}`;

    let raw: string;
    if (images.length > 0) {
      const resized = await prepareImage(images[0]);
      raw = await LocalInferenceService.generateWithImage(prompt, resized);
    } else {
      raw = await LocalInferenceService.generateLocalResponse(prompt);
    }

    const parsed = extractJSON(raw);
    return {
      adjustments: (parsed?.adj || []).map((a: any) => ({
        nutrient: a.nutrient || a.n || '',
        factor: a.factor ?? 1,
        beforeValue: a.before ?? 0,
        afterValue: a.after ?? 0,
        reason: a.why || a.reason || '',
      })),
      mealNote: parsed?.note || parsed?.mealNote || '',
      cookingTip: parsed?.tip || undefined,
    };
  }

  // ═══════════════════════════════════════
  // Pipeline 5: REPLY (conversational)
  // ═══════════════════════════════════════

  async generateMealReply(
    mealName: string,
    mealType: string,
    foods: FoodItem[],
    bioNote: string,
    memory?: Record<string, string[]>,
  ): Promise<{ reply: string; memoryUpdates: any[] }> {
    const itemList = foods.map(f =>
      `${f.name} (${f.confidence < 0.6 ? 'uncertain' : f.confidence.toFixed(1)})`
    ).join(', ');
    const lowConfItems = foods.filter(f => f.confidence < 0.6).map(f => f.name);

    const memoryContext: MemoryContext = {
      foodNames: foods.map(f => f.name),
      mealType,
      currentTime: getTimeOfDay(new Date().getHours()),
    };
    const scopedMemory = memory ? formatScopedMemory(memory, memoryContext) : '';

    const prompt = `You are Mittens. Direct, concise, no emojis.

Logged: ${mealName} (${mealType})
Items: ${itemList}
${bioNote ? `Note: ${bioNote}` : ''}
${scopedMemory ? scopedMemory : ''}
${lowConfItems.length > 0 ? `LOW CONFIDENCE: ${lowConfItems.join(', ')}` : ''}

If any item confidence < 0.6, ask about it naturally.
Keep to 2-3 sentences max.

JSON: {"reply":"...","memoryUpdates":[]}`;

    const raw = await LocalInferenceService.generateLocalResponse(prompt);
    const parsed = extractJSON(raw);

    return {
      reply: parsed?.reply || raw.trim(),
      memoryUpdates: parsed?.memoryUpdates || [],
    };
  }

  // ═══════════════════════════════════════
  // Pipeline 6: PANTRY_ID (2-phase)
  // ═══════════════════════════════════════

  async identifyPantry(images: string[]): Promise<{
    items: Array<{ name: string; quantity: string; confidence: number }>;
  }> {
    if (images.length === 0) return { items: [] };

    const prompt = `Identify all food items visible in this fridge/pantry/shelf photo.
For each item estimate quantity and confidence 0.0-1.0.

JSON: {"items":[{"n":"Eggs","qty":"6 eggs","c":0.95}]}`;

    const resized = await prepareImage(images[0]);
    const raw = await LocalInferenceService.generateWithImage(prompt, resized);
    const parsed = extractJSON(raw);

    return {
      items: (parsed?.items || []).map((i: any) => ({
        name: i.n || i.name || '',
        quantity: i.qty || i.quantity || '',
        confidence: i.c ?? i.confidence ?? 0.8,
      })),
    };
  }

  async assessFreshness(
    images: string[],
    items: Array<{ name: string; quantity: string }>,
  ): Promise<{
    items: Array<{ name: string; freshness: string; checkBy: string; reason?: string; confidence: number }>;
  }> {
    if (images.length === 0 || items.length === 0) return { items: [] };

    const itemList = items.map(i => `${i.name} (${i.quantity})`).join(', ');
    const prompt = `For these pantry items, estimate freshness and when to check on them:
Items: ${itemList}

freshness: "fresh" / "good" / "use_soon" / "questionable"

JSON: {"items":[{"n":"Spinach","freshness":"use_soon","checkBy":"2026-04-26","reason":"leaves look wilted","c":0.7}]}`;

    const resized = await prepareImage(images[0]);
    const raw = await LocalInferenceService.generateWithImage(prompt, resized);
    const parsed = extractJSON(raw);

    return {
      items: (parsed?.items || []).map((i: any) => ({
        name: i.n || i.name || '',
        freshness: i.freshness || 'good',
        checkBy: i.checkBy || '',
        reason: i.reason,
        confidence: i.c ?? i.confidence ?? 0.7,
      })),
    };
  }

  // ═══════════════════════════════════════
  // Cooking Series: Incremental Detection
  // ═══════════════════════════════════════

  async detectNewInSeries(
    images: string[],
    existingItems: FoodItem[],
  ): Promise<{
    newItems: FoodItem[];
    updates: Array<{ name: string; cooking?: string; reason: string }>;
  }> {
    if (images.length === 0) return { newItems: [], updates: [] };

    const existingList = existingItems.map(i => `${i.name} ${i.portion_g}g (${i.cooking || 'unknown'})`).join(', ');

    const prompt = `Cooking series. Previous photos showed: ${existingList}

What's NEW or CHANGED in this photo?
- New ingredients added?
- Cooking state changed? (raw to cooked, added seasoning)

JSON: {"new":[{"n":"Blueberry","g":30,"hp":"handful","k":"raw","c":0.9}],
"updates":[{"n":"Oats","k":"boiled","reason":"now fully cooked"}]}`;

    const resized = await prepareImage(images[0]);
    const raw = await LocalInferenceService.generateWithImage(prompt, resized);
    const parsed = extractJSON(raw);

    return {
      newItems: (parsed?.new || []).map(expandFoodItem),
      updates: parsed?.updates || [],
    };
  }

  // ═══════════════════════════════════════
  // Agent Mode: Intent Classification + Quick Reply
  // ═══════════════════════════════════════

  /**
   * Fast text-only intent classification (no vision, no heavy reasoning).
   * Used by the agent layer to decide: handle locally or route to brain?
   */
  async classifyIntent(text: string): Promise<{
    intent: 'quick_chat' | 'meal_log' | 'activity_log' | 'data_query' | 'complex';
    confidence: number;
  }> {
    const lower = text.toLowerCase();

    // Fast heuristic pass -- skip model call for obvious patterns
    if (/^(hi|hello|hey|good morning|good night|thanks|thank you)\b/i.test(lower)) {
      return { intent: 'quick_chat', confidence: 0.95 };
    }
    if (/\b(ate|had|eating|breakfast|lunch|dinner|snack|meal|food)\b/i.test(lower)) {
      return { intent: 'meal_log', confidence: 0.8 };
    }
    if (/\b(ran|walked|biked|exercise|workout|yoga|gym|swim)\b/i.test(lower)) {
      return { intent: 'activity_log', confidence: 0.8 };
    }
    if (/\b(how much|how many|total|today|this week|average|calories|protein|vitamin)\b/i.test(lower)) {
      return { intent: 'data_query', confidence: 0.75 };
    }

    // Ambiguous -- use E2B for a quick classification
    const prompt = `Classify this message intent. One word only: CHAT, MEAL, ACTIVITY, QUERY, or COMPLEX.
"${text}"
Intent:`;

    const raw = await LocalInferenceService.generateLocalResponse(prompt);
    const word = raw.trim().toUpperCase().split(/\s/)[0];

    const map: Record<string, 'quick_chat' | 'meal_log' | 'activity_log' | 'data_query' | 'complex'> = {
      CHAT: 'quick_chat', MEAL: 'meal_log', ACTIVITY: 'activity_log',
      QUERY: 'data_query', COMPLEX: 'complex',
    };
    return { intent: map[word] || 'complex', confidence: 0.6 };
  }

  // ═══════════════════════════════════════
  // Legacy chat (proxied through backend)
  // ═══════════════════════════════════════

  async chat(context: ChatContext): Promise<ChatResponse> {
    const prompt = this.buildChatPrompt(context.message);
    const rawResponse = await LocalInferenceService.generateLocalResponse(prompt);

    try {
      const parsed = extractJSON(rawResponse);
      if (parsed) {
        // Handle OpenAI-style format: {"role":"assistant","content":[{"type":"text","text":"..."}]}
        if (parsed.role === 'assistant' && parsed.content) {
          const text = Array.isArray(parsed.content)
            ? parsed.content.map((c: any) => c.text || '').join('')
            : typeof parsed.content === 'string' ? parsed.content : '';
          return { reply: stripEmoji(text), memoryUpdates: [], dataNeeded: [] };
        }
        return {
          reply: stripEmoji(parsed.draftReply || parsed.reply || parsed.r || rawResponse),
          memoryUpdates: parsed.memoryUpdates || parsed.mu || [],
          dataNeeded: parsed.dataNeeded || parsed.dn || [],
          actions: parsed.actions || [],
        };
      }
    } catch { /* fall through */ }

    return { reply: stripEmoji(rawResponse), memoryUpdates: [], dataNeeded: [] };
  }

  async generateRaw(prompt: string): Promise<string> {
    return LocalInferenceService.generateLocalResponse(prompt);
  }

  async generateWithImage(prompt: string, imagePath: string): Promise<string> {
    const resizedPath = await prepareImage(imagePath);
    return LocalInferenceService.generateWithImage(prompt, resizedPath);
  }

  // --- Internal ---

  private buildChatPrompt(message: string): string {
    return `You are Mittens. Be direct, concise, evidence-based. No emojis.

Respond with ONLY plain text. Do NOT wrap your response in JSON or any format. Just answer naturally.

User: ${message}

Mittens:`;
  }
}
