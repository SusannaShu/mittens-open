/**
 * HealthPillarService -- Compute health pillar scores client-side from local DB logs.
 *
 * Pillars derived from local data (no AI needed):
 *   1. Movement: sum METs*minutes from activity logs with 'movement' subcategory (rolling 7 days)
 *   2. Touch Grass: minutes outdoors / in nature from activity logs (rolling 7 days)
 *   3. Brain Hygiene: positive from meditation/journal, negative from scrolling (rolling 7 days)
 *   4. Circadian: morning light exposure, consistent sleep/wake times (rolling 7 days)
 *   5. Nutrition: meal log completeness + eating context quality (rolling 7 days)
 *   6. Sleep: sleep duration + quality from sleep logs (rolling 7 days)
 *
 * All data comes from local SQLite -- no network calls.
 */

import { getDb } from '../database';

export interface PillarScore {
  id: string;
  name: string;
  value: number;    // 0-100
  target: string;
  metric: string;
  status: 'good' | 'moderate' | 'low';
  details: { label: string; val: string }[];
  whyText: string;
}

interface DayLogs {
  activities: any[];
  meals: any[];
  sleep: any[];
}

/**
 * Compute all health pillar scores for a given date.
 */
export class HealthPillarService {
  static async computeForDate(dateStr: string): Promise<PillarScore[]> {
    const logs = await this.fetchLogs(dateStr);

    const dates: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(dateStr + 'T12:00:00');
      d.setDate(d.getDate() - i);
      dates.push(d.toLocaleDateString('en-CA'));
    }

    return [
      this.computeMovement(logs),
      this.computeTouchGrass(logs),
      this.computeBrainHygiene(logs),
      this.computeCircadian(logs, dates),
      this.computeNutrition(logs, dates),
      this.computeSleep(logs, dates),
    ];
  }

  private static async fetchLogs(endDateStr: string): Promise<DayLogs> {
    const db = getDb();

    // Query for 7 days ending at endDateStr (inclusive)
    const activities = db.getAllSync(
      `SELECT al.*, 
              at.sub_categories AS type_sub_categories, 
              at.brain_hygiene_scale AS type_bh_scale,
              date(al.logged_at, 'localtime') AS local_date
       FROM activity_logs al
       LEFT JOIN activity_types at ON al.activity_type = at.key
       WHERE date(al.logged_at, 'localtime') >= date(?, '-6 days')
         AND date(al.logged_at, 'localtime') <= date(?)`,
      [endDateStr, endDateStr]
    ) as any[];

    const meals = db.getAllSync(
      `SELECT *, date(logged_at, 'localtime') AS local_date 
       FROM nutrition_logs 
       WHERE date(logged_at, 'localtime') >= date(?, '-6 days')
         AND date(logged_at, 'localtime') <= date(?)
         AND deleted_at IS NULL`,
      [endDateStr, endDateStr]
    ) as any[];

    const sleep = db.getAllSync(
      `SELECT *, date(logged_at, 'localtime') AS local_date 
       FROM sleep_logs 
       WHERE date(logged_at, 'localtime') >= date(?, '-6 days')
         AND date(logged_at, 'localtime') <= date(?)`,
      [endDateStr, endDateStr]
    ) as any[];

    return { activities, meals, sleep };
  }

  // ── Movement ──
  // Goal: 600 MET-minutes/week (WHO)
  private static computeMovement(logs: DayLogs): PillarScore {
    let totalMetMin = 0;
    for (const act of logs.activities) {
      const mets = act.mets || 1.5;
      const durMin = act.duration_min || 0;
      totalMetMin += mets * durMin;
    }

    const weeklyTarget = 600;
    const pct = Math.min(100, Math.round((totalMetMin / weeklyTarget) * 100));
    const status = pct >= 80 ? 'good' : pct >= 40 ? 'moderate' : 'low';
    const dailyAvg = totalMetMin / 7;

    return {
      id: 'movement',
      name: 'Movement',
      value: pct,
      target: '600 MET-min/week',
      metric: `${Math.round(totalMetMin)} MET-min`,
      status,
      details: [
        { label: '7-day total', val: `${Math.round(totalMetMin)} MET-min` },
        { label: 'Daily average', val: `${Math.round(dailyAvg)} MET-min` },
      ],
      whyText: 'WHO recommends 150-300 min moderate activity/week (600 MET-min). Movement reduces all-cause mortality.',
    };
  }

  // ── Touch Grass ──
  // Goal: 120 min/week nature exposure
  private static computeTouchGrass(logs: DayLogs): PillarScore {
    let outdoorMin = 0;
    for (const act of logs.activities) {
      const isNature = act.is_nature === 1 || act.outdoors === 1;
      if (isNature) {
        outdoorMin += act.duration_min || 0;
      }
    }

    const weeklyTarget = 120;
    const pct = Math.min(100, Math.round((outdoorMin / weeklyTarget) * 100));
    const status = pct >= 80 ? 'good' : pct >= 40 ? 'moderate' : 'low';
    const dailyAvg = outdoorMin / 7;

    return {
      id: 'touch_grass',
      name: 'Touch Grass',
      value: pct,
      target: '120 min/week outdoors',
      metric: `${Math.round(outdoorMin)} min`,
      status,
      details: [
        { label: '7-day total', val: `${Math.round(outdoorMin)} min` },
        { label: 'Daily average', val: `${Math.round(dailyAvg)} min` },
      ],
      whyText: '120 min/week in nature significantly improves wellbeing (White et al. 2019).',
    };
  }

  // ── Brain Hygiene ──
  // Positive: meditation, journal sessions. Negative: scrolling. Goal scaled by 7.
  private static computeBrainHygiene(logs: DayLogs): PillarScore {
    let positiveMin = 0;
    let negativeMin = 0;
    let positiveWeightedMin = 0;
    let negativeWeightedMin = 0;

    for (const act of logs.activities) {
      const type = act.activity_type;
      
      let metaObj: any = {};
      if (act.meta) {
        try {
          metaObj = typeof act.meta === 'string' ? JSON.parse(act.meta) : act.meta;
        } catch {}
      }

      const isBrainHygiene = 
        type === 'meditation' || 
        type === 'journal' || 
        type === 'scrolling' ||
        (typeof metaObj?.brain_hygiene_scale === 'number') ||
        (act.type_sub_categories && act.type_sub_categories.includes('brain_hygiene'));

      if (!isBrainHygiene) continue;

      let scale = 0;
      if (typeof metaObj?.brain_hygiene_scale === 'number') {
        scale = metaObj.brain_hygiene_scale;
      } else if (typeof act.type_bh_scale === 'number' && act.type_bh_scale !== null) {
        scale = act.type_bh_scale;
      } else {
        if (type === 'meditation' || type === 'journal') {
          scale = 2;
        } else if (type === 'scrolling') {
          scale = -2;
        } else {
          scale = 2; // Default for other brain hygiene subcategories
        }
      }

      const dur = act.duration_min || 0;
      if (scale > 0) {
        positiveMin += dur;
        positiveWeightedMin += dur * (scale / 2);
      } else if (scale < 0) {
        negativeMin += dur;
        negativeWeightedMin += dur * (Math.abs(scale) / 2);
      }
    }

    // Weekly targets: positive weighted divided by 70, negative by 210
    const netScore = Math.max(0, Math.min(100,
      Math.round((positiveWeightedMin / 70) * 60 - (negativeWeightedMin / 210) * 40)
    ));
    const status = netScore >= 60 ? 'good' : netScore >= 30 ? 'moderate' : 'low';

    return {
      id: 'brain_hygiene',
      name: 'Brain Hygiene',
      value: netScore,
      target: '70+ min mindfulness/week',
      metric: `${Math.round(positiveMin)} min positive`,
      status,
      details: [
        { label: '7-day restorative', val: `${Math.round(positiveMin)} min` },
        { label: '7-day harmful scroll', val: `${Math.round(negativeMin)} min` },
      ],
      whyText: 'Regular mindfulness practice reduces cortisol and improves focus. Excessive scrolling increases anxiety.',
    };
  }

  // ── Circadian ──
  // Calculate daily scores (0 if no sleep, otherwise starting at 50 with consistency/morning light bonuses)
  // and average over days with sleep data. Returns 0% if no sleep logs exist.
  private static computeCircadian(logs: DayLogs, dates: string[]): PillarScore {
    let totalScore = 0;
    let daysWithSleep = 0;
    let hasMorningLight = false;

    for (const dStr of dates) {
      const daySleep = logs.sleep.filter((s: any) => s.local_date === dStr);
      if (daySleep.length === 0) continue;

      let dayScore = 50; // Start at 50
      for (const sl of daySleep) {
        if (sl.morning_light === 1) {
          dayScore += 25;
          hasMorningLight = true;
        }

        if (sl.wake_time) {
          const wakeHour = new Date(sl.wake_time).getHours();
          if (wakeHour >= 5 && wakeHour <= 8) dayScore += 15;
          else if (wakeHour >= 8 && wakeHour <= 10) dayScore += 5;
        }

        if (sl.bed_time) {
          const bedHour = new Date(sl.bed_time).getHours();
          if (bedHour >= 21 && bedHour <= 23) dayScore += 10;
        }
      }

      dayScore = Math.min(100, Math.max(0, dayScore));
      totalScore += dayScore;
      daysWithSleep++;
    }

    if (daysWithSleep === 0) {
      return {
        id: 'circadian',
        name: 'Circadian',
        value: 0,
        target: 'Morning light + consistent times',
        metric: 'Not logged',
        status: 'low',
        details: [
          { label: 'Morning light', val: 'No' },
          { label: 'Sleep logged', val: 'No' },
        ],
        whyText: 'Morning sunlight within 30 min of waking sets circadian rhythm. Huberman Lab protocol.',
      };
    }

    const averageScore = Math.round(totalScore / daysWithSleep);
    const status = averageScore >= 70 ? 'good' : averageScore >= 40 ? 'moderate' : 'low';

    return {
      id: 'circadian',
      name: 'Circadian',
      value: averageScore,
      target: 'Morning light + consistent times',
      metric: hasMorningLight ? 'Morning light' : 'No morning light',
      status,
      details: [
        { label: 'Morning light days', val: `${logs.sleep.filter((s: any) => s.morning_light === 1).length} days` },
        { label: 'Sleep logged', val: `${daysWithSleep} of 7 days` },
      ],
      whyText: 'Morning sunlight within 30 min of waking sets circadian rhythm. Huberman Lab protocol.',
    };
  }

  // ── Nutrition ──
  // Compute daily scores and average over the 7 days
  private static computeNutrition(logs: DayLogs, dates: string[]): PillarScore {
    let totalNutritionScore = 0;
    let totalMeals = 0;

    for (const dStr of dates) {
      const dayMeals = logs.meals.filter((m: any) => m.local_date === dStr);
      const mealCount = dayMeals.length;
      totalMeals += mealCount;

      let contextQuality = 0;
      for (const meal of dayMeals) {
        let context: any = {};
        if (meal.eating_context) {
          try {
            context = JSON.parse(meal.eating_context);
          } catch {}
        }
        if (context.pace === 'slow') contextQuality += 1;
        if (context.chewing === 'thorough') contextQuality += 1;
        if (context.distraction === 'focused') contextQuality += 1;
        if (context.stress === 'calm') contextQuality += 1;
      }

      const mealScore = Math.min(60, mealCount * 20);
      const contextScore = mealCount > 0 ? Math.min(40, Math.round((contextQuality / (mealCount * 4)) * 40)) : 0;
      const dayScore = Math.min(100, mealScore + contextScore);
      totalNutritionScore += dayScore;
    }

    const averageNutritionScore = Math.round(totalNutritionScore / 7);
    const status = averageNutritionScore >= 70 ? 'good' : averageNutritionScore >= 40 ? 'moderate' : 'low';

    return {
      id: 'nutrition',
      name: 'Nutrition',
      value: averageNutritionScore,
      target: '3 meals/day logged',
      metric: `${totalMeals} meal${totalMeals !== 1 ? 's' : ''} logged`,
      status,
      details: [
        { label: '7-day meals', val: totalMeals.toString() },
        { label: 'Daily avg meals', val: (totalMeals / 7).toFixed(1) },
      ],
      whyText: 'Mindful eating (slow pace, focused, unstressed) improves nutrient absorption and satiety signals.',
    };
  }

  // ── Sleep ──
  // Average duration/quality over only the days with logs (or 0% if none)
  private static computeSleep(logs: DayLogs, dates: string[]): PillarScore {
    let totalSleepScore = 0;
    let totalSleepMinutes = 0;
    let daysWithSleep = 0;

    for (const dStr of dates) {
      const daySleep = logs.sleep.filter((s: any) => s.local_date === dStr);
      if (daySleep.length === 0) continue;

      const sl = daySleep[0];
      const totalMin = sl.total_minutes || 0;
      const hours = totalMin / 60;

      let durationScore: number;
      if (hours >= 7 && hours <= 9) durationScore = 80;
      else if (hours >= 6 && hours <= 10) durationScore = 60;
      else durationScore = 30;

      const qualityMap: Record<string, number> = { great: 20, good: 15, fair: 5, poor: 0 };
      const qualityBonus = qualityMap[sl.quality || ''] || 0;

      const dayScore = Math.min(100, durationScore + qualityBonus);
      totalSleepScore += dayScore;
      totalSleepMinutes += totalMin;
      daysWithSleep++;
    }

    if (daysWithSleep === 0) {
      return {
        id: 'sleep',
        name: 'Sleep',
        value: 0,
        target: '7-9 hours/night',
        metric: 'Not logged',
        status: 'low',
        details: [{ label: 'Duration', val: 'Not logged' }],
        whyText: '7-9 hours of sleep is critical for cognitive function, immune health, and mood regulation.',
      };
    }

    const averageSleepScore = Math.round(totalSleepScore / daysWithSleep);
    const averageHours = (totalSleepMinutes / daysWithSleep) / 60;
    const status = averageSleepScore >= 70 ? 'good' : averageSleepScore >= 40 ? 'moderate' : 'low';

    return {
      id: 'sleep',
      name: 'Sleep',
      value: averageSleepScore,
      target: '7-9 hours/night',
      metric: `${averageHours.toFixed(1)}h avg`,
      status,
      details: [
        { label: 'Avg duration', val: `${averageHours.toFixed(1)} hours` },
        { label: 'Logged nights', val: `${daysWithSleep} nights` },
      ],
      whyText: '7-9 hours of sleep is critical for cognitive function, immune health, and mood regulation.',
    };
  }
}
