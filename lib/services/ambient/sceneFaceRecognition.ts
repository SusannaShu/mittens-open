/**
 * ambient/sceneFaceRecognition.ts
 *
 * Face recognition integration for the ambient scene pipeline.
 * Runs recognition on frames when triage detects people, triggers
 * proactive greetings, and uses mittensAsk for embedding confirmation.
 *
 * Owner ("is me") gets a daily greeting instead of the 10-minute cooldown.
 */

import type { PipelineLogger } from '../../pipelines/logger';
import type { Scene } from './types';

/** Track the last calendar day the owner was greeted */
let lastOwnerGreetDate: string | null = null;

/**
 * Run face recognition on a frame when triage detects people.
 * - Matches faces against known embeddings
 * - Owner: auto-reinforce + daily greeting
 * - Others: mittensAsk confirmation before reinforcing
 */
export async function checkFaceRecognition(
  framePath: string,
  scene: Scene,
  logger: PipelineLogger,
): Promise<void> {
  const faceIdx = logger.startPhase('scene', 'face_recognition');

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
      return;
    }

    const topMatch = matches[0];
    const personIsOwner = isOwner(topMatch.personId);

    logger.completePhase(
      faceIdx,
      `Recognized: ${topMatch.name} (${Math.round(topMatch.similarity * 100)}%)${personIsOwner ? ' [owner]' : ''}`,
    );

    console.log(
      `[SceneFace] Recognized: ${topMatch.name}` +
      ` (similarity=${topMatch.similarity.toFixed(3)}` +
      `${personIsOwner ? ', owner' : ''})`,
    );

    // Track person in the scene (deduplication)
    if (!scene.detectedPeopleDetails) {
      scene.detectedPeopleDetails = [];
    }
    const alreadySeenInScene = scene.detectedPeopleDetails.some((p) => p.name === topMatch.name);
    
    if (!alreadySeenInScene) {
      scene.detectedPeopleDetails.push({
        name: topMatch.name,
        timestamp: Date.now(),
        imageUri: framePath,
      });
      console.log(`[SceneFace] Logged new person for scene ${scene.id}: ${topMatch.name}`);
    }

    // Owner: auto-reinforce (no confirmation needed) + daily greeting
    if (personIsOwner) {
      confirmAndReinforce(topMatch.personId, framePath);

      const today = new Date().toDateString();
      if (lastOwnerGreetDate !== today) {
        lastOwnerGreetDate = today;
        markGreeted(topMatch.personId);

        try {
          const { composeOwnerGreeting } = require('../faceRecognition/greetingComposer');
          const greeting = await composeOwnerGreeting(topMatch);
          if (greeting) {
            const { speak } = require('../ai/voiceService');
            speak(greeting);
            console.log(`[SceneFace] Owner greeting: "${greeting}"`);
          }
        } catch (greetErr: any) {
          console.warn('[SceneFace] Owner greeting failed:', greetErr?.message);
        }
      }
      return;
    }

    // Non-owner: greet + mittensAsk for confirmation before reinforcing
    if (shouldGreet(topMatch.personId)) {
      markGreeted(topMatch.personId);

      try {
        const { composeGreeting } = require('../faceRecognition/greetingComposer');
        const greeting = await composeGreeting(topMatch);

        if (greeting) {
          const { speak } = require('../ai/voiceService');
          speak(greeting);
          console.log(`[SceneFace] Greeting: "${greeting}"`);
        }

        // Ask for confirmation before reinforcing embedding
        try {
          const { mittensAsk } = require('../../hooks/pendant/usePendantBridge');
          const confirmed = await mittensAsk(
            `I see ${topMatch.name}, is that right?`
          );
          if (confirmed) {
            confirmAndReinforce(topMatch.personId, framePath);
            console.log(`[SceneFace] Confirmed + reinforced: ${topMatch.name}`);
          } else {
            console.log(`[SceneFace] User rejected match for ${topMatch.name}, not reinforcing`);
          }
        } catch {
          // mittensAsk not available (pendant not connected), skip reinforcement
        }
      } catch (greetErr: any) {
        console.warn('[SceneFace] Greeting failed:', greetErr?.message);
      }
    }
  } catch (err: any) {
    logger.completePhase(faceIdx, `Error: ${err?.message}`);
  }
}
