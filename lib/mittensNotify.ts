/**
 * Mittens Message Notifications -- local notification + badge counter.
 *
 * Fires a local push notification when Mittens sends a background message
 * (location inference, calendar updates, alarms, etc).
 * Also tracks unread count for the chat tab badge.
 */

import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

// ── Unread badge counter ──
let unreadCount = 0;
let badgeListeners: Array<(count: number) => void> = [];

/** Get current unread count. */
export function getUnreadCount(): number {
  return unreadCount;
}

/** Increment unread count and notify listeners. */
export function incrementUnread(): void {
  unreadCount++;
  Notifications.setBadgeCountAsync(unreadCount).catch(() => {});
  badgeListeners.forEach(fn => fn(unreadCount));
}

/** Clear unread count (e.g. when user opens chat tab). */
export function clearUnread(): void {
  unreadCount = 0;
  Notifications.setBadgeCountAsync(0).catch(() => {});
  badgeListeners.forEach(fn => fn(0));
}

/** Subscribe to unread count changes. Returns cleanup function. */
export function onUnreadChange(listener: (count: number) => void): () => void {
  badgeListeners.push(listener);
  return () => {
    badgeListeners = badgeListeners.filter(fn => fn !== listener);
  };
}

// ── Local notification for background Mittens messages ──

/**
 * Send a local notification for a Mittens message.
 * Only fires if app is backgrounded or inactive (not when user is actively in app).
 */
export async function notifyMittensMessage(
  text: string,
  options?: { subtitle?: string; data?: Record<string, unknown> }
): Promise<void> {
  // Always increment badge
  incrementUnread();

  // Only show notification banner if app is NOT active in foreground
  const appState = AppState.currentState;
  if (appState === 'active') return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Mittens',
        subtitle: options?.subtitle,
        body: text.length > 120 ? text.slice(0, 117) + '...' : text,
        sound: 'default',
        badge: unreadCount,
        data: { type: 'mittens_message', ...(options?.data || {}) },
      },
      trigger: null, // Immediate
    });
  } catch {
    // Notification scheduling is best-effort
  }
}
