/**
 * Watch Plan -- Phase 1 (brain).
 *
 * Takes the user's natural language request and decides:
 *   1. Which source(s) to fetch
 *   2. What filter to apply
 *   3. Whether vision is needed (stories/images)
 *
 * Checks saved sources first for a shortcut match.
 */

import { getBrain } from '../../brain/selector';
import type { PipelineInput } from '../runner';
import type { WatchPlanResult } from '../types';
import { findSourceByKeyword } from './sources';

export async function planWatchAction(input: PipelineInput): Promise<WatchPlanResult> {
  // Check saved sources for a shortcut match
  const savedMatch = findSourceByKeyword(input.text || '');
  if (savedMatch) {
    return {
      sources: [{
        url: savedMatch.url,
        type: savedMatch.source_type as any,
        handle: savedMatch.platform_id || undefined,
        platform: savedMatch.platform || undefined,
      }],
      filter: savedMatch.filter_note || '',
      needsVision: savedMatch.source_type === 'ig_stories',
      savedSourceId: savedMatch.id,
      confidence: 0.95,
    };
  }

  const brain = await getBrain();

  const prompt = `User wants to check a website or social feed. Parse intent.

Input: "${input.text || ''}"

Return JSON:
{
  "sources": [{"url": "https://...", "type": "web", "platform": "hackernews"|"arxiv"|"reddit"|null, "handle": null}],
  "filter": "what to keep (or empty for all)",
  "vision": false
}

Rules:
- "hackernews" / "HN" / "hacker news" → url: "https://news.ycombinator.com", platform: "hackernews"
- "arxiv" + topic → url: "https://arxiv.org/list/{topic}/recent", platform: "arxiv"
- "reddit" + sub → url: "https://reddit.com/r/{sub}", platform: "reddit"
- Instagram handle → type: "ig_stories", vision: true
- Any other website → type: "web"
- filter: extract what user wants to see (e.g. "food events only", "robotics papers")`;

  const raw = await brain.text(prompt, { temperature: 0.1 });
  return parsePlanResponse(raw);
}

function parsePlanResponse(raw: string): WatchPlanResult {
  const defaults: WatchPlanResult = {
    sources: [],
    filter: '',
    needsVision: false,
    confidence: 0.5,
  };

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return defaults;
    const parsed = JSON.parse(match[0]);

    return {
      sources: (parsed.sources || []).map((s: any) => ({
        url: s.url || '',
        type: s.type || 'web',
        handle: s.handle || undefined,
        platform: s.platform || undefined,
      })),
      filter: parsed.filter || '',
      needsVision: parsed.vision === true,
      confidence: 0.85,
    };
  } catch {
    return defaults;
  }
}
