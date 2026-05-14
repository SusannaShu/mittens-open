import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  useGetDailyActivitiesQuery,
  useGetWeeklyActivitiesQuery,
  ActivityEntry,
} from '../lib/services/activityApi';
import { useGetDailySummaryQuery } from '../lib/services/nutritionApi';
import { useGetCalendarEventsQuery, CalendarEvent as SyncedCalendarEvent } from '../lib/services/calendarEventApi';
import { useGetSleepLogsQuery, SleepEntry } from '../lib/services/schedule/sleepApi';
import { useGetProfileQuery } from '../lib/services/profileApi';
import { useGetPlannedScheduleQuery, PlannedBlock } from '../lib/services/schedule/plannedScheduleApi';
import { ensureRhythmsForDate, fetchSolarTimes } from '../lib/services/schedule/alarmScheduler';
import { Meal } from '../lib/types';
import { CalendarEvent } from '../components/reflect/CalendarDayView';
import { useGetLocationSessionsQuery, LocationSession } from '../lib/services/location/locationSessionApi';
import { useGetKnownPlacesQuery } from '../lib/services/location/knownPlaceApi';
import { generateLocationBlockTitle, getChildActivitiesForSession } from '../lib/services/location/locationBlockTitle';

export type ViewMode = 'day' | 'week' | 'month';

const MEAL_ICONS: Record<string, string> = {
  breakfast: 'sunrise', lunch: 'sun', dinner: 'sunset', snack: 'coffee', drink: 'droplet',
};

export function getMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const dayOfWeek = d.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setDate(d.getDate() + mondayOffset);
  return d.toLocaleDateString('en-CA');
}

export function useSyncData(selectedDate: string, viewMode: ViewMode) {
  // Activity queries
  const { data: dailyData, isFetching: dayFetching, refetch: dayRefetch } = useGetDailyActivitiesQuery(selectedDate);
  const weekStart = useMemo(() => getMonday(selectedDate), [selectedDate]);
  const { data: weekData, isFetching: weekFetching, refetch: weekRefetch } = useGetWeeklyActivitiesQuery(
    viewMode === 'week' ? weekStart : undefined,
    { skip: viewMode !== 'week' }
  );

  // Meal query
  const tzOffset = new Date().getTimezoneOffset();
  const { data: mealData, refetch: mealRefetch } = useGetDailySummaryQuery(
    `${selectedDate}&tz=${tzOffset}`,
    { skip: viewMode !== 'day' }
  );

  // Synced Google Calendar events
  const weekEndDate = useMemo(() => {
    const d = new Date(weekStart + 'T12:00:00');
    d.setDate(d.getDate() + 6);
    return d.toLocaleDateString('en-CA');
  }, [weekStart]);

  const { data: calData, refetch: calRefetch } = useGetCalendarEventsQuery(
    viewMode === 'week'
      ? { startTime_gte: weekStart + 'T00:00:00', startTime_lte: weekEndDate + 'T23:59:59' }
      : { date: selectedDate }
  );

  // Sleep logs
  const { data: sleepLogs, refetch: sleepRefetch } = useGetSleepLogsQuery(
    viewMode === 'week'
      ? { sleepStart_gte: weekStart + 'T00:00:00', sleepEnd_lte: weekEndDate + 'T23:59:59', limit: 30 }
      : undefined
  );

  const activities = dailyData?.activities || [];
  const meals: Meal[] = (mealData?.meals || []).filter((m: Meal) => m.entryType !== 'activity');
  const isFetching = viewMode === 'week' ? weekFetching : dayFetching;

  const { data: profile } = useGetProfileQuery();

  // Planned schedule blocks (separate from activity logs)
  const { data: plannedData, refetch: plannedRefetch } = useGetPlannedScheduleQuery(
    selectedDate,
    { skip: viewMode !== 'day' }
  );
  const plannedBlocks = plannedData?.blocks || [];

  // Solar times
  const [solarTimes, setSolarTimes] = useState<{ sunrise: Date; sunset: Date } | null>(null);

  // Location sessions
  const { data: locationSessions, refetch: locationRefetch } = useGetLocationSessionsQuery(
    selectedDate,
    { skip: viewMode !== 'day', pollingInterval: 10000 }
  );
  const { data: knownPlaces = [] } = useGetKnownPlacesQuery();

  const refetch = useCallback(() => {
    if (viewMode === 'week') weekRefetch();
    else { dayRefetch(); mealRefetch(); calRefetch(); sleepRefetch(); plannedRefetch(); locationRefetch(); }
  }, [viewMode, dayRefetch, weekRefetch, mealRefetch, calRefetch, sleepRefetch, plannedRefetch, locationRefetch]);

  // Ensure LMST rhythms exist for the selected day
  useEffect(() => {
    if (viewMode === 'day' && profile && !dayFetching) {
      if (plannedBlocks.length === 0 && profile.scheduleEnabled !== false && profile.homeLongitude != null) {
        ensureRhythmsForDate(profile, selectedDate, plannedBlocks).then(created => {
          if (created) plannedRefetch();
        });
      }
      if (profile.homeLatitude && profile.homeLongitude) {
        fetchSolarTimes(profile.homeLatitude, profile.homeLongitude, 0).then(times => {
          if (times) setSolarTimes(times);
        });
      }
    }
  }, [viewMode, profile, dayFetching, selectedDate, plannedBlocks.length]);

  // Build unified CalendarEvents
  const calendarEvents: CalendarEvent[] = useMemo(() => {
    const actEvents: CalendarEvent[] = activities
      .filter((act: ActivityEntry) => act.source !== 'pendant' && act.source !== 'trail')
      .map((act: ActivityEntry) => ({
      id: act.id,
      loggedAt: act.loggedAt,
      title: act.logName,
      duration_min: act.duration_min || 30,
      icon: act.activityType === 'sun' ? 'sun'
        : act.activityType === 'walk' ? 'map-pin'
        : act.activityType === 'work' ? 'monitor'
        : act.activityType === 'social' ? 'users'
        : act.activityType === 'workout' ? 'zap'
        : act.activityType === 'bike' ? 'navigation'
        : act.activityType === 'run' ? 'trending-up'
        : act.activityType === 'rest' ? 'moon'
        : act.activityType === 'cooking' ? 'coffee'
        : act.activityType === 'commute' ? 'truck'
        : 'circle',
      location: act.location as string | null,
      type: 'activity',
      sourceData: act,
    }));

    const mealEvents: CalendarEvent[] = meals
      .filter((m: Meal) => (m as any).source !== 'pendant')
      .map((m: Meal) => ({
      id: m.id as number,
      loggedAt: m.loggedAt as string,
      title: m.logName || `${m.mealType || 'Meal'}`,
      duration_min: (m as any).duration_min || 20,
      icon: MEAL_ICONS[m.mealType || ''] || 'circle',
      location: null,
      type: 'meal',
      sourceData: m,
    }));

    const linkedGoogleIds = new Set(
      activities.filter((a: ActivityEntry) => a.googleEventId).map((a: ActivityEntry) => a.googleEventId!)
    );

    const syncedEvents: CalendarEvent[] = (calData || [])
      .filter((evt: SyncedCalendarEvent) => !linkedGoogleIds.has(evt.googleEventId))
      .map((evt: SyncedCalendarEvent) => {
        const startMs = new Date(evt.startTime).getTime();
        const endMs = evt.endTime ? new Date(evt.endTime).getTime() : startMs + 60 * 60 * 1000;
        const durationMin = Math.round((endMs - startMs) / 60000);
        return {
          id: evt.id + 100000,
          loggedAt: evt.startTime,
          title: evt.summary,
          duration_min: durationMin,
          icon: evt.isVirtual ? 'video' : 'calendar',
          location: evt.location || null,
          type: 'calendar' as const,
          sourceData: evt,
        };
      });

    const sleepEvents: CalendarEvent[] = (sleepLogs || []).filter((sl: SleepEntry) => {
      if (!sl.sleepStart) return false;
      const start = new Date(sl.sleepStart);
      const end = sl.sleepEnd ? new Date(sl.sleepEnd) : new Date(start.getTime() + (sl.totalMinutes || 0) * 60000);
      const dayStart = new Date(selectedDate + 'T00:00:00');
      const dayEnd = new Date(selectedDate + 'T23:59:59');
      // Show sleep if bedtime OR wake time falls on this day
      return start <= dayEnd && end >= dayStart;
    }).map((sl: SleepEntry) => {
      const bedTime = new Date(sl.sleepStart!);
      const wakeTime = sl.sleepEnd
        ? new Date(sl.sleepEnd)
        : new Date(bedTime.getTime() + (sl.totalMinutes || 480) * 60000);
      const dayStart = new Date(selectedDate + 'T00:00:00');
      const dayEnd = new Date(selectedDate + 'T23:59:59');

      // Clip to the visible day: if bedtime is before this day, show from midnight
      const visibleStart = bedTime < dayStart ? dayStart : bedTime;
      // If wake is after this day, show until end of day
      const visibleEnd = wakeTime > dayEnd ? dayEnd : wakeTime;
      const visibleDuration = Math.round((visibleEnd.getTime() - visibleStart.getTime()) / 60000);

      return {
        id: sl.id + 200000,
        loggedAt: visibleStart.toISOString(),
        title: `Sleep${sl.quality ? ' (' + sl.quality + ')' : ''}`,
        duration_min: Math.max(visibleDuration, 15),
        icon: 'moon',
        location: null,
        type: 'sleep' as const,
        sourceData: sl,
      };
    });

    const PLANNED_ICONS: Record<string, string> = {
      wake: 'sunrise', breakfast: 'coffee', lunch: 'sun',
      dinner: 'sunset', bedtime: 'moon',
    };
    const PLANNED_LABELS: Record<string, string> = {
      wake: 'Wake', breakfast: 'Breakfast', lunch: 'Lunch',
      dinner: 'Dinner', bedtime: 'Bedtime',
    };

    // Determine which planned block types are already fulfilled by actual logs
    const fulfilledTypes = new Set<string>();
    // Check meals: if breakfast/lunch/dinner is logged, remove corresponding planned block
    for (const m of meals) {
      const mt = (m.mealType || '').toLowerCase();
      if (['breakfast', 'lunch', 'dinner'].includes(mt)) fulfilledTypes.add(mt);
    }
    // Check sleep: only hide bedtime if sleep *started* on this day,
    // and only hide wake if the wake-up time falls on this day.
    // This prevents last night's sleep log from hiding today's bedtime.
    for (const sl of (sleepLogs || [])) {
      if (!sl.sleepStart) continue;
      const bedStart = new Date(sl.sleepStart);
      const wakeEnd = sl.sleepEnd ? new Date(sl.sleepEnd) : new Date(bedStart.getTime() + (sl.totalMinutes || 0) * 60000);
      if (bedStart.toLocaleDateString('en-CA') === selectedDate) {
        fulfilledTypes.add('bedtime');
      }
      if (wakeEnd.toLocaleDateString('en-CA') === selectedDate) {
        fulfilledTypes.add('wake');
      }
    }

    const plannedEvents: CalendarEvent[] = plannedBlocks
      .filter((pb: PlannedBlock) => !fulfilledTypes.has(pb.blockType))
      .map((pb: PlannedBlock) => ({
        id: pb.id + 300000,
        loggedAt: pb.scheduledAt,
        title: PLANNED_LABELS[pb.blockType] || pb.blockType,
        duration_min: pb.blockType === 'bedtime' ? 30 : 15,
        icon: PLANNED_ICONS[pb.blockType] || 'clock',
        location: null,
        type: 'planned' as const,
        sourceData: pb,
      }));

    // Add Solar Events
    const solarEvents: CalendarEvent[] = [];
    if (solarTimes) {
      // Only add them if their date matches selectedDate roughly
      const dSunrise = solarTimes.sunrise.toLocaleDateString('en-CA');
      const dSunset = solarTimes.sunset.toLocaleDateString('en-CA');
      if (selectedDate === dSunrise) {
        solarEvents.push({
          id: 400001,
          loggedAt: solarTimes.sunrise.toISOString(),
          title: 'Sunrise',
          duration_min: 10,
          icon: 'sunrise',
          location: null,
          type: 'planned' as const,
          sourceData: {},
        });
      }
      if (selectedDate === dSunset) {
        solarEvents.push({
          id: 400002,
          loggedAt: solarTimes.sunset.toISOString(),
          title: 'Sunset',
          duration_min: 10,
          icon: 'sunset',
          location: null,
          type: 'planned' as const,
          sourceData: {},
        });
      }
    }

    // Build location events from sessions
    const MOTION_ICONS: Record<string, string> = {
      stationary: 'map-pin', walking: 'navigation', cycling: 'navigation',
      driving: 'truck', unknown: 'map-pin',
    };
    const MOTION_LABELS: Record<string, string> = {
      stationary: 'Stationary', walking: 'Walking', cycling: 'Biking',
      driving: 'Transit', unknown: 'Location',
    };

    // Location rail events (left side rail, opens map modal)
    const locationEvents: CalendarEvent[] = [];
    // Location-derived calendar blocks (main area, opens ActivityEditModal)
    // Consecutive trails merge into one commute block; stationary => activity block
    const locationActivityEvents: CalendarEvent[] = [];
    const sessions = locationSessions || [];
    let trailGroup: LocationSession[] = [];

    const flushTrailGroup = () => {
      if (trailGroup.length === 0) return;
      const first = trailGroup[0];
      const last = trailGroup[trailGroup.length - 1];
      
      const mergedPath = trailGroup.flatMap(s => s.path || []);
      const mergedSession = {
        ...first,
        endedAt: last.endedAt,
        duration_min: Math.max(1, Math.round((new Date(last.endedAt || new Date()).getTime() - new Date(first.startedAt).getTime()) / 60000)),
        path: mergedPath,
      };

      // 1. Add location events (rail dots) for each segment, but with the merged path
      trailGroup.forEach((s, i) => {
        const actualStart = new Date(s.startedAt);
        const actualEnd = s.endedAt ? new Date(s.endedAt) : new Date();
        const dayStart = new Date(selectedDate + 'T00:00:00');
        const dayEnd = new Date(selectedDate + 'T23:59:59');

        const visibleStart = actualStart < dayStart ? dayStart : actualStart;
        const visibleEnd = actualEnd > dayEnd ? dayEnd : actualEnd;
        const durationMin = Math.max(1, Math.round((visibleEnd.getTime() - visibleStart.getTime()) / 60000));
        
        let resolvedName = s.placeName;
        const matchedPlace = s.placeId ? knownPlaces.find(p => p.id === s.placeId) : null;
        if (matchedPlace) {
          resolvedName = matchedPlace.name;
        }

        const label = resolvedName 
          ? resolvedName
          : MOTION_LABELS[s.motionType] || 'Location';

        locationEvents.push({
          id: 500000 + locationEvents.length,
          loggedAt: visibleStart.toISOString(),
          title: label,
          duration_min: durationMin,
          icon: MOTION_ICONS[s.motionType] || 'navigation',
          location: s.placeName || null,
          type: 'location' as const,
          sourceData: { ...s, path: mergedPath },
        });
      });

      // 2. Add location activity event (main calendar block)
      const actualStart = new Date(first.startedAt);
      const actualEnd = last.endedAt ? new Date(last.endedAt) : new Date();
      const dayStart = new Date(selectedDate + 'T00:00:00');
      const dayEnd = new Date(selectedDate + 'T23:59:59');
      const visibleStart = actualStart < dayStart ? dayStart : actualStart;
      const visibleEnd = actualEnd > dayEnd ? dayEnd : actualEnd;
      const durationMin = Math.max(1, Math.round((visibleEnd.getTime() - visibleStart.getTime()) / 60000));

      const motionTypes = [...new Set(trailGroup.map(s => s.motionType))];
      const TRAIL_VERBS: Record<string, string> = {
        walking: 'Walk', running: 'Run', cycling: 'Bike', driving: 'Drive',
      };
      const verbs = motionTypes
        .filter(m => m !== 'unknown')
        .map(m => TRAIL_VERBS[m] || m)
        .filter(Boolean);
        
      const title = verbs.length > 1
        ? `${verbs.slice(0, 2).join(' and ')} commute`
        : verbs.length === 1 
          ? `${verbs[0]} commute` 
          : 'Transit';

      locationActivityEvents.push({
        id: 600000 + locationActivityEvents.length,
        loggedAt: visibleStart.toISOString(),
        title,
        duration_min: durationMin,
        icon: 'navigation',
        location: null,
        type: 'activity' as const,
        sourceData: {
          id: -(600000 + locationActivityEvents.length),
          loggedAt: visibleStart.toISOString(),
          activityType: 'commute',
          logName: title,
          duration_min: durationMin,
          source: 'location',
          meta: { locationSession: mergedSession, trailSessions: trailGroup },
        },
      });
      trailGroup = [];
    };

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i] as LocationSession;
      if (s.motionType !== 'stationary') {
        // Trail segment -- accumulate
        trailGroup.push(s);
        continue;
      }

      // Flush any accumulated trail group before this stationary session
      flushTrailGroup();

      // Handle stationary session
      const actualStart = new Date(s.startedAt);
      const actualEnd = s.endedAt ? new Date(s.endedAt) : new Date();
      const dayStart = new Date(selectedDate + 'T00:00:00');
      const dayEnd = new Date(selectedDate + 'T23:59:59');
      const visibleStart = actualStart < dayStart ? dayStart : actualStart;
      const visibleEnd = actualEnd > dayEnd ? dayEnd : actualEnd;
      let durationMin = Math.max(1, Math.round((visibleEnd.getTime() - visibleStart.getTime()) / 60000));

      // 1. Add to location rail
      let resolvedName = s.placeName;
      const matchedPlace = s.placeId ? knownPlaces.find(p => p.id === s.placeId) : null;
      if (matchedPlace) {
        resolvedName = matchedPlace.name;
      } else if (s.path && s.path.length > 0) {
        const threshold = 0.001;
        const coordMatch = knownPlaces.find(p => Math.abs(p.latitude - s.path[0][0]) < threshold && Math.abs(p.longitude - s.path[0][1]) < threshold);
        if (coordMatch) resolvedName = coordMatch.name;
      }

      const label = resolvedName 
        ? resolvedName
        : MOTION_LABELS[s.motionType] || 'Location';

      locationEvents.push({
        id: 500000 + locationEvents.length,
        loggedAt: visibleStart.toISOString(),
        title: label,
        duration_min: durationMin,
        icon: MOTION_ICONS[s.motionType] || 'map-pin',
        location: s.placeName || null,
        type: 'location' as const,
        sourceData: s,
      });

      // 2. Add stationary session -> activity block with smart title
      const childActs = getChildActivitiesForSession(s);
      const smartTitle = generateLocationBlockTitle(s, childActs);
      
      let activityDurationMin = durationMin;
      if (activityDurationMin < 30) activityDurationMin = 30; // Minimum 30 min block for stationary sessions

      // Determine icon from dominant child activity
      const dominantType = childActs.length > 0
        ? childActs.sort((a, b) => (b.duration_min || 0) - (a.duration_min || 0))[0].activity_type
        : 'other';
      const ACTIVITY_ICONS: Record<string, string> = {
        work: 'monitor', social: 'users', rest: 'moon', exercise: 'zap',
        cooking: 'coffee', eating: 'coffee', reading: 'book-open',
        commute: 'truck', walk: 'map-pin', workout: 'zap',
      };

      locationActivityEvents.push({
        id: 600000 + locationActivityEvents.length,
        loggedAt: visibleStart.toISOString(),
        title: smartTitle,
        duration_min: activityDurationMin,
        icon: ACTIVITY_ICONS[dominantType] || 'map-pin',
        location: s.placeName || null,
        type: 'activity' as const,
        sourceData: {
          id: -(600000 + locationActivityEvents.length),
          loggedAt: visibleStart.toISOString(),
          activityType: dominantType,
          logName: smartTitle,
          duration_min: activityDurationMin,
          location: s.placeName || undefined,
          source: 'location',
          meta: { locationSession: s },
        },
      });
    }
    // Flush remaining trail group
    flushTrailGroup();

    return [...actEvents, ...mealEvents, ...syncedEvents, ...sleepEvents, ...plannedEvents, ...solarEvents, ...locationEvents, ...locationActivityEvents].sort(
      (a, b) => new Date(a.loggedAt).getTime() - new Date(b.loggedAt).getTime()
    );
  }, [activities, meals, calData, sleepLogs, plannedBlocks, solarTimes, selectedDate, locationSessions]);

  // Build week events
  const weekCalendarEvents: CalendarEvent[] = useMemo(() => {
    if (viewMode !== 'week') return [];

    const weekActs: CalendarEvent[] = [];
    if (weekData?.days) {
      for (const acts of Object.values(weekData.days)) {
        for (const act of (acts as ActivityEntry[])) {
          weekActs.push({
            id: act.id,
            loggedAt: act.loggedAt,
            title: act.logName,
            duration_min: act.duration_min || 30,
            icon: act.activityType === 'work' ? 'monitor'
              : act.activityType === 'social' ? 'users'
              : act.activityType === 'workout' ? 'zap'
              : 'circle',
            location: act.location as string | null,
            type: 'activity',
            sourceData: act,
          });
        }
      }
    }

    const linkedGoogleIds = new Set(
      weekActs.filter(a => (a.sourceData as ActivityEntry).googleEventId).map(a => (a.sourceData as ActivityEntry).googleEventId!)
    );
    const weekCal: CalendarEvent[] = (calData || [])
      .filter((evt: SyncedCalendarEvent) => !linkedGoogleIds.has(evt.googleEventId))
      .map((evt: SyncedCalendarEvent) => {
        const startMs = new Date(evt.startTime).getTime();
        const endMs = evt.endTime ? new Date(evt.endTime).getTime() : startMs + 3600000;
        return {
          id: evt.id + 100000,
          loggedAt: evt.startTime,
          title: evt.summary,
          duration_min: Math.round((endMs - startMs) / 60000),
          icon: evt.isVirtual ? 'video' : 'calendar',
          location: evt.location || null,
          type: 'calendar' as const,
          sourceData: evt,
        };
      });

    const weekSleep: CalendarEvent[] = (sleepLogs || []).map((sl: SleepEntry) => ({
      id: sl.id + 200000,
      loggedAt: sl.sleepStart || sl.created_at,
      title: `Sleep${sl.quality ? ' (' + sl.quality + ')' : ''}`,
      duration_min: sl.totalMinutes || 480,
      icon: 'moon',
      location: null,
      type: 'sleep' as const,
      sourceData: sl,
    }));

    return [...weekActs, ...weekCal, ...weekSleep].sort(
      (a, b) => new Date(a.loggedAt).getTime() - new Date(b.loggedAt).getTime()
    );
  }, [viewMode, weekData, calData, sleepLogs]);

  const monthActivityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (weekData?.days) {
      for (const [date, acts] of Object.entries(weekData.days)) {
        counts[date] = (acts as ActivityEntry[]).length;
      }
    }
    if (dailyData?.activities) {
      counts[dailyData.date] = dailyData.activities.length + meals.length;
    }
    return counts;
  }, [weekData, dailyData, meals]);

  return {
    weekStart,
    isFetching,
    refetch,
    calendarEvents,
    weekCalendarEvents,
    monthActivityCounts,
  };
}
