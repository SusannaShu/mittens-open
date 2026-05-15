/**
 * replayHarness.ts -- Feed saved frame sequences into the ambient pipeline.
 *
 * Usage (from React Native dev console or test script):
 *   import { runReplay } from './replayHarness';
 *   const result = await runReplay('breakfast_kefir_almonds');
 *
 * Each replay file is a JSON array of:
 *   { time: number, framePath: string, description?: string, gps?: { lat, lon } }
 *
 * The harness:
 *   1. Loads the replay file
 *   2. Gets the SceneStreamManager singleton
 *   3. Feeds each frame at the specified time offset
 *   4. Collects PipelineLogger output for each frame
 *   5. Returns a structured result for assertion / visual inspection
 */

import { getSceneStreamManager } from '../../lib/services/ambient/sceneStreamManager';

interface ReplayFrame {
  time: number;
  framePath: string;
  description?: string;
  gps?: { lat: number; lon: number };
}

interface ReplayResult {
  name: string;
  totalFrames: number;
  frameSummaries: string[];
  timeline: Array<{
    frameIndex: number;
    timeMs: number;
    description: string;
    summary: string;
  }>;
  durationMs: number;
}

/**
 * Run a replay scenario by name.
 * Looks for the file at mittens_pendant/replays/{name}.json
 */
export async function runReplay(name: string): Promise<ReplayResult> {
  console.log(`\n[Replay] ========== ${name} ==========\n`);

  // Load replay file
  let frames: ReplayFrame[];
  try {
    frames = require(`../replays/${name}.json`);
  } catch {
    throw new Error(`Replay file not found: ${name}.json`);
  }

  console.log(`[Replay] Loaded ${frames.length} frames\n`);

  const manager = getSceneStreamManager();
  const baseTime = Date.now();
  const timeline: ReplayResult['timeline'] = [];
  const frameSummaries: string[] = [];

  // Feed each frame
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const timestamp = baseTime + frame.time;

    console.log(
      `[Replay] Frame ${i + 1}/${frames.length} @ +${frame.time}ms: ${frame.description || frame.framePath}`,
    );

    // If GPS tag, set it on capture gate
    if (frame.gps) {
      try {
        const { getCaptureGate } = require('../../lib/services/ambient/captureGate');
        const gate = getCaptureGate();
        gate.setGpsTag(frame.gps.lat, frame.gps.lon);
      } catch { /* captureGate not loaded */ }
    }

    const result = await manager.onPendantFrame(frame.framePath, timestamp);
    const summary = result?.summary || 'no result';
    frameSummaries.push(summary);

    timeline.push({
      frameIndex: i,
      timeMs: frame.time,
      description: frame.description || frame.framePath,
      summary,
    });
  }

  // Collect results
  const result: ReplayResult = {
    name,
    totalFrames: frames.length,
    frameSummaries,
    timeline,
    durationMs: frames[frames.length - 1]?.time || 0,
  };

  // Print summary
  console.log('\n[Replay] ========== RESULTS ==========');
  console.log(`[Replay] Scenario: ${name}`);
  console.log(`[Replay] Frames processed: ${result.totalFrames}`);
  for (let i = 0; i < frameSummaries.length; i++) {
    console.log(`  Frame ${i + 1}: ${frameSummaries[i]}`);
  }
  console.log('[Replay] ================================\n');

  return result;
}

/**
 * Run all replays in the replays directory.
 */
export async function runAllReplays(): Promise<Map<string, ReplayResult>> {
  const scenarios = [
    'breakfast_kefir_almonds',
    'sedentary_desk_50min',
    'cook_then_work',
    'walk_to_park',
  ];

  const results = new Map<string, ReplayResult>();

  for (const scenario of scenarios) {
    try {
      const result = await runReplay(scenario);
      results.set(scenario, result);
    } catch (err: any) {
      console.error(`[Replay] FAILED: ${scenario} -- ${err?.message}`);
    }
  }

  return results;
}
