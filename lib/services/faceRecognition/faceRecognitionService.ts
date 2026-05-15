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

// ═══════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════

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

// ═══════════════════════════════════════
// INTRODUCTION ("Mittens, this is Caden")
// ═══════════════════════════════════════

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
  // Extract face embeddings from the frame
  const faces = await detectFacesFromFrame(framePath);

  if (faces.length === 0) {
    console.log('[FaceRecognition] No faces detected in introduction frame');
    return null;
  }

  // Find or create the person
  let person = findPersonByName(name);
  const isNew = !person;

  if (!person) {
    const personId = createPerson(name);
    person = getPersonById(personId);
    if (!person) return null;
    console.log(`[FaceRecognition] Created new person: ${name} (id=${person.id})`);
  }

  // Save embeddings for the first face detected (assumed to be the introduced person)
  const face = faces[0];
  saveEmbedding(person.id, face.embedding, face.confidence, framePath);

  // Record the interaction
  recordInteraction(person.id);

  console.log(
    `[FaceRecognition] ${isNew ? 'Registered' : 'Updated'} ${name}` +
    ` with embedding (dim=${face.embedding.length})`,
  );

  return {
    personId: person.id,
    name: person.name,
    isNew,
    embeddingsSaved: getEmbeddingCount(person.id),
  };
}

// ═══════════════════════════════════════
// RECOGNITION (ambient frame processing)
// ═══════════════════════════════════════

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
  // Extract face embeddings from the frame
  const faces = await detectFacesFromFrame(framePath);

  if (faces.length === 0) {
    return [];
  }

  // Load all known embeddings
  const knownEmbeddings = getAllEmbeddings();
  if (knownEmbeddings.length === 0) {
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

  // Match each detected face against known people
  const matches: FaceMatch[] = [];

  for (const face of faces) {
    let bestMatch: FaceMatch | null = null;

    for (const [personId, data] of personEmbeddings) {
      // Compare against all embeddings for this person, take the best
      let bestSim = -1;
      for (const knownEmb of data.embeddings) {
        const sim = cosineSimilarity(face.embedding, knownEmb);
        if (sim > bestSim) bestSim = sim;
      }

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

    if (bestMatch) {
      matches.push(bestMatch);

      // Record the interaction (but do NOT auto-reinforce)
      recordInteraction(bestMatch.personId);
    }
  }

  return matches.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Check if we should greet this person (cooldown-based).
 * Returns true if enough time has passed since the last greeting.
 */
export function shouldGreet(personId: number): boolean {
  const lastGreet = lastGreetTimes.get(personId);
  if (!lastGreet) return true;
  return Date.now() - lastGreet > GREET_COOLDOWN_MS;
}

/** Mark that we just greeted this person. */
export function markGreeted(personId: number): void {
  lastGreetTimes.set(personId, Date.now());
}

// ═══════════════════════════════════════
// REINFORCEMENT
// ═══════════════════════════════════════

/**
 * Save a new embedding for an already-recognized person.
 * Called explicitly after user confirmation (mittensAsk).
 */
export function confirmAndReinforce(
  personId: number,
  framePath: string,
): void {
  // Re-detect face to get fresh embedding
  detectFacesFromFrame(framePath).then(faces => {
    if (faces.length === 0) return;
    const face = faces[0];
    reinforceRecognition(personId, face.embedding, framePath);
  }).catch(err => {
    console.warn('[FaceRecognition] Confirm reinforce failed:', err?.message);
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
    pruneEmbeddings(MAX_EMBEDDINGS_PER_PERSON - 1);
  }

  saveEmbedding(personId, embedding, 0.9, framePath); // Slightly lower confidence for auto-reinforced
  console.log(
    `[FaceRecognition] Reinforced person ${personId} (now ${count + 1} embeddings)`,
  );
}

// ═══════════════════════════════════════
// NATIVE MODULE BRIDGE
// ═══════════════════════════════════════

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
  try {
    const { getFaceRecognitionModule } = require(
      '../../../modules/expo-face-recognition/src',
    );
    const mod = getFaceRecognitionModule();
    if (!mod) {
      console.warn('[FaceRecognition] Native module not available');
      return [];
    }
    return await mod.detectFaces(framePath);
  } catch (err: any) {
    console.warn('[FaceRecognition] Detection failed:', err?.message);
    return [];
  }
}

// ═══════════════════════════════════════
// MATH: COSINE SIMILARITY
// ═══════════════════════════════════════

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
