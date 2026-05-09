/**
 * syncEngine.ts -- Sync engine for local data.
 *
 * In the open-source version there is no cloud backend to sync to.
 * These exports exist to satisfy imports from schedule.tsx.
 */

export interface SyncProgress {
  currentTable: string;
  currentIndex: number;
  totalForTable: number;
  tablesCompleted: number;
  totalTables: number;
  overallPct: number;
}

/**
 * Sync local data to cloud -- no-op in local-only mode.
 */
export async function syncLocalToCloud(
  onProgress: (progress: SyncProgress) => void,
): Promise<{ success: boolean; synced: Record<string, number>; errors: string[] }> {
  onProgress({
    currentTable: 'Done',
    currentIndex: 0,
    totalForTable: 0,
    tablesCompleted: 0,
    totalTables: 0,
    overallPct: 100,
  });
  return { success: true, synced: {}, errors: [] };
}

/** Get sync stats -- always returns 0 in local-only mode. */
export function getSyncStats(): { total: number; tables: Record<string, number> } {
  return { total: 0, tables: {} };
}
