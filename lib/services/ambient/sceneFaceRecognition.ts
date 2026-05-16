/**
 * ambient/sceneFaceRecognition.ts
 *
 * Face recognition integration for the ambient scene pipeline.
 * Runs recognition on frames when triage detects people, triggers
 * proactive greetings, and uses mittensAsk for embedding confirmation.
 *
 * Owner ("is me") gets a daily greeting instead of per-frame greetings.
 * Non-owners get cooldown-based greetings (10 min).
 *
 * DEBUG: Logs with [SceneFace] prefix for live console monitoring.
 */

import type { PipelineLogger } from '../../pipelines/logger';


/** Track the last calendar day the owner was greeted */
let lastOwnerGreetDate: string | null = null;

/**
 * Run face recognition on a frame when triage detects people.
 * - Matches faces against known embeddings
 * - Owner: auto-reinforce + daily greeting (once per day, not every frame)
 * - Others: mittensAsk confirmation before reinforcing
 */
export async function checkFaceRecognition(
  framePath: string,
  _scene: any,
  logger: PipelineLogger,
): Promise<void> {
  const faceIdx = logger.startPhase('scene', 'face_recognition');
  console.log(`[SceneFace] --- checkFaceRecognition START ---`);
  console.log(`[SceneFace] Frame: ${framePath.slice(-40)}`);

  try {
    const {
      recognizeFaces,
      shouldGreet,
      markGreeted,
      confirmAndReinforce,
      isOwner,
    } = require('../faceRecognition/faceRecognitionService');

    const matches = await recognizeFaces(framePath);

    if (matches.length === 0) {
      logger.completePhase(faceIdx, 'No known faces detected');
      console.log('[SceneFace] No known faces matched');
      console.log('[SceneFace] --- checkFaceRecognition END ---');
      return;
    }

    const topMatch = matches[0];
    const personIsOwner = isOwner(topMatch.personId);

    logger.completePhase(
      faceIdx,
      `Recognized: ${topMatch.name} (${Math.round(topMatch.similarity * 100)}%)${personIsOwner ? ' [owner]' : ''}`,
    );

    console.log(
      `[SceneFace] Top match: "${topMatch.name}"` +
      ` (similarity=${topMatch.similarity.toFixed(3)}` +
      `, embeddings=${topMatch.embeddingCount}` +
      `${personIsOwner ? ', OWNER' : ''})`,
    );

    // Owner: auto-reinforce (no confirmation needed) + daily greeting
    if (personIsOwner) {
      confirmAndReinforce(topMatch.personId, framePath);
      console.log(`[SceneFace] Owner auto-reinforced`);

      const today = new Date().toDateString();
      if (lastOwnerGreetDate === today) {
        console.log(`[SceneFace] Owner already greeted today (${today}) -- skipping`);
        console.log('[SceneFace] --- checkFaceRecognition END ---');
        return;
      }

      // First sighting of owner today -- greet once
      lastOwnerGreetDate = today;
      markGreeted(topMatch.personId);
      console.log(`[SceneFace] First owner sighting today -- composing greeting`);

      try {
        const { composeOwnerGreeting } = require('../faceRecognition/greetingComposer');
        const greeting = await composeOwnerGreeting(topMatch);
        if (greeting) {
          const { speak } = require('../ai/voiceService');
          speak(greeting);
          console.log(`[SceneFace] Owner greeting spoken: "${greeting}"`);
        }
      } catch (greetErr: any) {
        console.warn('[SceneFace] Owner greeting failed:', greetErr?.message);
      }
      console.log('[SceneFace] --- checkFaceRecognition END ---');
      return;
    }

    // Non-owner: greet + mittensAsk for confirmation before reinforcing
    if (shouldGreet(topMatch.personId)) {
      markGreeted(topMatch.personId);
      console.log(`[SceneFace] Greeting non-owner: "${topMatch.name}"`);

      try {
        const { composeGreeting } = require('../faceRecognition/greetingComposer');
        const greeting = await composeGreeting(topMatch);

        if (greeting) {
          const { speak } = require('../ai/voiceService');
          speak(greeting);
          console.log(`[SceneFace] Greeting spoken: "${greeting}"`);
        }

        // Ask for confirmation before reinforcing embedding
        try {
          const { mittensAsk } = require('../../hooks/pendant/usePendantBridge');
          const confirmed = await mittensAsk(
            `I see ${topMatch.name}, is that right?`
          );
          if (confirmed && /yes|yeah|yep|right|correct/i.test(confirmed)) {
            confirmAndReinforce(topMatch.personId, framePath);
            console.log(`[SceneFace] User confirmed -- reinforced: "${topMatch.name}"`);
          } else {
            console.log(`[SceneFace] User rejected match for "${topMatch.name}" -- not reinforcing`);
          }
        } catch {
          console.log('[SceneFace] mittensAsk not available -- skipping confirmation');
        }
      } catch (greetErr: any) {
        console.warn('[SceneFace] Greeting failed:', greetErr?.message);
      }
    } else {
      console.log(`[SceneFace] Greeting cooldown active for "${topMatch.name}" -- skipping`);
    }

    console.log('[SceneFace] --- checkFaceRecognition END ---');
  } catch (err: any) {
    logger.completePhase(faceIdx, `Error: ${err?.message}`);
    console.error(`[SceneFace] Error: ${err?.message}`);
    console.log('[SceneFace] --- checkFaceRecognition END (error) ---');
  }
}
