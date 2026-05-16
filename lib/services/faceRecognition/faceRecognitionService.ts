/**
 * faceRecognition/faceRecognitionService.ts
 *
 * High-level face recognition service that orchestrates:
 *   1. Native module for face detection + embedding extraction
 *   2. SQLite database for storing known faces
 *   3. Cosine similarity matching for recognition
 *   4. Reinforcement: saving new embeddings on confident re-identification
 *
 * This is the main entry point for the rest of the app.
 *
 * DEBUG: All operations log with [FaceRec] prefix for live console monitoring.
 */

import type { FaceMatch, IntroductionResult } from './types';
import {
  findPersonByName,
  createPerson,
  saveEmbedding,
  getAllEmbeddings,
  getEmbeddingCount,
  recordInteraction,
  pruneEmbeddings,
  getPersonById,
  getOwner,
} from './faceRecognitionApi';

// =============================================
// CONFIGURATION
// =============================================

/** Minimum cosine similarity to consider a match */
const MATCH_THRESHOLD = 0.80;

/** High-confidence threshold for automatic reinforcement */
const REINFORCE_THRESHOLD = 0.75;

/** Maximum embeddings to store per person before pruning */
const MAX_EMBEDDINGS_PER_PERSON = 20;

/** Cooldown: don't greet the same person within this window (ms) */
const GREET_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

/** Track last greeting times to avoid spamming */
const lastGreetTimes: Map<number, number> = new Map();

// =============================================
// INTRODUCTION ("Mittens, this is Caden")
// =============================================

/**
 * Register a new person or add embeddings to an existing one.
 *
 * Called when the user says "this is [Name]" during a button-press.
 * Extracts face embeddings from the frame and saves them.
 */
export async function introducePerson(
  name: string,
  framePath: string,
): Promise<IntroductionResult | null> {
  console.log(`[FaceRec] --- introducePerson START: "${name}" ---`);
  console.log(`[FaceRec] Frame: ${framePath.slice(-40)}`);

  // Extract face embeddings from the frame
  const faces = await detectFacesFromFrame(framePath);

  if (faces.length === 0) {
    console.log('[FaceRec] No faces detected in introduction frame');
    console.log('[FaceRec] --- introducePerson END (no faces) ---');
    return null;
  }

  // Find or create the person
  let person = findPersonByName(name);
  const isNew = !person;

  if (!person) {
    const personId = createPerson(name);
    person = getPersonById(personId);
    if (!person) {
      console.log('[FaceRec] Failed to create person record');
      return null;
    }
    console.log(`[FaceRec] Created new person: "${name}" (id=${person.id})`);
  } else {
    console.log(`[FaceRec] Found existing person: "${name}" (id=${person.id})`);
  }

  // Save embeddings for the first face detected (assumed to be the introduced person)
  const face = faces[0];
  saveEmbedding(person.id, face.embedding, face.confidence, framePath);

  // Record the interaction
  recordInteraction(person.id);

  const totalEmbeddings = getEmbeddingCount(person.id);
  console.log(
    `[FaceRec] ${isNew ? 'Registered' : 'Updated'} "${name}"` +
    ` -- embedding dim=${face.embedding.length}, confidence=${face.confidence.toFixed(3)}` +
    ` -- total embeddings: ${totalEmbeddings}`,
  );
  console.log(`[FaceRec] --- introducePerson END (success) ---`);

  return {
    personId: person.id,
    name: person.name,
    isNew,
    embeddingsSaved: totalEmbeddings,
  };
}

// =============================================
// RECOGNITION (ambient frame processing)
// =============================================

/**
 * Try to recognize faces in a pendant frame.
 *
 * Returns matches above the threshold, sorted by similarity.
 * Also handles reinforcement: if a high-confidence match is found,
 * saves the new embedding to strengthen future recognition.
 */
export async function recognizeFaces(
  framePath: string,
): Promise<FaceMatch[]> {
  console.log(`[FaceRec] --- recognizeFaces START ---`);
  console.log(`[FaceRec] Frame: ${framePath.slice(-40)}`);

  // Extract face embeddings from the frame
  const faces = await detectFacesFromFrame(framePath);

  if (faces.length === 0) {
    console.log('[FaceRec] No faces detected');
    console.log('[FaceRec] --- recognizeFaces END (0 faces) ---');
    return [];
  }

  // Load all known embeddings
  const knownEmbeddings = getAllEmbeddings();
  if (knownEmbeddings.length === 0) {
    console.log(`[FaceRec] No known embeddings in database -- cannot match`);
    console.log('[FaceRec] --- recognizeFaces END (no known faces) ---');
    return [];
  }

  // Group known embeddings by person
  const personEmbeddings = new Map<number, {
    name: string;
    embeddings: number[][];
  }>();

  for (const ke of knownEmbeddings) {
    const existing = personEmbeddings.get(ke.personId);
    if (existing) {
      existing.embeddings.push(ke.embedding);
    } else {
      personEmbeddings.set(ke.personId, {
        name: ke.personName,
        embeddings: [ke.embedding],
      });
    }
  }

  console.log(
    `[FaceRec] Comparing ${faces.length} detected face(s) against` +
    ` ${personEmbeddings.size} known people (${knownEmbeddings.length} total embeddings)`,
  );

  // Match each detected face against known people
  const matches: FaceMatch[] = [];

  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi];
    let bestMatch: FaceMatch | null = null;
    const scores: string[] = [];

    for (const [personId, data] of personEmbeddings) {
      // Compare against all embeddings for this person, take the best
      let bestSim = -1;
      for (const knownEmb of data.embeddings) {
        const sim = cosineSimilarity(face.embedding, knownEmb);
        if (sim > bestSim) bestSim = sim;
      }

      const pct = (bestSim * 100).toFixed(1);
      const marker = bestSim >= MATCH_THRESHOLD ? ' [MATCH]' : '';
      scores.push(`"${data.name}"(id=${personId}): ${pct}% of ${data.embeddings.length} emb${marker}`);

      if (bestSim >= MATCH_THRESHOLD) {
        if (!bestMatch || bestSim > bestMatch.similarity) {
          bestMatch = {
            personId,
            name: data.name,
            similarity: bestSim,
            embeddingCount: data.embeddings.length,
          };
        }
      }
    }

    // Log all comparison scores for this face
    console.log(`[FaceRec] Face #${fi + 1} (conf=${face.confidence.toFixed(3)}, box=${JSON.stringify(face.boundingBox)}):`);
    for (const s of scores) {
      console.log(`[FaceRec]   ${s}`);
    }

    if (bestMatch) {
      console.log(
        `[FaceRec] MATCH: "${bestMatch.name}" at ${(bestMatch.similarity * 100).toFixed(1)}%` +
        ` (threshold=${MATCH_THRESHOLD * 100}%)`,
      );
      matches.push(bestMatch);

      // Record the interaction (but do NOT auto-reinforce)
      recordInteraction(bestMatch.personId);
    } else {
      const bestOverall = scores.length > 0 ? scores[0] : 'no known faces';
      console.log(`[FaceRec] NO MATCH for face #${fi + 1} (best was: ${bestOverall})`);
    }
  }

  console.log(`[FaceRec] --- recognizeFaces END (${matches.length} match(es)) ---`);
  return matches.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Check if we should greet this person (cooldown-based).
 * Returns true if enough time has passed since the last greeting.
 */
export function shouldGreet(personId: number): boolean {
  const lastGreet = lastGreetTimes.get(personId);
  if (!lastGreet) return true;
  const elapsed = Date.now() - lastGreet;
  const should = elapsed > GREET_COOLDOWN_MS;
  if (!should) {
    console.log(
      `[FaceRec] Greeting skipped for person ${personId}` +
      ` -- ${Math.round(elapsed / 1000)}s since last greet` +
      ` (cooldown=${Math.round(GREET_COOLDOWN_MS / 1000)}s)`,
    );
  }
  return should;
}

/** Mark that we just greeted this person. */
export function markGreeted(personId: number): void {
  lastGreetTimes.set(personId, Date.now());
}

// =============================================
// REINFORCEMENT
// =============================================

/**
 * Save a new embedding for an already-recognized person.
 * Called explicitly after user confirmation (mittensAsk).
 */
export function confirmAndReinforce(
  personId: number,
  framePath: string,
): void {
  console.log(`[FaceRec] confirmAndReinforce: person=${personId}, frame=${framePath.slice(-30)}`);
  // Re-detect face to get fresh embedding
  detectFacesFromFrame(framePath).then(faces => {
    if (faces.length === 0) {
      console.log('[FaceRec] Reinforce aborted -- no face in frame');
      return;
    }
    const face = faces[0];
    reinforceRecognition(personId, face.embedding, framePath);
  }).catch(err => {
    console.warn('[FaceRec] Confirm reinforce failed:', err?.message);
  });
}

/**
 * Check if the matched person is the device owner.
 */
export function isOwner(personId: number): boolean {
  const owner = getOwner();
  return owner?.id === personId;
}

/**
 * Save a new embedding for an already-recognized person.
 * This is how the system "learns" a face better over time --
 * each new angle/lighting/expression adds to the person's profile.
 */
function reinforceRecognition(
  personId: number,
  embedding: number[],
  framePath: string
): void {
  const count = getEmbeddingCount(personId);

  // Don't over-reinforce: skip if we already have many embeddings
  if (count >= MAX_EMBEDDINGS_PER_PERSON) {
    console.log(
      `[FaceRec] Pruning embeddings for person ${personId}` +
      ` (${count} >= max ${MAX_EMBEDDINGS_PER_PERSON})`,
    );
    pruneEmbeddings(MAX_EMBEDDINGS_PER_PERSON - 1);
  }

  saveEmbedding(personId, embedding, 0.9, framePath); // Slightly lower confidence for auto-reinforced
  console.log(
    `[FaceRec] Reinforced person ${personId}` +
    ` (now ${count + 1} embeddings, dim=${embedding.length})`,
  );
}

// =============================================
// NATIVE MODULE BRIDGE
// =============================================

interface NativeFace {
  embedding: number[];
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Extract face embeddings from an image using the native module.
 * Falls back gracefully if the module is unavailable.
 */
async function detectFacesFromFrame(framePath: string): Promise<NativeFace[]> {
  console.log(`[FaceRec] detectFacesFromFrame: ${framePath.slice(-40)}`);
  try {
    const { getFaceRecognitionModule } = require(
      '../../../modules/expo-face-recognition/src',
    );
    const mod = getFaceRecognitionModule();
    if (!mod) {
      console.warn('[FaceRec] Native module not available (getFaceRecognitionModule returned null)');
      return [];
    }
    const faces = await mod.detectFaces(framePath);
    console.log(`[FaceRec] Native module detected ${faces.length} face(s)`);
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      console.log(
        `[FaceRec]   Face #${i + 1}: conf=${f.confidence.toFixed(3)}` +
        `, dim=${f.embedding.length}` +
        `, box=[${f.boundingBox.x.toFixed(0)},${f.boundingBox.y.toFixed(0)}` +
        ` ${f.boundingBox.width.toFixed(0)}x${f.boundingBox.height.toFixed(0)}]`,
      );
    }
    return faces;
  } catch (err: any) {
    console.warn('[FaceRec] Detection failed:', err?.message);
    return [];
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
function cosineSimilarity(a: number[], b: number[]): number {
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
