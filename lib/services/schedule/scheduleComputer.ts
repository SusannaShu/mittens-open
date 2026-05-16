import { ScheduleProfile } from '../../types';
import { lmstToUtc, effectiveLongitude, normalizeLmstMinutes } from './solarTime';

export interface DailyScheduleLmst {
  wakeLmst: number;       // minutes from LMST midnight
  breakfastLmst: number;
  lunchLmst: number;
  dinnerLmst: number;
  bedtimeLmst: number;    // may be > 1440 (next day) — callers should mod 1440 and carry date
}

export interface DailyScheduleAbsolute {
  wakeUtc: Date;
  breakfastUtc: Date;
  lunchUtc: Date;
  dinnerUtc: Date;
  bedtimeUtc: Date;
}

const MINUTES_PER_DAY = 1440;

export function computeDailyScheduleLmst(profile: ScheduleProfile): DailyScheduleLmst {
  const wake = profile.wakeTimeLmstMinutes;
  const sleepMin = profile.sleepHours * 60;
  const bedtime = wake - sleepMin;       // may go negative → previous-LMST-day
  const breakfast = wake + profile.breakfastOffsetMinutes;
  const dinner = (bedtime < 0 ? bedtime + MINUTES_PER_DAY : bedtime) - profile.dinnerBeforeBedMinutes;
  const lunch = Math.round((breakfast + dinner) / 2);
  
  return { 
    wakeLmst: wake, 
    breakfastLmst: breakfast, 
    lunchLmst: lunch, 
    dinnerLmst: dinner, 
    bedtimeLmst: bedtime 
  };
}

function addDaysUtc(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function materializeSchedule(
  profile: ScheduleProfile,
  dayAnchor: Date,
  now: Date = new Date()
): DailyScheduleAbsolute {
  const lon = effectiveLongitude(profile.anchorTransition, profile.homeLongitude || 0, now);
  const s = computeDailyScheduleLmst(profile);
  
  return {
    wakeUtc:      lmstToUtc(normalizeLmstMinutes(s.wakeLmst), lon, dayAnchor),
    breakfastUtc: lmstToUtc(normalizeLmstMinutes(s.breakfastLmst), lon, dayAnchor),
    lunchUtc:     lmstToUtc(normalizeLmstMinutes(s.lunchLmst), lon, dayAnchor),
    dinnerUtc:    lmstToUtc(normalizeLmstMinutes(s.dinnerLmst), lon, dayAnchor),
    // Bedtime is "tonight's sleep" → the bedtime *before* the next wake
    bedtimeUtc:   lmstToUtc(
      normalizeLmstMinutes(s.bedtimeLmst), 
      lon,
      s.bedtimeLmst < 0 ? dayAnchor : addDaysUtc(dayAnchor, 1)
    ),
  };
}
