/**
 * placeRecognition/placeRecognitionApi.ts -- SQLite CRUD for place embeddings.
 *
 * Manages the `place_embeddings` table. Each place (from the existing
 * `known_places` table) can have multiple embeddings captured from different
 * angles, lighting, and times of day. More embeddings = better recognition.
 *
 * Embeddings are stored as JSON arrays of floats.
 */

import { getDb } from '../../database';
import type { KnownPlace, PlaceEmbedding } from './types';

// ═══════════════════════════════════════
// TABLE INITIALIZATION
// ═══════════════════════════════════════

let initialized = false;

/** Ensure the place_embeddings table exists. Safe to call multiple times. */
export function initPlaceRecognitionTable(): void {
  if (initialized) return;

  const db = getDb();
  db.execSync(`
    CREATE TABLE IF NOT EXISTS place_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id INTEGER NOT NULL REFERENCES known_places(id) ON DELETE CASCADE,
      embedding TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      captured_at TEXT DEFAULT (datetime('now')),
      image_uri TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_place_embeddings_place
      ON place_embeddings(place_id);
  `);

  initialized = true;
}

// ═══════════════════════════════════════
// PLACES (uses existing known_places table)
// ═══════════════════════════════════════

/** Find a place by name (case-insensitive). */
export function findPlaceByName(name: string): KnownPlace | null {
  initPlaceRecognitionTable();
  const db = getDb();
  const row = db.getFirstSync(
    `SELECT * FROM known_places WHERE LOWER(name) = LOWER(?)`,
    [name],
  ) as any;
  return row ? rowToPlace(row) : null;
}

/** Create a new place and return its ID. */
export function createPlace(
  name: string,
  latitude?: number,
  longitude?: number,
  placeType: string = 'other',
): number {
  initPlaceRecognitionTable();
  const db = getDb();
  const result = db.runSync(
    `INSERT INTO known_places (name, latitude, longitude, place_type, auto_detected, created_at)
     VALUES (?, ?, ?, ?, 0, datetime('now'))`,
    [name, latitude || 0, longitude || 0, placeType],
  );
  return result.lastInsertRowId;
}

/** Get a place by ID. */
export function getPlaceById(id: number): KnownPlace | null {
  const db = getDb();
  const row = db.getFirstSync(
    `SELECT * FROM known_places WHERE id = ?`,
    [id],
  ) as any;
  return row ? rowToPlace(row) : null;
}

/** Get all known places. */
export function getAllPlaces(): KnownPlace[] {
  const db = getDb();
  const rows = db.getAllSync(
    `SELECT * FROM known_places ORDER BY name ASC`,
  ) as any[];
  return (rows || []).map(rowToPlace);
}

// ═══════════════════════════════════════
// EMBEDDINGS
// ═══════════════════════════════════════

/** Save a place embedding for a place. */
export function savePlaceEmbedding(
  placeId: number,
  embedding: number[],
  confidence: number = 1.0,
  imageUri?: string
): number {
  initPlaceRecognitionTable();
  const db = getDb();
  const result = db.runSync(
    `INSERT INTO place_embeddings (place_id, embedding, confidence, captured_at, image_uri)
     VALUES (?, ?, ?, datetime('now'), ?)`,
    [placeId, JSON.stringify(embedding), confidence, imageUri || null],
  );
  return result.lastInsertRowId;
}

/** Get all embeddings for a specific place. */
export function getEmbeddingsForPlace(placeId: number): PlaceEmbedding[] {
  initPlaceRecognitionTable();
  const db = getDb();
  const rows = db.getAllSync(
    'SELECT * FROM place_embeddings WHERE place_id = ? ORDER BY captured_at DESC',
    [placeId],
  ) as any[];
  return (rows || []).map(rowToEmbedding);
}

/** Get all embeddings across all places (for recognition matching). */
export function getAllPlaceEmbeddings(): Array<PlaceEmbedding & { placeName: string }> {
  initPlaceRecognitionTable();
  const db = getDb();
  const rows = db.getAllSync(
    `SELECT pe.*, kp.name as place_name
     FROM place_embeddings pe
     JOIN known_places kp ON pe.place_id = kp.id
     ORDER BY pe.place_id, pe.captured_at DESC`,
  ) as any[];
  return (rows || []).map((r) => ({
    ...rowToEmbedding(r),
    placeName: r.place_name,
  }));
}

/** Count embeddings for a place (reinforcement strength). */
export function getEmbeddingCount(placeId: number): number {
  initPlaceRecognitionTable();
  const db = getDb();
  const row = db.getFirstSync(
    'SELECT COUNT(*) as count FROM place_embeddings WHERE place_id = ?',
    [placeId],
  ) as any;
  return row?.count || 0;
}

/**
 * Prune old embeddings to keep storage bounded.
 * Keeps the N most recent embeddings per place.
 */
export function pruneEmbeddings(maxPerPlace: number = 15): void {
  initPlaceRecognitionTable();
  const db = getDb();
  const places = db.getAllSync(
    'SELECT DISTINCT place_id FROM place_embeddings',
  ) as any[];

  for (const row of (places || [])) {
    const pid = row.place_id;
    db.runSync(
      `DELETE FROM place_embeddings
       WHERE place_id = ? AND id NOT IN (
         SELECT id FROM place_embeddings
         WHERE place_id = ?
         ORDER BY captured_at DESC
         LIMIT ?
       )`,
      [pid, pid, maxPerPlace],
    );
  }
}

/** Delete a single embedding by ID. */
export function deleteEmbedding(embeddingId: number): void {
  initPlaceRecognitionTable();
  const db = getDb();
  db.runSync('DELETE FROM place_embeddings WHERE id = ?', [embeddingId]);
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

function rowToPlace(row: any): KnownPlace {
  return {
    id: row.id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusM: row.radius_m || 100,
    placeType: row.place_type || 'other',
    autoDetected: row.auto_detected === 1,
  };
}

function rowToEmbedding(row: any): PlaceEmbedding {
  return {
    id: row.id,
    placeId: row.place_id,
    embedding: JSON.parse(row.embedding),
    confidence: row.confidence,
    capturedAt: row.captured_at,
    imageUri: row.image_uri,
  };
}
