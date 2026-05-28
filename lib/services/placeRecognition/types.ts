/**
 * placeRecognition/types.ts -- Type definitions for the place recognition system.
 */

/** A known place stored in the database */
export interface KnownPlace {
  id: number;
  name: string;
  latitude?: number;
  longitude?: number;
  radiusM: number;
  placeType: string;
  autoDetected: boolean;
}

/** A single place embedding stored in the database */
export interface PlaceEmbedding {
  id: number;
  placeId: number;
  embedding: number[];
  confidence: number;
  capturedAt: string;
  imageUri?: string;
}

/** Result of a place recognition match */
export interface PlaceMatch {
  placeId: number;
  name: string;
  similarity: number;
  /** How many stored embeddings this place has (reinforcement strength) */
  embeddingCount: number;
}

/** Result of a place introduction ("this is the coffee shop") */
export interface PlaceIntroductionResult {
  placeId: number;
  name: string;
  isNew: boolean;
  embeddingsSaved: number;
}
