/**
 * faceRecognition/types.ts -- Type definitions for the face recognition system.
 */

/** A known person stored in the database */
export interface KnownPerson {
  id: number;
  name: string;
  nickname?: string;
  teamRole?: string;
  context?: string;
  interactionCount: number;
  lastSeenAt?: string;
  createdAt: string;
  avatarUri?: string;
  /** True if this person is the device owner */
  isMe?: boolean;
}

/** A single face embedding stored in the database */
export interface FaceEmbedding {
  id: number;
  personId: number;
  embedding: number[];
  confidence: number;
  capturedAt: string;
  imageUri?: string;
}

/** Result of a face recognition match */
export interface FaceMatch {
  personId: number;
  name: string;
  similarity: number;
  /** How many stored embeddings this person has (reinforcement strength) */
  embeddingCount: number;
}

/** Result of a face introduction ("this is Caden") */
export interface IntroductionResult {
  personId: number;
  name: string;
  isNew: boolean;
  embeddingsSaved: number;
}
