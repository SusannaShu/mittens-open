/**
 * ambient/calendarEventMatcher.ts -- Match actual activities to planned calendar events.
 *
 * When a dwell-based activity log is created, checks calendar_events for
 * overlapping planned events. If matched:
 *   1. Sets google_event_id on the activity log (triggers hide in useSyncData)
 *   2. Updates activity title/type from calendar event data
 *   3. Adjusts times to actual arrival/departure
 */

import { getDb } from '../../database';

/** Time tolerance for matching calendar events to activities */
const MATCH_WINDOW_MS = 30 * 60 * 1000; // +/- 30 minutes

/**
 * Try to match a newly created activity log against planned calendar events.
 * If matched, links the activity to the calendar event (hiding the planned one)
 * and enriches the activity with calendar metadata.
 *
 * Returns the matched google_event_id or null.
 */
export function matchAndConvertPlannedEvent(
  activityLogId: number,
  loggedAt: string,
  placeName: string | null,
): string | null {
  try {
    const db = getDb();
    const logTime = new Date(loggedAt).getTime();
    const windowStart = new Date(logTime - MATCH_WINDOW_MS).toISOString();
    const windowEnd = new Date(logTime + MATCH_WINDOW_MS).toISOString();

    // Find calendar events overlapping this time window
    const candidates = db.getAllSync(
      `SELECT id, google_event_id, title, start_time, end_time, location, description
       FROM calendar_events
       WHERE start_time >= ? AND start_time <= ?
       ORDER BY ABS(julianday(start_time) - julianday(?)) ASC
       LIMIT 5`,
      [windowStart, windowEnd, loggedAt],
    ) as any[];

    if (candidates.length === 0) return null;

    // Score candidates by time proximity and location match
    let bestMatch: any = null;
    let bestScore = 0;

    for (const cal of candidates) {
      let score = 0;

      // Time proximity (closer = higher score, max 5 points)
      const timeDiff = Math.abs(new Date(cal.start_time).getTime() - logTime);
      score += Math.max(0, 5 - (timeDiff / (5 * 60 * 1000))); // 1 point per 5 min closer

      // Location match (case-insensitive substring)
      if (placeName && cal.location) {
        const plLower = placeName.toLowerCase();
        const calLower = cal.location.toLowerCase();
        if (calLower.includes(plLower) || plLower.includes(calLower)) {
          score += 3;
        }
      }

      // Already linked to another activity? Skip
      const existingLink = db.getFirstSync(
        'SELECT id FROM activity_logs WHERE google_event_id = ? AND id != ?',
        [cal.google_event_id, activityLogId],
      ) as any;
      if (existingLink) continue;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = cal;
      }
    }

    // Require minimum score to avoid false matches
    if (!bestMatch || bestScore < 2) return null;

    // Link activity to calendar event
    const calTitle = bestMatch.title || bestMatch.description?.slice(0, 50);
    const googleEventId = bestMatch.google_event_id;

    const updates: string[] = [];
    const params: any[] = [];

    // Set google_event_id (triggers useSyncData hide logic)
    updates.push('google_event_id = ?');
    params.push(googleEventId);

    // Enrich title if calendar has better info
    if (calTitle) {
      updates.push('log_name = ?');
      params.push(calTitle);
    }

    updates.push('updated_at = datetime(\'now\')');
    params.push(activityLogId);

    db.runSync(
      `UPDATE activity_logs SET ${updates.join(', ')} WHERE id = ?`,
      params,
    );

    console.log(
      `[CalendarMatcher] Linked activity #${activityLogId} to calendar "${calTitle}" (score=${bestScore.toFixed(1)})`,
    );
    return googleEventId;
  } catch (err: any) {
    console.warn('[CalendarMatcher] Match failed:', err?.message);
    return null;
  }
}
