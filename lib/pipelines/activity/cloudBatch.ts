/**
 * Cloud Batch -- combines multiple activity phases into a single API call.
 *
 * When using cloud brains (Gemini, Claude, Groq) with large context windows,
 * we avoid 429 rate limits by sending ONE prompt covering all phases instead
 * of 5 sequential calls.
 *
 * The combined prompt asks for all phase outputs in a single JSON response.
 * After parsing, results are split back into per-phase objects so the UI
 * and downstream code get the same shape regardless of execution strategy.
 *
 * LOCAL BRAINS: Do NOT use this. Local brains keep sequential per-phase
 * execution because they have no rate limits and benefit from showing
 * incremental progress in the UI.
 */

import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { ActivityTypeService } from '../../services/activityTypeService';
import type { ActivityPhase } from './triage';
import type {
  ActivityDetectResult,
  EnvironmentResult,
  SocialResult,
  LifeDesignResult,
} from '../types';

// ─── Combined prompt builder ───

function buildCombinedPrompt(
  phases: ActivityPhase[],
  input: PipelineInput,
  manualContext: any,
): string {
  const sections: string[] = [];

  sections.push(`Analyze this activity from the photo and/or text. Return ALL requested sections in a single JSON response.\n`);

  if (phases.includes('detect')) {
    sections.push(`=== ACTIVITY DETECTION ===
You are identifying the specific activity for a personal time-tracking and well-being journal.
This classification feeds into a Stanford Life Design dashboard.

Provide in the "detect" key:
- activityType: walk, run, bike, workout, sun, work, social, rest, stress, soul, cooking, commute, or other
- logName: concise 2-5 word journal title
- duration_min: estimated minutes
- intensity: low, moderate, or high
- location: where the activity is happening, if identifiable
- confidence: 0-1 certainty`);
  }

  if (phases.includes('environment')) {
    sections.push(`\n=== ENVIRONMENT (Stanford Life Design "E") ===
Classify the setting for well-being correlation analysis.

Provide in the "environment" key:
- environment: "indoor" or "outdoor"
- subtype: "nature", "urban", "home", or "office" (only if clearly identifiable)`);
  }

  if (phases.includes('social')) {
    sections.push(`\n=== SOCIAL CONTEXT (Stanford Life Design "I") ===
Identify interaction patterns for relationship health tracking.

Provide in the "social" key:
- interactions: "solo", "1-2", "small_group", or "large_group"
Base on visible people, mentioned names, or described social settings.
If only objects/scenery with no people, classify as "solo".`);
  }

  if (phases.includes('objects')) {
    sections.push(`\n=== OBJECTS (Stanford Life Design "O") ===
Identify tools and objects that define this activity.

Provide in the "objects" key:
- objects: comma-separated string of prominent objects (e.g., "laptop, coffee mug")`);
  }

  if (phases.includes('lifeDesign')) {
    const defaults = manualContext._lifeDefaults || { work: 0, health: 0, play: 0, love: 0 };
    const actKey = manualContext.activityType || 'unknown';
    sections.push(`\n=== LIFE DESIGN (Stanford Life Design categories) ===
Assign category weights: Work (productive), Health (exercise/self-care), Play (fun/creative), Love (connecting with others).
Defaults for "${actKey}": ${JSON.stringify(defaults)}.
Override only when context clearly shifts the balance. Weights must sum to 1.0.

Also extract mentioned people names as comma-separated string.

Provide in the "lifeDesign" key:
- lifeCategories: { work: N, health: N, play: N, love: N }
- aeiou: { users: "Name1, Name2" }`);
  }

  sections.push(`\nContext text: ${input.text || 'None'}`);
  if (manualContext.activityType) {
    sections.push(`Manual hints: ${JSON.stringify(manualContext)}`);
  }

  // Show expected JSON shape
  const keys = phases.filter(p => p !== 'lifeDesign' || !manualContext.lifeCategories);
  sections.push(`\nRespond with a single JSON object containing keys: ${JSON.stringify(keys)}`);

  return sections.join('\n');
}

// ─── Combined response parser ───

interface CombinedResult {
  detect?: ActivityDetectResult;
  environment?: EnvironmentResult;
  social?: SocialResult;
  objects?: { objects: string };
  lifeDesign?: LifeDesignResult;
}

function parseCombinedResponse(raw: string, phases: ActivityPhase[]): CombinedResult {
  try {
    // Strip thinking blocks
    let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
    cleaned = cleaned.replace(/<\/?think>/g, '');

    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return {};

    const parsed = JSON.parse(match[0]);
    const result: CombinedResult = {};

    if (phases.includes('detect') && parsed.detect) {
      result.detect = {
        activityType: parsed.detect.activityType || 'other',
        logName: parsed.detect.logName || 'Unknown Activity',
        duration_min: parsed.detect.duration_min || 30,
        intensity: parsed.detect.intensity || 'moderate',
        location: parsed.detect.location,
        confidence: parsed.detect.confidence ?? 0.5,
      };
    }

    if (phases.includes('environment') && parsed.environment) {
      result.environment = {
        environment: parsed.environment.environment || 'indoor',
        subtype: parsed.environment.subtype,
      };
    }

    if (phases.includes('social') && parsed.social) {
      result.social = {
        interactions: parsed.social.interactions || 'solo',
      };
    }

    if (phases.includes('objects') && parsed.objects) {
      result.objects = {
        objects: typeof parsed.objects === 'string'
          ? parsed.objects
          : parsed.objects.objects || '',
      };
    }

    if (phases.includes('lifeDesign') && parsed.lifeDesign) {
      result.lifeDesign = {
        lifeCategories: parsed.lifeDesign.lifeCategories || { work: 0, health: 0, play: 0, love: 0 },
        aeiou: parsed.lifeDesign.aeiou,
      };
    }

    return result;
  } catch (err) {
    console.error('[CloudBatch:activity] Failed to parse combined response:', raw?.slice(0, 300));
    return {};
  }
}

// ─── Main entry point ───

/**
 * Run all activity phases as a single cloud API call.
 *
 * Returns the same context shape as sequential execution so the caller
 * doesn't need to know which strategy was used.
 */
export async function runActivityPhasesCloud(
  input: PipelineInput,
  phases: ActivityPhase[],
): Promise<any> {
  const brain = await getBrain();
  let context: any = { ...input.manualData };

  // Get default life categories for the prompt
  const activityTypeKey = context.activityType || '';
  let lifeDefaults = { work: 0, health: 0, play: 0, love: 0 };
  if (activityTypeKey) {
    try {
      const typeModel = await ActivityTypeService.getByKey(activityTypeKey);
      if (typeModel?.defaultLifeCategories) {
        lifeDefaults = { ...lifeDefaults, ...typeModel.defaultLifeCategories };
      }
    } catch { /* use defaults */ }
  }

  const promptContext = { ...context, _lifeDefaults: lifeDefaults };
  const prompt = buildCombinedPrompt(phases, input, promptContext);

  console.log('[CloudBatch:activity] Running', phases.length, 'phases in one call:', phases.join(', '));

  let raw: string;
  if (input.photos && input.photos.length > 0 && brain.supportsVision) {
    raw = await brain.vision(prompt, input.photos, { temperature: 0.1 });
  } else {
    raw = await brain.text(prompt, { temperature: 0.1 });
  }

  const combined = parseCombinedResponse(raw, phases);

  // Merge results into flat context (same shape as sequential execution)
  if (combined.detect) {
    context = { ...context, ...combined.detect };
  }
  if (combined.environment) {
    context = { ...context, ...combined.environment };
  }
  if (combined.social) {
    context = { ...context, ...combined.social };
  }
  if (combined.objects) {
    context = { ...context, aeiou: { ...context.aeiou, objects: combined.objects.objects } };
  }
  if (combined.lifeDesign) {
    context = { ...context, ...combined.lifeDesign };
  } else if (phases.includes('lifeDesign') && !context.lifeCategories) {
    // Fallback: use ActivityType defaults if brain didn't return lifeDesign
    context.lifeCategories = lifeDefaults;
  }

  return context;
}
