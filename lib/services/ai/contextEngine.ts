/**
 * Context Engine -- fuses location + calendar + motion to understand
 * what the user is doing and what they need.
 *
 * Runs on location change and periodic intervals.
 * Powers departure alarms, context questions, and morning briefings.
 */

import { getCurrentLocation, getCurrentPlace, isLocationFresh, getLastMotionType } from '../location/locationService';
import { getTravelTime, isVirtualLocation } from '../location/travelTime';
import { localReverseGeocode } from '../location/placeInference';
import { CalendarEvent } from '../calendarEventApi';

export interface UserContext {
  currentPlace: string | null;
  currentLocation: { lat: number; lon: number } | null;
  currentActivity: string | null;
  motionType: string | null;
  reverseGeocodedAddress: string | null;
  neighborhood: string | null;
  nextEvent: CalendarEvent | null;
  travelMinutes: number | null;
  minutesUntilEvent: number | null;
  minutesUntilLeave: number | null;
  needsDepartureAlarm: boolean;
  isAtHome: boolean;
  isLocationKnown: boolean;
  suggestion: string | null;
}

// Place type -> inferred activity mapping
const PLACE_ACTIVITY_MAP: Record<string, string> = {
  home: 'At home',
  work: 'Working',
  school: 'At school',
  gym: 'Working out',
  social: 'Social',
  park: 'Outside',
};

/**
 * Compute the user's current context from all available signals.
 *
 * @param todayEvents - today's synced calendar events
 * @param homePlaceName - name of the home geofence (to detect isAtHome)
 * @param travelMode - user's preferred travel mode
 * @param mapsApiKey - Google Maps API key (optional)
 */
export async function computeContext(
  todayEvents: CalendarEvent[],
  homePlaceName: string = 'Home',
  travelMode: string = 'transit',
  mapsApiKey?: string
): Promise<UserContext> {
  const place = getCurrentPlace();
  const location = getCurrentLocation();
  const now = new Date();

  const ctx: UserContext = {
    currentPlace: place,
    currentLocation: location,
    currentActivity: null,
    motionType: getLastMotionType(),
    reverseGeocodedAddress: null,
    neighborhood: null,
    nextEvent: null,
    travelMinutes: null,
    minutesUntilEvent: null,
    minutesUntilLeave: null,
    needsDepartureAlarm: false,
    isAtHome: place === homePlaceName,
    isLocationKnown: place != null || isLocationFresh(),
    suggestion: null,
  };

  // Reverse geocode if at unknown location (free via expo-location)
  if (!place && location) {
    try {
      const geo = await localReverseGeocode(location.lat, location.lon);
      if (geo) {
        ctx.reverseGeocodedAddress = geo.address;
        ctx.neighborhood = geo.neighborhood;
      }
    } catch { /* geocoding is nice-to-have */ }
  }

  // Infer activity from place
  if (place) {
    // Check if a calendar event matches current time + place
    const currentEvent = todayEvents.find((e) => {
      const start = new Date(e.startTime).getTime();
      const end = e.endTime ? new Date(e.endTime).getTime() : start + 60 * 60 * 1000;
      return now.getTime() >= start && now.getTime() <= end;
    });

    if (currentEvent) {
      ctx.currentActivity = currentEvent.summary;
    } else {
      ctx.currentActivity = PLACE_ACTIVITY_MAP[place.toLowerCase()] || `At ${place}`;
    }
  }

  // Find next upcoming event
  const upcomingEvents = todayEvents.filter((e) => {
    const start = new Date(e.startTime).getTime();
    return start > now.getTime();
  });

  if (upcomingEvents.length > 0) {
    ctx.nextEvent = upcomingEvents[0];
    const startTime = new Date(ctx.nextEvent.startTime).getTime();
    ctx.minutesUntilEvent = Math.round((startTime - now.getTime()) / 60000);

    // Compute travel time if event has a location and is not virtual
    if (ctx.nextEvent.location && !isVirtualLocation(ctx.nextEvent.location) && location) {
      try {
        const estimate = await getTravelTime(
          location,
          ctx.nextEvent.location,
          travelMode,
          mapsApiKey
        );
        ctx.travelMinutes = estimate.withBuffer;
        ctx.minutesUntilLeave = ctx.minutesUntilEvent - estimate.withBuffer;
        ctx.needsDepartureAlarm = ctx.minutesUntilLeave != null && ctx.minutesUntilLeave <= 30;
      } catch (err) {
        console.warn('[context] Travel time computation failed:', err);
      }
    } else if (ctx.nextEvent.isVirtual || isVirtualLocation(ctx.nextEvent.location)) {
      // Virtual meeting -- just remind 5 min before
      ctx.travelMinutes = 0;
      ctx.minutesUntilLeave = ctx.minutesUntilEvent - 5;
      ctx.needsDepartureAlarm = ctx.minutesUntilLeave != null && ctx.minutesUntilLeave <= 10;
    }

    // Generate suggestion
    if (ctx.minutesUntilLeave != null) {
      if (ctx.minutesUntilLeave <= 0) {
        ctx.suggestion = `Leave now for ${ctx.nextEvent.summary}! You're ${Math.abs(ctx.minutesUntilLeave)} min late.`;
      } else if (ctx.minutesUntilLeave <= 5) {
        ctx.suggestion = `Time to go! ${ctx.nextEvent.summary} starts in ${ctx.minutesUntilEvent} min. Travel: ~${ctx.travelMinutes} min.`;
      } else if (ctx.minutesUntilLeave <= 15) {
        ctx.suggestion = `Leave in ${ctx.minutesUntilLeave} min for ${ctx.nextEvent.summary}.`;
      } else if (ctx.minutesUntilLeave <= 30) {
        ctx.suggestion = `Heads up: ${ctx.nextEvent.summary} in ${ctx.minutesUntilEvent} min. Leave in ~${ctx.minutesUntilLeave} min.`;
      }
    }
  }

  return ctx;
}

// Per-place ask cooldown: at most once per 2 hours at the same place
const lastAskedByPlace: Map<string, number> = new Map();
const ASK_COOLDOWN_MS = 2 * 60 * 60 * 1000;

/**
 * Generate a context question for Mittens to ask the user.
 * Returns null if context is clear (calendar match) or recently asked.
 */
export function getContextQuestion(ctx: UserContext): string | null {
  // Don't ask if we know what they're doing from calendar
  if (ctx.currentActivity && ctx.nextEvent) return null;

  // Don't ask during quiet hours (11pm - 7am)
  const hour = new Date().getHours();
  if (hour >= 23 || hour < 7) return null;

  // Cooldown check: don't re-ask about the same place within 2 hours
  const placeKey = ctx.currentPlace || ctx.reverseGeocodedAddress || 'unknown';
  const lastAsked = lastAskedByPlace.get(placeKey);
  if (lastAsked && Date.now() - lastAsked < ASK_COOLDOWN_MS) return null;

  let question: string | null = null;

  if (ctx.isAtHome) {
    // At home -- ask softly
    question = "You're home. What are you up to?";
  } else if (!ctx.isLocationKnown) {
    // Unknown location
    question = "Hey! I lost track of where you are. What are you up to?";
  } else if (ctx.currentPlace) {
    // At a known place but no calendar match
    question = `You're at ${ctx.currentPlace}. What are you up to?`;
  } else if (ctx.currentLocation && !ctx.currentPlace) {
    // Known location but not a saved place
    const addressHint = ctx.reverseGeocodedAddress
      ? ` You're near ${ctx.reverseGeocodedAddress}.`
      : '';
    const motionHint = ctx.motionType && ctx.motionType !== 'stationary'
      ? ` Looks like you might be ${ctx.motionType}.`
      : '';
    question = `You seem to be somewhere new.${addressHint}${motionHint} What are you doing?`;
  }

  if (question) {
    lastAskedByPlace.set(placeKey, Date.now());
  }

  return question;
}

/**
 * Build a context string for injecting into Gemini prompts.
 * Gives the AI awareness of where the user is and what's coming up.
 */
export function buildContextPrompt(ctx: UserContext): string {
  const parts: string[] = [];

  if (ctx.currentPlace) {
    parts.push(`User is currently at ${ctx.currentPlace}.`);
  } else if (ctx.reverseGeocodedAddress) {
    parts.push(`User is near ${ctx.reverseGeocodedAddress}${ctx.neighborhood ? ` in ${ctx.neighborhood}` : ''}.`);
  } else if (ctx.currentLocation) {
    parts.push(`User location: ${ctx.currentLocation.lat.toFixed(4)}, ${ctx.currentLocation.lon.toFixed(4)}.`);
  }

  if (ctx.motionType && ctx.motionType !== 'stationary') {
    parts.push(`Motion: ${ctx.motionType}.`);
  }

  if (ctx.currentActivity) {
    parts.push(`Current activity: ${ctx.currentActivity}.`);
  }

  if (ctx.nextEvent) {
    const timeStr = new Date(ctx.nextEvent.startTime).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    parts.push(`Next event: "${ctx.nextEvent.summary}" at ${timeStr}`);
    if (ctx.minutesUntilLeave != null && ctx.minutesUntilLeave <= 30) {
      parts.push(`(needs to leave in ${ctx.minutesUntilLeave} min)`);
    }
    if (ctx.nextEvent.location) {
      parts.push(`Location: ${ctx.nextEvent.location}`);
    }
  }

  return parts.join(' ');
}
