/**
 * placeRecognition/placeRecognitionService.ts
 *
 * High-level place recognition service that orchestrates:
 *   1. Native module for scene embedding extraction
 *   2. SQLite database for storing known place embeddings
 *   3. Cosine similarity matching for recognition
 *   4. Reinforcement: saving new embeddings on confirmed revisit
 *
 * This is the main entry point for the rest of the app.
 *
 * DEBUG: All operations log with [PlaceRec] prefix for live console monitoring.
 */

import type { PlaceMatch, PlaceIntroductionResult } from './types';
import {
  findPlaceByName,
  createPlace,
  savePlaceEmbedding,
  getAllPlaceEmbeddings,
  getEmbeddingCount,
  pruneEmbeddings,
  getPlaceById,
} from './placeRecognitionApi';

const FileSystem = require('expo-file-system/legacy');

// =============================================
// CONFIGURATION
// =============================================

/** Minimum cosine similarity to consider a match (lower than faces — scenes are less distinctive) */
const MATCH_THRESHOLD = 0.75;

/** Maximum embeddings to store per place before pruning */
const MAX_EMBEDDINGS_PER_PLACE = 15;

// =============================================
// INTRODUCTION ("Mittens, this is the coffee shop")
// =============================================

/**
 * Register a new place or add embeddings to an existing one.
 *
 * Called when the user says "this is [place name]" during a button-press.
 * Extracts scene embeddings from the frame and saves them.
 */
export async function introducePlace(
  name: string,
  framePath: string,
  lat?: number,
  lon?: number,
): Promise<PlaceIntroductionResult | null> {
  console.log(`[PlaceRec] --- introducePlace START: "${name}" ---`);
  console.log(`[PlaceRec] Frame: ${framePath.slice(-40)}`);

  // Extract scene embedding from the frame
  const embedding = await extractSceneEmbedding(framePath);

  if (!embedding) {
    console.log('[PlaceRec] No scene embedding extracted from introduction frame');
    console.log('[PlaceRec] --- introducePlace END (no embedding) ---');
    return null;
  }

  // Find or create the place
  let place = findPlaceByName(name);
  const isNew = !place;

  if (!place) {
    const placeId = createPlace(name, lat, lon);
    place = getPlaceById(placeId);
    if (!place) {
      console.log('[PlaceRec] Failed to create place record');
      return null;
    }
    console.log(`[PlaceRec] Created new place: "${name}" (id=${place.id})`);
  } else {
    console.log(`[PlaceRec] Found existing place: "${name}" (id=${place.id})`);
  }

  // Save embedding for the scene
  const persistedUri = await copyFrameForPlace(framePath, place.id);
  savePlaceEmbedding(place.id, embedding, 1.0, persistedUri);

  const totalEmbeddings = getEmbeddingCount(place.id);
  console.log(
    `[PlaceRec] ${isNew ? 'Registered' : 'Updated'} "${name}"` +
    ` -- embedding dim=${embedding.length}` +
    ` -- total embeddings: ${totalEmbeddings}`,
  );
  console.log(`[PlaceRec] --- introducePlace END (success) ---`);

  return {
    placeId: place.id,
    name: place.name,
    isNew,
    embeddingsSaved: totalEmbeddings,
  };
}

// =============================================
// RECOGNITION (ambient frame processing)
// =============================================

/**
 * Try to recognize a place in a pendant frame.
 *
 * Returns the best match above the threshold, or null.
 * Compares the scene embedding against all known place embeddings
 * using cosine similarity.
 */
export async function recognizePlace(
  framePath: string,
): Promise<PlaceMatch | null> {
  console.log(`[PlaceRec] --- recognizePlace START ---`);
  console.log(`[PlaceRec] Frame: ${framePath.slice(-40)}`);

  // Extract scene embedding from the frame
  const embedding = await extractSceneEmbedding(framePath);

  if (!embedding) {
    console.log('[PlaceRec] No scene embedding extracted');
    console.log('[PlaceRec] --- recognizePlace END (no embedding) ---');
    return null;
  }

  // Load all known embeddings
  const knownEmbeddings = getAllPlaceEmbeddings();
  if (knownEmbeddings.length === 0) {
    console.log(`[PlaceRec] No known embeddings in database -- cannot match`);
    console.log('[PlaceRec] --- recognizePlace END (no known places) ---');
    return null;
  }

  // Group known embeddings by place
  const placeEmbeddings = new Map<number, {
    name: string;
    embeddings: number[][];
  }>();

  for (const ke of knownEmbeddings) {
    const existing = placeEmbeddings.get(ke.placeId);
    if (existing) {
      existing.embeddings.push(ke.embedding);
    } else {
      placeEmbeddings.set(ke.placeId, {
        name: ke.placeName,
        embeddings: [ke.embedding],
      });
    }
  }

  console.log(
    `[PlaceRec] Comparing scene embedding against` +
    ` ${placeEmbeddings.size} known place(s) (${knownEmbeddings.length} total embeddings)`,
  );

  // Match the scene embedding against known places
  let bestMatch: PlaceMatch | null = null;
  const scores: string[] = [];

  for (const [placeId, data] of placeEmbeddings) {
    // Compare against all embeddings for this place, take the best
    let bestSim = -1;
    for (const knownEmb of data.embeddings) {
      const sim = cosineSimilarity(embedding, knownEmb);
      if (sim > bestSim) bestSim = sim;
    }

    const pct = (bestSim * 100).toFixed(1);
    const marker = bestSim >= MATCH_THRESHOLD ? ' [MATCH]' : '';
    scores.push(`"${data.name}"(id=${placeId}): ${pct}% of ${data.embeddings.length} emb${marker}`);

    if (bestSim >= MATCH_THRESHOLD) {
      if (!bestMatch || bestSim > bestMatch.similarity) {
        bestMatch = {
          placeId,
          name: data.name,
          similarity: bestSim,
          embeddingCount: data.embeddings.length,
        };
      }
    }
  }

  // Log all comparison scores
  console.log(`[PlaceRec] Scene embedding (dim=${embedding.length}):`);
  for (const s of scores) {
    console.log(`[PlaceRec]   ${s}`);
  }

  if (bestMatch) {
    console.log(
      `[PlaceRec] MATCH: "${bestMatch.name}" at ${(bestMatch.similarity * 100).toFixed(1)}%` +
      ` (threshold=${MATCH_THRESHOLD * 100}%)`,
    );
  } else {
    const bestOverall = scores.length > 0 ? scores[0] : 'no known places';
    console.log(`[PlaceRec] NO MATCH (best was: ${bestOverall})`);
  }

  console.log(`[PlaceRec] --- recognizePlace END (${bestMatch ? 'matched' : 'no match'}) ---`);
  return bestMatch;
}

// =============================================
// REINFORCEMENT
// =============================================

/**
 * Save a new embedding for an already-recognized place.
 * Called explicitly after user confirmation (confirmed revisit).
 */
export function confirmAndReinforce(
  placeId: number,
  framePath: string,
): void {
  console.log(`[PlaceRec] confirmAndReinforce: place=${placeId}, frame=${framePath.slice(-30)}`);
  // Re-extract scene embedding to get fresh embedding
  extractSceneEmbedding(framePath).then(embedding => {
    if (!embedding) {
      console.log('[PlaceRec] Reinforce aborted -- no scene embedding in frame');
      return;
    }
    reinforceRecognition(placeId, embedding, framePath);
  }).catch(err => {
    console.warn('[PlaceRec] Confirm reinforce failed:', err?.message);
  });
}

/**
 * Save a new embedding for an already-recognized place.
 * This is how the system "learns" a place better over time --
 * each new angle/lighting/time-of-day adds to the place's profile.
 */
function reinforceRecognition(
  placeId: number,
  embedding: number[],
  framePath: string
): void {
  const count = getEmbeddingCount(placeId);

  // Don't over-reinforce: skip if we already have many embeddings
  if (count >= MAX_EMBEDDINGS_PER_PLACE) {
    console.log(
      `[PlaceRec] Pruning embeddings for place ${placeId}` +
      ` (${count} >= max ${MAX_EMBEDDINGS_PER_PLACE})`,
    );
    pruneEmbeddings(MAX_EMBEDDINGS_PER_PLACE - 1);
  }

  // Copy frame to persistent location so it survives capture cleanup
  copyFrameForPlace(framePath, placeId).then(persistedUri => {
    savePlaceEmbedding(placeId, embedding, 0.9, persistedUri);
    console.log(
      `[PlaceRec] Reinforced place ${placeId}` +
      ` (now ${count + 1} embeddings, dim=${embedding.length})`,
    );
  }).catch(err => {
    // Fallback: save with original path
    savePlaceEmbedding(placeId, embedding, 0.9, framePath);
    console.warn('[PlaceRec] Frame copy failed, using original path:', err?.message);
  });
}

// =============================================
// NATIVE MODULE BRIDGE
// =============================================

/**
 * Extract a scene embedding from an image using the native module.
 * Falls back gracefully if the module is unavailable.
 */
async function extractSceneEmbedding(framePath: string): Promise<number[] | null> {
  console.log(`[PlaceRec] extractSceneEmbedding: ${framePath.slice(-40)}`);
  try {
    const { getFaceRecognitionModule } = require(
      '../../../modules/expo-face-recognition/src',
    );
    const mod = getFaceRecognitionModule();
    if (!mod) {
      console.warn('[PlaceRec] Native module not available (getFaceRecognitionModule returned null)');
      return null;
    }
    const embedding = await mod.generateSceneEmbedding(framePath);
    if (!embedding || embedding.length === 0) {
      console.log('[PlaceRec] Native module returned empty scene embedding');
      return null;
    }
    console.log(`[PlaceRec] Scene embedding extracted: dim=${embedding.length}`);
    return embedding;
  } catch (err: any) {
    console.warn('[PlaceRec] Scene embedding extraction failed:', err?.message);
    return null;
  }
}

// =============================================
// MATH: COSINE SIMILARITY
// =============================================

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1, where 1 = identical.
 *
 * Since our embeddings are L2-normalized, this simplifies to
 * the dot product.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    // Handle dimension mismatch by truncating to shorter
    const len = Math.min(a.length, b.length);
    a = a.slice(0, len);
    b = b.slice(0, len);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// =============================================
// IMAGE PERSISTENCE
// =============================================

/**
 * Copies a frame to a permanent location for place recognition storage.
 * Since pendant frames are regularly cleaned up, we must duplicate
 * the image so the gallery doesn't break.
 */
async function copyFrameForPlace(framePath: string, placeId: number): Promise<string> {
  try {
    const placesDir = `${FileSystem.documentDirectory}places/`;
    const dirInfo = await FileSystem.getInfoAsync(placesDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(placesDir, { intermediates: true });
    }

    const filename = `place_${placeId}_${Date.now()}.jpg`;
    const destPath = `${placesDir}${filename}`;

    await FileSystem.copyAsync({
      from: framePath,
      to: destPath,
    });

    console.log(`[PlaceRec] Copied place image to persistent storage: ${filename}`);
    return destPath;
  } catch (err: any) {
    console.warn('[PlaceRec] Failed to copy place frame:', err?.message);
    throw err;
  }
}
