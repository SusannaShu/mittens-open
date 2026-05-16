/**
 * ambient/aeiouDetector.ts -- Single VLM phase for AEIOU detection.
 *
 * Runs one VLM call per capture frame and returns any detected AEIOU signals.
 * Only returns fields that are actually observed -- never fabricates.
 *
 * AEIOU framework:
 *   A = Activities: What is the person doing?
 *   E = Environments: What kind of place is this?
 *   I = Interactions: Who/what is the person interacting with?
 *   O = Objects: What devices/tools/objects are being used?
 *   U = Users: Who else is present?
 */

export interface AeiouObservation {
  activity?: string;
  environment?: string;
  interactions?: string;
  objects?: string;
  users?: string;
}

/**
 * Detect AEIOU elements from a single capture frame.
 * Returns only fields where something was actually observed.
 */
export async function detectAeiou(
  framePath: string,
  sceneDescription: string,
): Promise<AeiouObservation | null> {
  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    if (!brain.supportsVision) return null;

    const prompt = [
      'Analyze this wearable camera photo for the AEIOU design framework.',
      'Only report what you can actually see. Do not guess or fabricate.',
      '',
      'A = Activities: What is the person doing? Structured or free-form? What role did the person play?',
      'E = Environments: Where were they? How did the setting make them feel? (e.g. open, confined, calm, chaotic)',
      'I = Interactions: Who or what did they interact with? Formal or casual?',
      'O = Objects: What devices, tools, or items were they using?',
      'U = Users: Who else was there? Did they add to or take from the experience?',
      '',
      `Scene context: ${sceneDescription || 'unknown'}`,
      '',
      'Return JSON only. Omit any field you cannot determine:',
      '{"activity":"...","environment":"...","interactions":"...","objects":"...","users":"..."}',
    ].join('\n');

    const raw = await brain.vision(prompt, [framePath]);
    return parseAeiou(raw);
  } catch (err: any) {
    console.warn('[AeiouDetector] Failed:', err?.message);
    return null;
  }
}

/**
 * Summarize multiple AEIOU observations into one summary per field.
 * Used when aggregating across all captures in an activity session.
 */
export async function summarizeAeiou(
  observations: AeiouObservation[],
): Promise<AeiouObservation> {
  if (observations.length === 0) return {};
  if (observations.length === 1) return observations[0];

  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    const prompt = [
      'Summarize these AEIOU observations from multiple camera captures during one activity session.',
      'Combine related observations. Keep it concise (1-2 sentences per field).',
      '',
      'Observations:',
      ...observations.map((o, i) => `Frame ${i + 1}: ${JSON.stringify(o)}`),
      '',
      'Return JSON with summarized fields:',
      '{"activity":"...","environment":"...","interactions":"...","objects":"...","users":"..."}',
    ].join('\n');

    const raw = await brain.text(prompt);
    return parseAeiou(raw) || {};
  } catch {
    // Fallback: just use the last observation
    return observations[observations.length - 1];
  }
}

// --- Parser ---

function parseAeiou(raw: string): AeiouObservation | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]);
    const result: AeiouObservation = {};
    let hasAny = false;

    for (const key of ['activity', 'environment', 'interactions', 'objects', 'users'] as const) {
      const val = parsed[key];
      if (val && typeof val === 'string' && val.trim().length > 0) {
        result[key] = val.trim();
        hasAny = true;
      }
    }

    return hasAny ? result : null;
  } catch {
    return null;
  }
}
