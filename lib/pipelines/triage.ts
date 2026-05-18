/**
 * Triage -- the entry point for ALL user input.
 *
 * Given photos + caption + context, determines which pipeline(s) to run
 * AND which phases within each pipeline have evidence to analyze.
 *
 *   - A photo could be food, selfie, sunset, fridge, running pic
 *   - A single message can trigger MULTIPLE pipelines:
 *     "biked to park and got smoothie" → activity + meal + outdoor/UV
 *   - Caption context matters: same park photo could be "went for a run"
 *     (activity) or "look at this salad I made" (meal)
 *
 * PHASE GATING:
 *   Triage now returns `inferrablePhases` per intent — which analysis
 *   dimensions have actual evidence in the input. A photo of a cactus
 *   has no social context; a meal photo may have no eating context cues.
 *   Phases only run when there's something concrete to infer from.
 *
 * MANUAL ENTRY BYPASS:
 *   When user uses the Manual Entry modal (Meal/Activity/Sleep tabs),
 *   triage is skipped entirely. The modal directly invokes the correct
 *   pipeline with pre-filled fields. This ensures manual and AI-detected
 *   entries flow through the exact same phase code.
 *
 * MIGRATED FROM:
 *   - geminiVision.classifyImage() (Backend) → the vision classification
 *   - gemmaLocalProvider.triage() → the meal/pantry decision
 *   - gemmaLocalProvider.classifyIntent() → text-only intent classification
 *   - useChatHandlers.ts routing logic → the if/else chain
 *
 * AFTER TRIAGE:
 *   For each detected intent, the orchestrator (useChatHandlers or a new
 *   usePipelineRunner hook) kicks off the corresponding pipeline.
 *   Each pipeline runs its Phase 0 (temporal) first, then its domain phases.
 *
 * TEMPORAL PHASE (Phase 0):
 *   Shared across all log pipelines. Determines WHEN this happened:
 *   1. Parse user text for temporal references ("yesterday", "this morning")
 *   2. Check photo EXIF timestamps
 *   3. Fall back to current time
 *   This runs once in triage, and the resolved timestamp is passed to each pipeline.
 */

import { getBrain } from '../brain/selector';
import type { TriageResult, DetectedIntent, TemporalResult } from './types';

// ─── Temporal Resolution ───

/**
 * Resolve the timestamp for a log entry.
 *
 * Priority:
 *   1. Explicit text references ("yesterday", "tuesday", "this morning")
 *   2. Photo EXIF timestamps
 *   3. Manual time picker value
 *   4. Now
 *
 * TODO: Parse relative dates properly (needs brain for ambiguous cases
 *       like "tuesday" -- is it last tuesday or next tuesday?)
 */
export async function resolveTimestamp(
  caption: string,
  photoTimestamps?: Date[],
  manualTime?: Date,
): Promise<TemporalResult> {
  // Manual override takes priority
  if (manualTime) {
    return { loggedAt: manualTime.toISOString(), source: 'manual', confidence: 1.0 };
  }

  // Photo EXIF timestamp
  if (photoTimestamps && photoTimestamps.length > 0) {
    const exifTime = photoTimestamps[0];
    if (!isNaN(exifTime.getTime())) {
      return { loggedAt: exifTime.toISOString(), source: 'exif', confidence: 0.9 };
    }
  }

  // TODO: Use brain to parse temporal references from caption
  // For now, check simple patterns
  const lower = caption.toLowerCase();
  const now = new Date();

  if (lower.includes('yesterday')) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    // Preserve rough time of day from context
    return { loggedAt: yesterday.toISOString(), source: 'user_text', confidence: 0.8 };
  }

  // Default: now
  return { loggedAt: now.toISOString(), source: 'now', confidence: 1.0 };
}

// ─── Triage ───

/**
 * Classify input and return which pipeline(s) to run,
 * AND which phases within each pipeline have evidence to analyze.
 *
 * For photo input: uses brain.vision() to classify
 * For text-only: uses brain.text() to classify intent
 *
 * Returns multiple intents -- caller runs each pipeline in parallel.
 */
export async function triage(
  images: string[],
  caption: string,
): Promise<TriageResult> {
  const brain = await getBrain();

  if (images.length > 0) {
    return triageWithVision(brain, images, caption);
  } else {
    return triageTextOnly(brain, caption);
  }
}

async function triageWithVision(brain: any, images: string[], caption: string): Promise<TriageResult> {
  const prompt = `You are the triage system for a personal well-being journal app.
Classify this photo and message to determine what should be logged and what can be analyzed.

User says: "${caption || '(photo only)'}"

For EACH detected intent, determine:
1. Which pipeline to trigger (meal, activity, pantry, sleep, timer, chat)
2. Which analysis phases have concrete evidence in the input

PIPELINES:
- meal: prepared/plated food being eaten
- activity: movement, events, work, social situations
- pantry: stored, raw, or unprepped food (fridge, shelf, groceries)
- sleep: sleep-related content
- timer: explicit request to start or stop a timer/focus session
- chat: conversational, greetings, or unclear

PHASE EVIDENCE (only list phases where you see concrete visual or textual cues):

For activity pipeline:
- "detect": always include when activity pipeline triggers
- "environment": visible indoor/outdoor setting cues (room, park, building, nature)
- "social": visible people OR text mentions of others
- "faces": ONLY include if faces are clearly visible and could be identified
- "objects": visible tools, devices, or equipment being used
- "lifeDesign": sufficient context to assess work/health/play/love balance

For meal pipeline:
- "identify": ONLY include if specific foods, ingredients, or drinks are visible and clearly distinguishable.
- "eatingContext": ONLY include if there are EXPLICIT, VISIBLE human eating behavior cues (e.g., a person actively chewing, a hand holding a fork/spoon, a person sitting at a table eating). ABSOLUTELY DO NOT include for photos of just plated food, drinks, or ingredients! If no human is interacting with the food, omit this phase.
- "pantryDelta": ONLY include if the scene appears to be cooking or eating AT HOME. Do NOT include if eating out at a restaurant.

For pantry/errands pipeline:
- "pantryDelta": ONLY include if you see grocery shopping (items placed in basket/cart, or paid at checkout) or specific food items being added to storage.

Return ALL that apply. A single submission can trigger multiple logs.

JSON: {"intents":[
  {"pipeline":"meal","confidence":0.9,"phases":["identify", "pantryDelta"]},
  {"pipeline":"activity","confidence":0.8,"activityType":"walk","phases":["detect","environment", "faces"], "faceLegible": true},
  {"pipeline":"chat","confidence":0.9,"phases":[]},
  {"pipeline":"timer","confidence":0.9,"activityType":"work","phases":[]}
]}

pipeline must be: meal, activity, pantry, sleep, timer, chat
activityType (if activity or timer): walk, run, bike, workout, sun, work, social, rest, stress, soul, cooking, commute, other
faceLegible (boolean): true ONLY if a person's face is clearly visible, in focus, and facing the camera. False if person is detected from behind, blurred, or face is not legible.

Guidance:
- pantry = stored, raw, or unprepped food (fridge, shelf, groceries). meal = prepared, plated, or being eaten.
- Person exercising, outdoors, at desk, socializing = activity (set activityType)
- Selfie/sunset with no food = activity context (detect + environment), social only if people visible
- A photo of scenery/objects alone: detect + environment, skip social/objects/lifeDesign
- "start a timer for work" or "working on mittens" = timer pipeline, activityType: work
- If unsure about a phase, leave it out of the phases list`;

  console.log('[Triage] Vision triage START, images:', images.length, 'caption:', caption?.slice(0, 40));
  console.log('[Triage] Brain:', brain.name, '| contextWindow:', brain.contextWindow, '| supportsVision:', brain.supportsVision);
  console.log('[Triage] Prompt length:', prompt.length, 'chars');
  console.log('[Triage] Image paths:', images.map((p: string) => p.slice(-50)));
  try {
    const raw = await brain.vision(prompt, images, { temperature: 0.1 });
    console.log('[Triage] Vision raw response:', raw?.slice(0, 120));
    return parseTriageResponse(raw);
  } catch (err: any) {
    // Log everything we know so the failure is diagnosable
    console.error('[Triage] Vision FAILED:', err?.message || err);
    console.error('[Triage] Failure context:', JSON.stringify({
      brain: brain.name,
      contextWindow: brain.contextWindow,
      isLocal: brain.isLocal,
      promptChars: prompt.length,
      imageCount: images.length,
      imagePaths: images.map((p: string) => p.slice(-60)),
      caption: caption?.slice(0, 60),
    }));
    console.error('[Triage] Stack:', err?.stack);
    throw err;
  }
}


const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    intents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pipeline: { type: 'string', enum: ['meal', 'activity', 'pantry', 'sleep', 'email', 'watch', 'timer', 'chat'] },
          confidence: { type: 'number' },
          activityType: { type: 'string' },
          mealType: { type: 'string' },
          storageType: { type: 'string' },
          extractedName: { type: 'string' },
          faceLegible: { type: 'boolean' },
          phases: { type: 'array', items: { type: 'string' } },
        },
        required: ['pipeline', 'confidence'],
      },
    },
  },
  required: ['intents'],
};

async function triageTextOnly(brain: any, caption: string): Promise<TriageResult> {
  const prompt = `You are the triage system for a personal well-being journal app.
Classify this message to determine what should be logged.

"${caption}"

For each detected intent, also specify which analysis phases have evidence in the text.

pipeline: meal (ONLY if explicitly logging a meal they ate/are eating. DO NOT trigger for questions like "what should I eat" or "recommend a meal"), activity (movement, events, work, social situations),
sleep (sleep mention), email (emails, orders, inbox), watch (websites, news, feeds),
timer (start or stop a focus timer), chat (conversational, question, or unclear. Questions about food belong here)

For meal: include "identify" ONLY if specific foods or drinks are named. "eatingContext" ONLY if the text explicitly describes HOW they are eating (e.g., "eating quickly", "eating while watching tv"). DO NOT include "eatingContext" for just mentioning what they ate. Include "pantryDelta" ONLY if they are cooking or eating at home (skip if eating out).

For activity: include phases with evidence — "detect" always, "social" if people mentioned,
"environment" if location mentioned, "objects" if tools/devices mentioned,
"faces" if specific people are named or introduced,
"lifeDesign" if enough context for work/health/play/love assessment.
"pantryDelta" if they specifically mention grocery shopping or restocking.

Can return multiple intents.

JSON: {"intents":[
  {"pipeline":"activity","confidence":0.9,"activityType":"work","phases":["detect","environment"]},
  {"pipeline":"timer","confidence":0.9,"phases":[]}
]}`;

  const fallback = { intents: [{ pipeline: 'chat', confidence: 0.5 }] };
  const result = await brain.json(prompt, TRIAGE_SCHEMA, fallback, { temperature: 0.1 });
  return normalizeTriageResult(result);
}

function parseTriageResponse(raw: string): TriageResult {
  try {
    // Strip thinking blocks before extracting JSON
    let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
    if (!cleaned.includes('<think>') && cleaned.includes('</think>')) {
      cleaned = cleaned.slice(cleaned.lastIndexOf('</think>') + '</think>'.length);
    }
    cleaned = cleaned.replace(/<\/?think>/g, '');

    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return normalizeTriageResult(JSON.parse(match[0]));
    }
  } catch { /* parse error, fall through */ }

  // Fallback: treat as chat
  return { intents: [{ pipeline: 'chat', confidence: 0.5 }] };
}

/** Normalize raw parsed JSON into a clean TriageResult and enforce confidence threshold */
function normalizeTriageResult(parsed: any): TriageResult {
  if (parsed.intents && Array.isArray(parsed.intents)) {
    const validIntents = parsed.intents
      .map((i: any) => ({
        pipeline: i.pipeline || 'chat',
        confidence: i.confidence ?? 0.5,
        inferrablePhases: Array.isArray(i.phases) ? i.phases : undefined,
        context: {
          mealType: i.mealType,
          activityType: i.activityType,
          storageType: i.storageType,
          extractedName: i.extractedName,
          faceLegible: i.faceLegible,
        },
      }))
      .filter((i: any) => i.confidence >= 0.3); // Do not log if below confidence level

    if (validIntents.length > 0) {
      return { intents: validIntents };
    }
  }
  return { intents: [{ pipeline: 'chat', confidence: 0.5 }] };
}

// ─── Duration Inference from Location ───

/**
 * Infer activity duration from location/motion data.
 *
 * Used after triage to estimate how long an activity lasted:
 *   - Meal: user is stationary → default 20min eating time
 *   - Work: user stationary at desk → duration from last motion change
 *   - Walk/bike/run: user was moving → duration from GPS trail
 *   - Commute: moving between known places → travel time
 *
 * RESEARCH NEEDED:
 *   - Default eating durations by meal type (breakfast ~15min, dinner ~30min)
 *   - How to detect "still eating" vs "done eating" from motion
 *   - Integration with location session data (locationSessionApi.ts)
 *
 * MIGRATED FROM:
 *   - Backend smartExtract duration_min estimation
 *   - locationService.ts motion type detection
 */
export async function inferDuration(
  activityType: string,
  _locationContext?: any,
): Promise<number> {
  // TODO: Integrate with location session data for accurate durations
  const defaults: Record<string, number> = {
    breakfast: 15,
    lunch: 20,
    dinner: 30,
    snack: 10,
    work: 60,
    walk: 30,
    run: 30,
    bike: 30,
    workout: 45,
    social: 60,
    rest: 30,
    cooking: 30,
    commute: 20,
  };
  return defaults[activityType] || 30;
}
