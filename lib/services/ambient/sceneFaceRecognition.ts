/**
 * ambient/sceneFaceRecognition.ts
 *
 * Face recognition integration for the ambient scene pipeline.
 * Runs recognition on social-scene frames and triggers proactive greetings.
 *
 * Extracted from sceneStreamManager.ts to keep files under 400 lines.
 */

import type { PipelineLogger } from '../../pipelines/logger';

import type { Scene } from './types';

/**
 * Run face recognition on a frame during social scenes.
 * If a known person is recognized and the greet cooldown has passed,
 * speak a contextual greeting via TTS.
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
    } = require('../faceRecognition/faceRecognitionService');

    const matches = await recognizeFaces(framePath);

    if (matches.length === 0) {
      logger.completePhase(faceIdx, 'No known faces detected');
      return;
    }

    const topMatch = matches[0];
    logger.completePhase(
      faceIdx,
      `Recognized: ${topMatch.name} (${Math.round(topMatch.similarity * 100)}%)`,
    );

    console.log(
      `[SceneFace] Recognized: ${topMatch.name}` +
      ` (similarity=${topMatch.similarity.toFixed(3)})`,
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

    // Greet if cooldown has passed
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
      } catch (greetErr: any) {
        console.warn('[SceneFace] Greeting failed:', greetErr?.message);
      }
    }
  } catch (err: any) {
    logger.completePhase(faceIdx, `Error: ${err?.message}`);
  }
}
