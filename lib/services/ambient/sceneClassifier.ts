/**
 * ambient/sceneClassifier.ts -- Dual-classifier for pendant frames.
 *
 * Single VLM call that extracts BOTH nutrition and activity signals.
 * A frame can produce both a nutrition log AND an activity log.
 * No rigid scene-type enum -- activity type is free-form for display.
 */

import type {
  FrameClassification,
  ClassifierContext,
} from './types';

/** Classify a pendant frame into nutrition + activity signals */
export async function classifyFrame(
  framePath: string,
  context: ClassifierContext,
): Promise<FrameClassification> {
  const { getBrain } = require('../../brain/selector');
  const brain = await getBrain();

  const prompt = buildPrompt(context);

  const fallback: FrameClassification = {
    nutrition: { detected: false, items: [] },
    activity: { detected: false, confidence: 0 },
    people: 0,
    description: '',
  };

  try {
    const raw = await brain.vision(prompt, [framePath]);
    return parseClassification(raw, fallback);
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('[Classifier] Vision failed:', msg);

    // Detect brain connectivity issues so the UI can surface them
    const isConnectivityError =
      err?.name === 'ConnectionError' ||
      msg.includes('Network request failed') ||
      msg.includes('Failed to fetch') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('Cannot reach') ||
      msg.includes('AbortError') ||
      msg.includes('Model file not downloaded');

    if (isConnectivityError) {
      return { ...fallback, error: `Brain offline: ${msg}` };
    }

    return fallback;
  }
}

// --- Prompt Construction ---

function buildPrompt(ctx: ClassifierContext): string {
  const parts: string[] = [
    'Analyze this photo from a wearable camera. The person wearing the camera is the subject.',
    'Respond JSON only:',
    '{',
    '  "nutrition": {',
    '    "detected": true/false (any food, drink, or snack visible?),',
    '    "items": [{"name": "...", "qty": 1, "unit": "whole", "conf": 0.9}] or [],',
    '    "context": "brief eating context" or null',
    '  },',
    '  "activity": {',
    '    "detected": true/false (recognizable activity?),',
    '    "type": "working" (free-form label: working, cooking, gym, resting, socializing, commuting, etc),',
    '    "description": "one-line description",',
    '    "conf": 0-1',
    '  },',
    '  "people": 0 (number of visible faces/people),',
    '  "description": "one-line overall scene description"',
    '}',
  ];

  if (ctx.place) {
    parts.push(`Location: ${ctx.place}`);
  }

  if (ctx.motionType) {
    parts.push(`Motion sensor: ${ctx.motionType}`);
  }

  if (ctx.recentMemory) {
    parts.push(`Notes: ${ctx.recentMemory}`);
  }

  return parts.join('\n');
}

// --- Response Parsing ---

function parseClassification(
  raw: string,
  fallback: FrameClassification,
): FrameClassification {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = JSON.parse(jsonMatch[0]);

    // Parse nutrition signal
    const rawNut = parsed.nutrition || {};
    const nutrition = {
      detected: Boolean(rawNut.detected),
      items: Array.isArray(rawNut.items)
        ? rawNut.items
            .map((item: any) => ({
              name: String(item.name || item.n || ''),
              qty: item.qty || item.q || undefined,
              unit: item.unit || item.u || undefined,
              confidence: Number(item.conf || item.confidence || 0.5),
            }))
            .filter((item: any) => item.name.length > 0)
        : [],
      context: rawNut.context || undefined,
    };

    // Parse activity signal
    const rawAct = parsed.activity || {};
    const activity = {
      detected: Boolean(rawAct.detected),
      type: rawAct.type || undefined,
      description: rawAct.description || undefined,
      confidence: Number(rawAct.conf || rawAct.confidence || 0),
    };

    return {
      nutrition,
      activity,
      people: Number(parsed.people || parsed.ppl || 0),
      description: parsed.description || parsed.desc || '',
    };
  } catch (err) {
    console.warn('[Classifier] Parse failed, using fallback');
    return fallback;
  }
}
