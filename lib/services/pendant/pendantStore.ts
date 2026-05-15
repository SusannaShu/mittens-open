/**
 * PendantStore -- In-memory + persistent store for pendant captures.
 *
 * Stores captures (frames + audio) with metadata.
 * Auto-cleans captures older than 1 day on init.
 * Persists to AsyncStorage so captures survive app restarts.
 * Emits change events for reactive UI updates.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ───

export interface PendantCapture {
  id: string;
  type: 'MOTION' | 'BUTTON_PRESS';
  timestamp: number;
  framePath?: string;
  audioPath?: string;
  brainResponse?: string;
  transcript?: string;
  pipelineLog?: any;
  processed: boolean;
}

// ─── Constants ───

const STORAGE_KEY = '@mittens_pendant_captures';
const AUTO_CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── State ───

let captures: PendantCapture[] = [];
type Listener = (captures: PendantCapture[]) => void;
const listeners: Set<Listener> = new Set();
let loaded = false;

// ─── Event System ───

function notifyListeners() {
  const snapshot = [...captures];
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      // Listener error is non-blocking
    }
  });
}

/** Subscribe to capture changes. Returns unsubscribe function. */
export function onCapturesChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ─── Persistence ───

async function persistCaptures() {
  try {
    // Only persist metadata, not actual file data
    const serializable = captures.map((c) => ({
      ...c,
    }));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // Persistence failure is non-blocking
  }
}

async function loadCaptures() {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Dynamically rebase paths to handle iOS container UUID changes after rebuilds
        const FileSystem = require('expo-file-system/legacy');
        let docDir = FileSystem.documentDirectory;
        if (docDir && !docDir.endsWith('/')) docDir += '/';

        const rebasePath = (path?: string) => {
          if (!path || !docDir) return path;
          const match = path.indexOf('/Documents/');
          if (match !== -1) {
            return `${docDir}${path.substring(match + 11)}`;
          }
          return path;
        };

        captures = parsed.map((c: any) => ({
          ...c,
          framePath: rebasePath(c.framePath),
          audioPath: rebasePath(c.audioPath),
        }));
      }
    }
  } catch {
    // Load failure means fresh start
  }
  loaded = true;
}

// ─── Public API ───

/** Initialize store (load from disk). Auto-cleans captures older than 1 day. */
export async function initPendantStore(): Promise<void> {
  await loadCaptures();

  // Auto-cleanup captures older than 1 day
  const removed = await cleanupOlderThan(AUTO_CLEANUP_AGE_MS);
  if (removed > 0) {
    console.log(`[PendantStore] Auto-cleaned ${removed} captures older than 1 day`);
  }
}

/** Add a new capture. Returns the capture ID. */
export function addCapture(
  params: Omit<PendantCapture, 'id' | 'processed'>
): string {
  const id = `pc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const capture: PendantCapture = {
    ...params,
    id,
    processed: false,
  };

  captures.unshift(capture);

  notifyListeners();
  persistCaptures();
  return id;
}

/** Update an existing capture by ID. */
export function updateCapture(
  id: string,
  updates: Partial<Pick<PendantCapture, 'brainResponse' | 'transcript' | 'pipelineLog' | 'processed'>>
): void {
  const idx = captures.findIndex((c) => c.id === id);
  if (idx === -1) return;

  captures[idx] = { ...captures[idx], ...updates };
  notifyListeners();
  persistCaptures();
}

/** Remove a capture by ID. */
export function removeCapture(id: string): void {
  const before = captures.length;
  captures = captures.filter((c) => c.id !== id);
  if (captures.length < before) {
    notifyListeners();
    persistCaptures();
  }
}

/** Get all captures (newest first). */
export function getCaptures(): PendantCapture[] {
  return [...captures];
}

/** Get captures for today only. */
export function getTodayCaptures(): PendantCapture[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();
  return captures.filter((c) => c.timestamp >= todayTs);
}

/** Get stats for today. */
export function getTodayStats(): {
  motionCount: number;
  audioCount: number;
  totalCount: number;
} {
  const today = getTodayCaptures();
  return {
    motionCount: today.filter((c) => c.type === 'MOTION').length,
    audioCount: today.filter((c) => c.type === 'BUTTON_PRESS').length,
    totalCount: today.length,
  };
}

/** Remove captures older than the given age in milliseconds. Also deletes files. */
export async function cleanupOlderThan(ageMs: number): Promise<number> {
  const cutoff = Date.now() - ageMs;
  const toRemove = captures.filter((c) => c.timestamp < cutoff);
  if (toRemove.length === 0) return 0;

  // Delete associated files
  try {
    const FileSystem = require('expo-file-system/legacy');
    for (const c of toRemove) {
      if (c.framePath) {
        FileSystem.deleteAsync(c.framePath, { idempotent: true }).catch(() => {});
      }
      if (c.audioPath) {
        FileSystem.deleteAsync(c.audioPath, { idempotent: true }).catch(() => {});
      }
    }
  } catch { /* file cleanup non-blocking */ }

  captures = captures.filter((c) => c.timestamp >= cutoff);
  notifyListeners();
  persistCaptures();
  return toRemove.length;
}

/** Remove multiple captures by IDs. Also deletes associated files. */
export async function removeCaptures(ids: string[]): Promise<number> {
  const idSet = new Set(ids);
  const toRemove = captures.filter((c) => idSet.has(c.id));
  if (toRemove.length === 0) return 0;

  // Delete associated files
  try {
    const FileSystem = require('expo-file-system/legacy');
    for (const c of toRemove) {
      if (c.framePath) {
        FileSystem.deleteAsync(c.framePath, { idempotent: true }).catch(() => {});
      }
      if (c.audioPath) {
        FileSystem.deleteAsync(c.audioPath, { idempotent: true }).catch(() => {});
      }
    }
  } catch { /* file cleanup non-blocking */ }

  captures = captures.filter((c) => !idSet.has(c.id));
  notifyListeners();
  persistCaptures();
  return toRemove.length;
}
