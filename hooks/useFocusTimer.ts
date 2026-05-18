import { useState, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { saveMittensMessage } from '../lib/services/schedule/alarmScheduler';
import { ActivityTypeService } from '../lib/services/activityTypeService';
import { getDb, enqueueSyncRecord } from '../lib/database';

const STORAGE_KEY = 'mittens_focus_timer_end';
const CATEGORY_KEY = 'mittens_focus_timer_category';
const NAME_KEY = 'mittens_focus_timer_name';
const START_KEY = 'mittens_focus_timer_start';
const ENTRY_ID_KEY = 'mittens_focus_timer_entry_id';
const BREAK_COUNT_KEY = 'mittens_focus_timer_break_count';
export { STORAGE_KEY as FOCUS_TIMER_STORAGE_KEY };

export async function startGlobalTimer(category: string, name: string, breakIntervalMins: number = 45) {
  const nowMs = Date.now();
  const endMs = nowMs + breakIntervalMins * 60 * 1000;

  await AsyncStorage.setItem(STORAGE_KEY, endMs.toString());
  await AsyncStorage.setItem(CATEGORY_KEY, category);
  await AsyncStorage.setItem(NAME_KEY, name);
  await AsyncStorage.setItem(START_KEY, nowMs.toString());

  // Schedule break reminder notification
  await Notifications.scheduleNotificationAsync({
    identifier: 'focus-timer',
    content: {
      title: 'Mittens',
      subtitle: 'Time to stretch!',
      body: `You've been doing ${name} for ${breakIntervalMins} minutes. Take a breather!`,
      data: { type: 'focus_rest' },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: breakIntervalMins * 60,
      repeats: false,
    },
  });

  // Log activity immediately so it appears on the calendar
  const entryId = await logTimerActivity(category, name, breakIntervalMins, new Date(nowMs).toISOString());
  if (entryId) {
    await AsyncStorage.setItem(ENTRY_ID_KEY, entryId.toString());
  }

  const { DeviceEventEmitter } = require('react-native');
  DeviceEventEmitter.emit('focusTimerUpdated');
}

export async function stopGlobalTimer() {
  const startStr = await AsyncStorage.getItem(START_KEY);
  const idStr = await AsyncStorage.getItem(ENTRY_ID_KEY);
  if (startStr && idStr) {
    const startMs = parseInt(startStr, 10);
    const durationMin = Math.max(1, Math.round((Date.now() - startMs) / 60000));
    await updateTimerActivity(parseInt(idStr, 10), durationMin);
  }

  await AsyncStorage.removeItem(STORAGE_KEY);
  await AsyncStorage.removeItem(CATEGORY_KEY);
  await AsyncStorage.removeItem(NAME_KEY);
  await AsyncStorage.removeItem(START_KEY);
  await AsyncStorage.removeItem(ENTRY_ID_KEY);
  await AsyncStorage.removeItem(BREAK_COUNT_KEY);
  await Notifications.cancelScheduledNotificationAsync('focus-timer').catch(() => {});

  const { DeviceEventEmitter } = require('react-native');
  DeviceEventEmitter.emit('focusTimerUpdated');
}

/**
 * @deprecated Use dynamicCategories from useFocusTimer return value instead.
 * Kept for type compatibility.
 */
export const DEFAULT_CATEGORIES = [
  'Work', 'Journal', 'Reading', 'Drawing', 'Nature',
  'Meal Prep', 'Social', 'Exercise', 'Rest',
] as const;

export type TimerCategory = string;

interface FocusTimerOptions {
  onStart?: () => void;
  onComplete?: () => void;
}

export function useFocusTimer(breakIntervalMins: number = 45, options?: FocusTimerOptions) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [category, setCategory] = useState<TimerCategory>('work');
  const [activityName, setActivityName] = useState<string>('');
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [dynamicCategories, setDynamicCategories] = useState<{ key: string; label: string; icon: string }[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load activity types for timer on mount + app resume
  useEffect(() => {
    const load = async () => {
      try {
        const all = await ActivityTypeService.getAll();
        setDynamicCategories(
          all.filter(t => t.showInTimer).map(t => ({ key: t.key, label: t.label, icon: t.icon || 'circle' }))
        );
      } catch {}
    };
    load();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') load();
    });
    return () => sub.remove();
  }, []);

  const clearTimer = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    await stopGlobalTimer();
    setTimeLeft(null);
    setIsRunning(false);
    setStartedAt(null);
    options?.onComplete?.();
  };

  const startTimer = async (cat?: TimerCategory, name?: string) => {
    const selectedCat = cat || category;
    const selectedName = name || selectedCat;
    
    await startGlobalTimer(selectedCat, selectedName, breakIntervalMins);

    setCategory(selectedCat);
    setActivityName(selectedName);
    setIsRunning(true);
    checkTimer();

    options?.onStart?.();
  };

  const checkTimer = async () => {
    try {
      const endStr = await AsyncStorage.getItem(STORAGE_KEY);
      const catStr = await AsyncStorage.getItem(CATEGORY_KEY);
      const nameStr = await AsyncStorage.getItem(NAME_KEY);
      const startStr = await AsyncStorage.getItem(START_KEY);

      if (catStr) setCategory(catStr as TimerCategory);
      if (nameStr) setActivityName(nameStr);
      if (startStr) setStartedAt(new Date(parseInt(startStr, 10)).toISOString());

      if (endStr) {
        const endMs = parseInt(endStr, 10);
        const remaining = Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
        if (remaining > 0) {
          setTimeLeft(remaining);
          setIsRunning(true);
        } else {
          // Break reminder fired -- timer keeps running (user manually stops)
          setTimeLeft(0);
          setIsRunning(true);
          
          // Track how many break reminders have fired this session
          let breakCount = 1;
          try {
            const countStr = await AsyncStorage.getItem(BREAK_COUNT_KEY);
            breakCount = countStr ? parseInt(countStr, 10) + 1 : 1;
          } catch {}
          await AsyncStorage.setItem(BREAK_COUNT_KEY, breakCount.toString());

          // Get break goals (activities tagged with "Mention in Break")
          let breakGoals: string[] = [];
          try {
            const allTypes = await ActivityTypeService.getAll();
            breakGoals = allTypes
              .filter(t => t.mentionDuringBreak)
              .map(t => t.label);
          } catch {}

          // Build TTS message -- progressive nudging
          let ttsMsg: string;
          let chatMsg: string;
          const activity = nameStr || catStr || 'work';
          const goalsPhrase = breakGoals.length > 0
            ? breakGoals.join(' or ')
            : 'a stretch';

          if (breakCount === 1) {
            // First nudge: gentle reminder
            ttsMsg = `Susanna, time to take a break from ${activity}. How about some ${goalsPhrase}?`;
            chatMsg = `Time to stretch! You've been doing ${activity} for a while. How about some ${goalsPhrase}?`;
          } else if (breakCount === 2) {
            // Second nudge: more persuasive, use the brain if available
            ttsMsg = `Hey Susanna, still going? Your body will thank you for some ${goalsPhrase}. Come on, just a quick set!`;
            chatMsg = `Still at it? Come on, just a quick round of ${goalsPhrase}. Your future self will thank you!`;
          } else {
            // Third+ nudge: playful escalation
            ttsMsg = `Susanna! That's ${breakCount} reminders now. Seriously, go do some ${goalsPhrase}. I'm not going to stop asking.`;
            chatMsg = `Reminder #${breakCount}. I'm not going away until you do some ${goalsPhrase}. Your back is begging you.`;
          }

          // TTS fires independently -- never swallowed by goal lookup failures
          try {
            const { speak } = require('../lib/services/voice/ttsService');
            speak(ttsMsg);
          } catch (ttsErr) {
            console.warn('[timer] TTS failed:', ttsErr);
          }

          saveMittensMessage(chatMsg, 'focus_timer_break');
          
          // Schedule next break
          const nextEnd = Date.now() + breakIntervalMins * 60 * 1000;
          await AsyncStorage.setItem(STORAGE_KEY, nextEnd.toString());
          options?.onComplete?.();
        }
      } else {
        setIsRunning(false);
      }
    } catch {}
  };

  // Elapsed time since start (for display)
  const getElapsed = useCallback((): number => {
    if (!startedAt) return 0;
    return Math.round((Date.now() - new Date(startedAt).getTime()) / 1000);
  }, [startedAt]);

  useEffect(() => {
    checkTimer();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') checkTimer();
    });
    const { DeviceEventEmitter } = require('react-native');
    const eventSub = DeviceEventEmitter.addListener('focusTimerUpdated', checkTimer);
    
    // Listen for auto-start triggers from sedentary detection
    const autoSub = DeviceEventEmitter.addListener('autoStartTimer', async (evt: any) => {
      if (isRunning) return; // skip if already running
      await startGlobalTimer(evt.category, evt.name, evt.durationMin);
    });

    return () => {
      sub.remove();
      eventSub.remove();
      autoSub.remove();
    };
  }, [isRunning]);

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(checkTimer, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning]);

  return {
    isRunning, timeLeft, category, activityName, startedAt,
    startTimer, clearTimer, setCategory, setActivityName, getElapsed,
    dynamicCategories,
  };
}

/**
 * Log the timer activity to the local database.
 */
async function logTimerActivity(
  category: string,
  name: string,
  durationMin: number,
  loggedAt: string,
): Promise<number | null> {
  try {
    const activityKey = category;

    // Look up from ActivityTypeService for deterministic metadata
    const typeModel = await ActivityTypeService.getByKey(activityKey);
    const lifeCategories = typeModel?.defaultLifeCategories || { work: 1.0 };
    const isOutdoors = typeModel?.defaultOutdoors ?? (category === 'Nature');

    const db = getDb();
    const result = db.runSync(
      `INSERT INTO activity_logs (logged_at, activity_type, log_name, duration_min, outdoors, source, life_categories)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        loggedAt,
        activityKey,
        name,
        durationMin,
        isOutdoors ? 1 : 0,
        'manual',
        JSON.stringify(lifeCategories),
      ]
    );

    const id = result.lastInsertRowId;
    if (id) {
      enqueueSyncRecord('activity_logs', id as number, 'create');
      return id as number;
    }
  } catch (err) {
    console.warn('[timer] Failed to log activity:', err);
  }
  return null;
}

/**
 * Update actual duration when timer is stopped in local database
 */
async function updateTimerActivity(id: number, durationMin: number) {
  try {
    const db = getDb();
    db.runSync(
      `UPDATE activity_logs SET duration_min = ?, updated_at = datetime('now') WHERE id = ?`,
      [durationMin, id]
    );
    enqueueSyncRecord('activity_logs', id, 'update');
  } catch (err) {
    console.warn('[timer] Failed to update activity duration:', err);
  }
}
