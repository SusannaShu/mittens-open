/**
 * faceRecognition/faceRecognitionApi.ts -- SQLite CRUD for face embeddings.
 *
 * Manages the `face_embeddings` table. Each person (from the existing
 * `people` table) can have multiple embeddings captured from different
 * angles, lighting, and expressions. More embeddings = better recognition.
 *
 * Embeddings are stored as JSON arrays of floats.
 */

import { getDb } from '../../database';
import type { KnownPerson, FaceEmbedding } from './types';

// ═══════════════════════════════════════
// TABLE INITIALIZATION
// ═══════════════════════════════════════

let initialized = false;

/** Ensure the face_embeddings table exists. Safe to call multiple times. */
export function initFaceRecognitionTable(): void {
  if (initialized) return;

  const db = getDb();
  db.execSync(`
    CREATE TABLE IF NOT EXISTS face_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      embedding TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      captured_at TEXT DEFAULT (datetime('now')),
      image_uri TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_face_embeddings_person
      ON face_embeddings(person_id);
  `);

  initialized = true;
}

// ═══════════════════════════════════════
// PEOPLE (uses existing people table)
// ═══════════════════════════════════════

/** Find a person by name (case-insensitive). */
export function findPersonByName(name: string): KnownPerson | null {
  initFaceRecognitionTable();
  const db = getDb();
  const row = db.getFirstSync(
    `SELECT p.*,
      (SELECT image_uri FROM face_embeddings fe WHERE fe.person_id = p.id AND fe.image_uri IS NOT NULL ORDER BY captured_at DESC LIMIT 1) as avatar_uri
     FROM people p WHERE LOWER(p.name) = LOWER(?)`,
    [name],
  ) as any;
  return row ? rowToPerson(row) : null;
}

/** Create a new person and return their ID. */
export function createPerson(name: string, context?: string): number {
  initFaceRecognitionTable();
  const db = getDb();
  const result = db.runSync(
    `INSERT INTO people (name, context, interaction_count, created_at, updated_at)
     VALUES (?, ?, 0, datetime('now'), datetime('now'))`,
    [name, context || null],
  );
  return result.lastInsertRowId;
}

/** Get a person by ID. */
export function getPersonById(id: number): KnownPerson | null {
  const db = getDb();
  const row = db.getFirstSync(
    `SELECT p.*,
      (SELECT image_uri FROM face_embeddings fe WHERE fe.person_id = p.id AND fe.image_uri IS NOT NULL ORDER BY captured_at DESC LIMIT 1) as avatar_uri
     FROM people p WHERE p.id = ?`,
    [id],
  ) as any;
  return row ? rowToPerson(row) : null;
}

/** Get all known people. */
export function getAllPeople(): KnownPerson[] {
  const db = getDb();
  const rows = db.getAllSync(
    `SELECT p.*,
      (SELECT image_uri FROM face_embeddings fe WHERE fe.person_id = p.id AND fe.image_uri IS NOT NULL ORDER BY captured_at DESC LIMIT 1) as avatar_uri
     FROM people p ORDER BY p.last_seen_at DESC`,
  ) as any[];
  return (rows || []).map(rowToPerson);
}

/** Update last_seen_at and increment interaction count. */
export function recordInteraction(personId: number): void {
  const db = getDb();
  db.runSync(
    `UPDATE people SET
       interaction_count = interaction_count + 1,
       last_seen_at = datetime('now'),
       updated_at = datetime('now')
     WHERE id = ?`,
    [personId],
  );
}

// ═══════════════════════════════════════
// EMBEDDINGS
// ═══════════════════════════════════════

/** Save a face embedding for a person. */
export function saveEmbedding(
  personId: number,
  embedding: number[],
  confidence: number = 1.0,
  imageUri?: string
): number {
  initFaceRecognitionTable();
  const db = getDb();
  const result = db.runSync(
    `INSERT INTO face_embeddings (person_id, embedding, confidence, captured_at, image_uri)
     VALUES (?, ?, ?, datetime('now'), ?)`,
    [personId, JSON.stringify(embedding), confidence, imageUri || null],
  );
  return result.lastInsertRowId;
}

/** Get all embeddings for a specific person. */
export function getEmbeddingsForPerson(personId: number): FaceEmbedding[] {
  initFaceRecognitionTable();
  const db = getDb();
  const rows = db.getAllSync(
    'SELECT * FROM face_embeddings WHERE person_id = ? ORDER BY captured_at DESC',
    [personId],
  ) as any[];
  return (rows || []).map(rowToEmbedding);
}

/** Get all embeddings across all people (for recognition matching). */
export function getAllEmbeddings(): Array<FaceEmbedding & { personName: string }> {
  initFaceRecognitionTable();
  const db = getDb();
  const rows = db.getAllSync(
    `SELECT fe.*, p.name as person_name
     FROM face_embeddings fe
     JOIN people p ON fe.person_id = p.id
     ORDER BY fe.person_id, fe.captured_at DESC`,
  ) as any[];
  return (rows || []).map((r) => ({
    ...rowToEmbedding(r),
    personName: r.person_name,
  }));
}

/** Count embeddings for a person (reinforcement strength). */
export function getEmbeddingCount(personId: number): number {
  initFaceRecognitionTable();
  const db = getDb();
  const row = db.getFirstSync(
    'SELECT COUNT(*) as count FROM face_embeddings WHERE person_id = ?',
    [personId],
  ) as any;
  return row?.count || 0;
}

/**
 * Prune old embeddings to keep storage bounded.
 * Keeps the N most recent embeddings per person.
 */
export function pruneEmbeddings(maxPerPerson: number = 20): void {
  initFaceRecognitionTable();
  const db = getDb();
  const people = db.getAllSync(
    'SELECT DISTINCT person_id FROM face_embeddings',
  ) as any[];

  for (const row of (people || [])) {
    const pid = row.person_id;
    db.runSync(
      `DELETE FROM face_embeddings
       WHERE person_id = ? AND id NOT IN (
         SELECT id FROM face_embeddings
         WHERE person_id = ?
         ORDER BY captured_at DESC
         LIMIT ?
       )`,
      [pid, pid, maxPerPerson],
    );
  }
}

/**
 * Undo the most recent reinforcement (within the last 15 minutes).
 * Used for voice correction ("that's not Caden").
 * If personName is provided, only deletes for that person.
 */
export function undoLastReinforcement(personName?: string): boolean {
  initFaceRecognitionTable();
  const db = getDb();
  
  if (personName) {
    const person = findPersonByName(personName);
    if (!person) return false;
    
    const row = db.getFirstSync(
      `SELECT id FROM face_embeddings 
       WHERE person_id = ? AND captured_at > datetime('now', '-15 minutes')
       ORDER BY captured_at DESC LIMIT 1`,
      [person.id]
    ) as any;
    
    if (row?.id) {
      db.runSync('DELETE FROM face_embeddings WHERE id = ?', [row.id]);
      return true;
    }
  } else {
    const row = db.getFirstSync(
      `SELECT id FROM face_embeddings 
       WHERE captured_at > datetime('now', '-15 minutes')
       ORDER BY captured_at DESC LIMIT 1`
    ) as any;
    
    if (row?.id) {
      db.runSync('DELETE FROM face_embeddings WHERE id = ?', [row.id]);
      return true;
    }
  }
  
  return false;
}

/** Delete a single embedding by ID ("not [name]" correction). */
export function deleteEmbedding(embeddingId: number): void {
  initFaceRecognitionTable();
  const db = getDb();
  db.runSync('DELETE FROM face_embeddings WHERE id = ?', [embeddingId]);
}

/** Get the device owner (person with is_me = 1). */
export function getOwner(): KnownPerson | null {
  const db = getDb();
  const row = db.getFirstSync(
    `SELECT p.*,
      (SELECT image_uri FROM face_embeddings fe WHERE fe.person_id = p.id AND fe.image_uri IS NOT NULL ORDER BY captured_at ASC LIMIT 1) as avatar_uri
     FROM people p WHERE p.is_me = 1 LIMIT 1`,
  ) as any;
  return row ? rowToPerson(row) : null;
}

/** Set a person as the device owner. Clears any previous owner. */
export function setOwner(personId: number): void {
  const db = getDb();
  db.runSync('UPDATE people SET is_me = 0 WHERE is_me = 1');
  db.runSync('UPDATE people SET is_me = 1, team_role = ? WHERE id = ?', ['self', personId]);
}

/** Delete a person and all their embeddings (CASCADE). */
export function deletePerson(personId: number): void {
  const db = getDb();
  db.runSync('DELETE FROM face_embeddings WHERE person_id = ?', [personId]);
  db.runSync('DELETE FROM people WHERE id = ?', [personId]);
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

function rowToPerson(row: any): KnownPerson {
  return {
    id: row.id,
    name: row.name,
    nickname: row.nickname,
    teamRole: row.team_role,
    context: row.context,
    interactionCount: row.interaction_count || 0,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    avatarUri: row.avatar_uri,
    isMe: row.is_me === 1,
  };
}

function rowToEmbedding(row: any): FaceEmbedding {
  return {
    id: row.id,
    personId: row.person_id,
    embedding: JSON.parse(row.embedding),
    confidence: row.confidence,
    capturedAt: row.captured_at,
    imageUri: row.image_uri,
  };
}
