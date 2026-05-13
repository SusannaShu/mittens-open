/**
 * PendantStore -- In-memory + persistent store for pendant captures.
 *
 * Stores the last 100 captures (frames + audio) with metadata.
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
const MAX_CAPTURES = 100;

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

/** Initialize store (load from disk). Call once at app boot. */
export async function initPendantStore(): Promise<void> {
  await loadCaptures();
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

  // Trim to max
  if (captures.length > MAX_CAPTURES) {
    captures = captures.slice(0, MAX_CAPTURES);
  }

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

/** Remove captures older than the given age in milliseconds. */
export function cleanupOlderThan(ageMs: number): number {
  const cutoff = Date.now() - ageMs;
  const before = captures.length;
  captures = captures.filter((c) => c.timestamp >= cutoff);
  const removed = before - captures.length;
  if (removed > 0) {
    notifyListeners();
    persistCaptures();
  }
  return removed;
}
