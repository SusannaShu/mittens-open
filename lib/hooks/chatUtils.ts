/**
 * Chat utility helpers -- small pure functions used by chat handlers.
 */

/** Detect meal type from hour of day */
export function detectMealTypeFromHour(hr: number): string {
  if (hr < 5) return 'snack';
  if (hr < 11) return 'breakfast';
  if (hr < 15) return 'lunch';
  if (hr < 21) return 'dinner';
  return 'snack';
}

/** Build a human-readable date label relative to today (e.g. "from yesterday") */
export function buildDateLabel(photoTime: Date | null | undefined): string {
  if (!photoTime) return '';
  const now = new Date();
  const photoDate = new Date(photoTime);
  if (photoDate.toDateString() === now.toDateString()) return '';

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (photoDate.toDateString() === yesterday.toDateString()) {
    return ' from yesterday';
  }
  return ` from ${photoDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
