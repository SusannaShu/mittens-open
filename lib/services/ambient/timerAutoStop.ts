/**
 * timerAutoStop.ts -- Automatically stops the focus timer when
 * pendant captures show the user is away from their screen.
 *
 * Called by sceneStreamManager when triage.signals.screenUse is false.
 * Includes a 30-minute cooldown to prevent re-triggering.
 */

// ─── State ───

let lastAwayStopAt = 0;
const AWAY_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// ─── Public API ───

/**
 * Check if the focus timer should be auto-stopped because the user
 * stepped away from the screen. Fire-and-forget (non-blocking).
 */
export function checkAwayFromScreen(): void {
  try {
    // Cooldown: don't re-trigger within 30 minutes
    if (Date.now() - lastAwayStopAt < AWAY_COOLDOWN_MS) return;

    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const STORAGE_KEY = 'mittens_focus_timer_end';

    // Check if timer is running (async but fire-and-forget)
    AsyncStorage.getItem(STORAGE_KEY).then(async (endStr: string | null) => {
      if (!endStr) return; // No timer running

      // Timer is running but user is away from screen -- stop it
      const { stopGlobalTimer } = require('../../../hooks/useFocusTimer');
      await stopGlobalTimer();
      lastAwayStopAt = Date.now();

      // TTS notification
      try {
        const { speak } = require('../voice/ttsService');
        speak('Screen time ended. Timer stopped. Good job taking a break!');
      } catch {}

      // Chat message
      const { saveMittensMessage } = require('../schedule/alarmScheduler');
      saveMittensMessage(
        'I noticed you stepped away from the screen. Timer stopped. Good break!',
        'focus_timer_auto_stop',
      );

      // Trigger UI update
      const { DeviceEventEmitter } = require('react-native');
      DeviceEventEmitter.emit('focusTimerUpdated');

      console.log('[timerAutoStop] Auto-stopped timer: away from screen');
    }).catch(() => {});
  } catch { /* non-blocking */ }
}
