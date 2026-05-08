/**
 * Alarm Scheduler -- schedules local notifications + Mittens chat messages
 * for departure alarms, bedtime wind-down, and morning briefings.
 *
 * Uses expo-notifications for OS-level scheduling (fires even when app is killed).
 * All alerts also saved as Mittens chat messages via the API.
 */

import * as Notifications from 'expo-notifications';
import { CalendarEvent } from '../calendarEventApi';
import { getApiBase, getAuthToken } from '../../api';
import { notifyMittensMessage } from '../../mittensNotify';
import { materializeSchedule } from './scheduleComputer';
import { scheduleLightPrompt } from './lightExposurePrompt';

// ──────────────────────────────────────────
// Notification IDs for tracking/cancellation
// ──────────────────────────────────────────
interface ScheduledAlarmPayload {
  ids: string[];
  destLat?: number;
  destLon?: number;
  originalDist?: number;
}
const scheduledAlarms: Map<string, ScheduledAlarmPayload> = new Map(); // eventId -> payload

// ──────────────────────────────────────────
// Morning Wakeup
// ──────────────────────────────────────────

/**
 * Schedule a local notification at wakeup time to trigger sleep check-in.
 */
export async function scheduleMorningWakeup(wakeupTime: Date): Promise<void> {
  // Cancel any existing morning wakeup
  await Notifications.cancelScheduledNotificationAsync('morning-wakeup').catch(() => {});

  const now = new Date();
  const secondsUntil = Math.max(0, (wakeupTime.getTime() - now.getTime()) / 1000);

  if (secondsUntil <= 0) return; // wakeup already passed today

  await Notifications.scheduleNotificationAsync({
    identifier: 'morning-wakeup',
    content: {
      title: 'Good morning',
      body: 'How did you sleep last night?',
      data: { type: 'morning_wakeup' },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.round(secondsUntil),
      repeats: false,
    },
  });

  console.log(`[alarm] Morning wakeup scheduled for ${wakeupTime.toLocaleTimeString()}`);
}

/**
 * Generate and save a morning wakeup as a Mittens chat message.
 * Called when the morning notification fires or on app open early in the day.
 */
export async function generateMorningWakeup(): Promise<void> {
  const briefingText = "Good morning! How did you sleep last night?";
  
  // Extra metadata holder (e.g. for action buttons)
  let extraMetadata: any = undefined;

  // Save as a Mittens chat message
  await saveMittensMessage(briefingText, 'morning_wakeup', extraMetadata);
}

// ──────────────────────────────────────────
// Departure Alarms
// ──────────────────────────────────────────

/**
 * Schedule departure alarm notifications for an event.
 * Escalation: T-15min gentle, T-5min urgent, T-0 alarm.
 */
export async function scheduleDepartureAlarm(
  event: CalendarEvent,
  travelMinutes: number,
  destLat?: number,
  destLon?: number,
  originalDist?: number
): Promise<void> {
  const eventStart = new Date(event.startTime).getTime();
  const departureTime = eventStart - travelMinutes * 60 * 1000;
  const now = Date.now();

  // Cancel existing alarms for this event
  await cancelEventAlarms(event.googleEventId);

  const ids: string[] = [];

  // T-15 min: gentle heads-up
  const t15 = departureTime - 15 * 60 * 1000;
  if (t15 > now) {
    const id = await scheduleNotif(
      `departure-${event.googleEventId}-15`,
      'Heads up',
      `Leave in ~15 min for ${event.summary}. Travel: ~${travelMinutes} min.`,
      Math.round((t15 - now) / 1000),
      { type: 'departure', eventId: event.googleEventId, urgency: 'gentle' }
    );
    if (id) ids.push(id);
  }

  // T-5 min: urgent reminder
  const t5 = departureTime - 5 * 60 * 1000;
  if (t5 > now) {
    const id = await scheduleNotif(
      `departure-${event.googleEventId}-5`,
      'Time to leave',
      `Leave now for ${event.summary}! ~${travelMinutes} min travel time.`,
      Math.round((t5 - now) / 1000),
      { type: 'departure', eventId: event.googleEventId, urgency: 'urgent' }
    );
    if (id) ids.push(id);
  }

  // T-0: you're late
  if (departureTime > now) {
    const id = await scheduleNotif(
      `departure-${event.googleEventId}-0`,
      'Leave NOW',
      `You should already be heading to ${event.summary}!`,
      Math.round((departureTime - now) / 1000),
      { type: 'departure', eventId: event.googleEventId, urgency: 'alarm' }
    );
    if (id) ids.push(id);

    // Also save as chat message at departure time
    const departureMsg = `Time to head out for ${event.summary}! It's about ${travelMinutes} min away.`;
    setTimeout(() => {
      saveMittensMessage(departureMsg, 'departure_alarm');
    }, departureTime - now);
  }

  scheduledAlarms.set(event.googleEventId, { ids, destLat, destLon, originalDist });
  console.log(`[alarm] Departure alarms scheduled for "${event.summary}" (${ids.length} notifications)`);
}

/**
 * Cancel all alarms for an event (e.g. user arrived via geofence).
 */
export async function cancelEventAlarms(eventId: string): Promise<void> {
  const payload = scheduledAlarms.get(eventId);
  const ids = payload ? payload.ids : [];
  for (const id of ids) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  }
  scheduledAlarms.delete(eventId);
}

/**
 * Dynamically recalculate alarms using real-time travel times and cached coordinates.
 * This ensures alarms shift as the user moves closer/further from the destination.
 */
export async function dynamicallyUpdateAlarms(
  currentLocation: { lat: number; lon: number },
  motionType: string | null
): Promise<void> {
  if (scheduledAlarms.size === 0) return; // No pending alarms

  const token = getAuthToken();
  if (!token) return;

  try {
    const res = await fetch(
      `${getApiBase()}/calendar-events/today?tz=${new Date().getTimezoneOffset()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return;
    const { events } = await res.json();
    
    // Only process if we actually have upcoming events in the next 3 hours
    const now = Date.now();
    const hasUpcoming = events.some((e: CalendarEvent) => {
       const t = new Date(e.startTime).getTime();
       return t > now && t - now < 3 * 60 * 60 * 1000;
    });
    if (!hasUpcoming) return;

    const pRes = await fetch(`${getApiBase()}/nutrition-profile`, { headers: { Authorization: `Bearer ${token}` } });
    let travelMode = 'transit';
    if (pRes.ok) {
       const profile = await pRes.json();
       travelMode = profile.travelMode || 'transit';
    }

    await refreshAllAlarms(events, currentLocation, travelMode);
  } catch (err) {
    console.warn('[alarm] Failed to dynamically update alarms', err);
  }
}

// ──────────────────────────────────────────
// Bedtime / Wind-Down
// ──────────────────────────────────────────

/**
 * Clear planned schedule blocks for a given date.
 */
export async function clearScheduledRhythms(dateString: string): Promise<void> {
  try {
    const token = getAuthToken();
    if (!token) return;
    await fetch(`${getApiBase()}/planned-schedules/clear?date=${dateString}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.warn('[alarm] Failed to clear planned schedule', err);
  }
}

/**
 * Ensure planned schedule blocks exist for a date.
 * Uses the dedicated /planned-schedules/sync endpoint (NOT activity-log).
 */
export async function ensureRhythmsForDate(profile: any, dateString: string, existingBlocks: any[] = []): Promise<boolean> {
  if (!profile?.homeLongitude || profile.scheduleEnabled === false) return false;

  // If blocks already exist for this date, skip
  if (existingBlocks.length > 0) return false;

  const targetDate = new Date(dateString + 'T12:00:00');
  const schedule = materializeSchedule(profile, targetDate);

  const blocks = [
    { blockType: 'wake',      scheduledAt: schedule.wakeUtc.toISOString() },
    { blockType: 'breakfast',  scheduledAt: schedule.breakfastUtc.toISOString() },
    { blockType: 'lunch',      scheduledAt: schedule.lunchUtc.toISOString() },
    { blockType: 'dinner',     scheduledAt: schedule.dinnerUtc.toISOString() },
    { blockType: 'bedtime',    scheduledAt: schedule.bedtimeUtc.toISOString() },
  ];

  try {
    const token = getAuthToken();
    if (!token) return false;

    // Check if blocks already exist on the server
    const res = await fetch(`${getApiBase()}/planned-schedules/daily?date=${dateString}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.blocks && data.blocks.length > 0) return false;
    }

    // Sync fresh blocks
    const syncRes = await fetch(`${getApiBase()}/planned-schedules/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ date: dateString, blocks }),
    });

    return syncRes.ok;
  } catch (err) {
    console.warn('[alarm] Failed to ensure planned schedule', err);
    return false;
  }
}


/**
 * Handle Bedtime Rhythms & Head-Home Travel
 * Creates editable Reflect calendar blocks and departure alarms for heading home.
 */
export async function scheduleBedtimeAlarms(
  sleepHours: number,
  homeLocation: { lat: number; lon: number },
  currentLocation?: { lat: number; lon: number } | null,
  travelMode?: string,
  mapsApiKey?: string,
  profile?: any
): Promise<void> {
  // Cancel old generic bedtime spam, replaced by proper Mittens notifications + Reflect blocks
  await Notifications.cancelScheduledNotificationAsync('bedtime-winddown').catch(() => {});
  await Notifications.cancelScheduledNotificationAsync('bedtime-now').catch(() => {});

  if (!profile?.homeLongitude) return; // LMST requires location

  if (profile.scheduleEnabled === false) {
    // Schedule disabled -- fallback to plain sunrise for morning wakeup
    const tomorrowSunrise = await fetchSunrise(homeLocation.lat, homeLocation.lon, 1);
    if (tomorrowSunrise) await scheduleMorningWakeup(tomorrowSunrise);
    return;
  }

  const now = new Date();
  const schedule = materializeSchedule(profile, now);

  await ensureRhythmsForDate(profile, new Date().toLocaleDateString('en-CA'));

  const bedtime = schedule.bedtimeUtc;
  const wakeTime = schedule.wakeUtc;

  // New Morning Light Prompt
  await scheduleLightPrompt(profile, wakeTime);

  // Head Home for Bed Travel Alarm
  if (currentLocation && homeLocation) {
    const { getTravelTime, haversineDistanceMiles } = require('../location/travelTime');
    const dist = haversineDistanceMiles(currentLocation.lat, currentLocation.lon, homeLocation.lat, homeLocation.lon);
    
    // Check if we are physically away from home (> 0.1 miles)
    if (dist > 0.1) {
      try {
        const estimate = await getTravelTime(currentLocation, homeLocation, travelMode || 'transit', mapsApiKey);
        const bedtimeStr = bedtime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        
        // Mock an event to utilize existing departure alarm escalation logic
        const bedtimeEvent: CalendarEvent = {
          googleEventId: 'bedtime-trip-home',
          summary: 'Head Home for Bed',
          location: 'Home',
          startTime: bedtime.toISOString(),
          endTime: new Date(bedtime.getTime() + 60*60*1000).toISOString(),
          description: `Bedtime is at ${bedtimeStr}`,
          calendarId: 'mittens-internal',
          date: bedtime.toISOString().split('T')[0],
          isVirtual: false,
          user: null
        };
        
        // Include 30 minute wind-down buffer for heading home
        await scheduleDepartureAlarm(bedtimeEvent, estimate.withBuffer + 30, homeLocation.lat, homeLocation.lon, estimate.distanceMiles);
        console.log(`[alarm] Going home for bed: ~${estimate.durationMin}min driving, leaving in ${Math.round((bedtime.getTime() - estimate.withBuffer*60000 - 30*60000 - now.getTime())/60000)}m`);
      } catch (err) {
        console.warn('[alarm] Failed to schedule bedtime trip', err);
      }
    } else {
      // Clean up past departure alarms if already home
      await cancelEventAlarms('bedtime-trip-home');
    }
  }

  // Nightly check-in generation
  const checkinTime = new Date(bedtime.getTime() - 60 * 60 * 1000);
  if (checkinTime > now) {
    await scheduleNotif(
      'nightly-checkin',
      'Evening check-in',
      'Time to reflect on your day. How did it go?',
      Math.round((checkinTime.getTime() - now.getTime()) / 1000),
      { type: 'nightly_checkin' }
    );

    const checkinDelay = checkinTime.getTime() - now.getTime();
    setTimeout(async () => {
      try {
        const token = getAuthToken();
        if (!token) return;
        await fetch(`${getApiBase()}/nutrition-log/nightly-checkin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        });
      } catch (err) {}
    }, checkinDelay);
  }

  // Proper Mittens notification before bed (30 mins wind-down)
  const windDownTime = new Date(bedtime.getTime() - 30 * 60 * 1000);
  if (windDownTime > now) {
    await scheduleNotif(
      'bedtime-winddown',
      'Mittens',
      'Time to wind down for bed. Try putting away screens soon.',
      Math.round((windDownTime.getTime() - now.getTime()) / 1000),
      { type: 'bedtime_reminder' }
    );

    const windDownDelay = windDownTime.getTime() - now.getTime();
    setTimeout(() => {
      saveMittensMessage('Time to start winding down for bed. Try putting away screens soon.', 'bedtime_reminder');
    }, windDownDelay);
  }

  await scheduleMorningWakeup(wakeTime);
}

/**
 * Reschedule all departure alarms based on current context.
 * Call after location changes or calendar sync.
 */
export async function refreshAllAlarms(
  events: CalendarEvent[],
  currentLocation: { lat: number; lon: number } | null,
  travelMode: string,
  mapsApiKey?: string
): Promise<void> {
  // Import here to avoid circular dependency
  const { getTravelTime, isVirtualLocation } = require('../location/travelTime');

  const now = new Date();
  for (const evt of events) {
    const start = new Date(evt.startTime);
    if (start <= now) continue; // past events

    let targetLocation = evt.location;
    
    // Past-event location lookup if upcoming event has no location
    if (!targetLocation && !evt.isVirtual) {
      try {
        const token = getAuthToken();
        if (token) {
          const res = await fetch(`${getApiBase()}/calendar-events?summary_eq=${encodeURIComponent(evt.summary)}&location_null=false&_limit=1&_sort=startTime:DESC`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const past = await res.json();
            if (past && past.length > 0 && past[0].location) {
              targetLocation = past[0].location;
              console.log(`[alarm] Inferred "${evt.summary}" location as ${targetLocation} from past events`);
            }
          }
        }
      } catch (err) {
        console.warn(`[alarm] Failed to lookup past location for ${evt.summary}`, err);
      }
    }

    if (evt.isVirtual || isVirtualLocation(targetLocation)) {
      // Virtual: 5 min reminder
      await scheduleDepartureAlarm(evt, 5);
    } else if (targetLocation && currentLocation) {
      try {
        // Optimization: if we already geocoded this event, reuse the coordinates to avoid API spam!
        const payload = scheduledAlarms.get(evt.googleEventId);
        let targetArg: any = targetLocation;
        if (payload && payload.destLat && payload.destLon) {
          targetArg = { lat: payload.destLat, lon: payload.destLon };
        }

        const estimate = await getTravelTime(currentLocation, targetArg, travelMode, mapsApiKey);
        
        // If we are already virtually at the destination (<0.15 miles), suppress the alarm
        if (estimate.distanceMiles < 0.15) {
          await cancelEventAlarms(evt.googleEventId);
          console.log(`[alarm] Suppressed departure alarm for "${evt.summary}" because user is already at destination.`);
        } else {
          await scheduleDepartureAlarm(evt, estimate.withBuffer, estimate.destCoords?.lat, estimate.destCoords?.lon, estimate.distanceMiles);
        }
      } catch {
        // Use default 30 min if travel compute fails
        await scheduleDepartureAlarm(evt, 30);
      }
    }
  }
}

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

async function scheduleNotif(
  identifier: string,
  title: string,
  body: string,
  seconds: number,
  data: Record<string, string>
): Promise<string | null> {
  if (seconds <= 0) return null;

  try {
    return await Notifications.scheduleNotificationAsync({
      identifier,
      content: { 
        title, 
        body, 
        data, 
        sound: 'default',
        interruptionLevel: 'timeSensitive'
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
      },
    });
  } catch (err) {
    console.warn('[alarm] Failed to schedule notification:', err);
    return null;
  }
}

export async function saveMittensMessage(text: string, activityType: string, extraMetadata?: any): Promise<void> {
  try {
    const token = getAuthToken();
    if (!token) return;
    await fetch(`${getApiBase()}/mittens-messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        role: 'mittens',
        text,
        activityType,
        metadata: { automated: true, timestamp: new Date().toISOString(), ...(extraMetadata || {}) },
      }),
    });

    // Fire local notification + badge
    await notifyMittensMessage(text, {
      subtitle: activityType === 'morning_wakeup' ? 'Good Morning' :
                activityType === 'departure_alarm' ? 'Departure' :
                activityType === 'bedtime_reminder' ? 'Bedtime' :
                activityType === 'focus_timer_end' ? 'Focus Complete' : undefined,
    });
  } catch (err) {
    console.warn('[alarm] Failed to save Mittens message:', err);
  }
}

/**
 * Fetch sunrise time from sunrise-sunset.org API.
 * Uses offsetDays (0 = today, 1 = tomorrow).
 */
export async function fetchSolarTimes(lat: number, lon: number, offsetDays: number = 0): Promise<{ sunrise: Date; sunset: Date } | null> {
  try {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + offsetDays);
    const dateStr = targetDate.toISOString().split('T')[0];

    const res = await fetch(
      `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&date=${dateStr}&formatted=0`
    );
    const data = await res.json();
    if (data.status !== 'OK') return null;

    return {
      sunrise: new Date(data.results.sunrise),
      sunset: new Date(data.results.sunset),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch sunrise time from sunrise-sunset.org API.
 * Uses offsetDays (0 = today, 1 = tomorrow).
 */
export async function fetchSunrise(lat: number, lon: number, offsetDays: number = 1): Promise<Date | null> {
  const times = await fetchSolarTimes(lat, lon, offsetDays);
  return times?.sunrise || null;
}

/**
 * Fetch current weather from Open-Meteo API (free, no key).
 */
export async function fetchWeather(
  lat: number, lon: number
): Promise<{ temp: number; description: string; uv: number } | null> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code&daily=uv_index_max` +
      `&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`
    );
    const data = await res.json();

    const weatherCodes: Record<number, string> = {
      0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
      45: 'Foggy', 48: 'Depositing fog', 51: 'Light drizzle', 53: 'Moderate drizzle',
      61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
      71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
      80: 'Slight rain showers', 81: 'Moderate rain showers', 95: 'Thunderstorm',
    };

    return {
      temp: Math.round(data.current.temperature_2m),
      description: weatherCodes[data.current.weather_code] || 'Unknown',
      uv: Math.round(data.daily.uv_index_max[0] || 0),
    };
  } catch {
    return null;
  }
}
