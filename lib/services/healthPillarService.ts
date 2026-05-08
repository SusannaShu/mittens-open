/**
 * HealthPillarService -- Compute health pillar scores client-side from local DB logs.
 *
 * Pillars derived from local data (no AI needed):
 *   1. Movement: sum METs*minutes from activity logs with 'movement' subcategory
 *   2. Touch Grass: minutes outdoors / in nature from activity logs with 'touch_grass' subcategory
 *   3. Brain Hygiene: positive from meditation/journal, negative from scrolling
 *   4. Circadian: morning light exposure (from sleep log toggle), consistent sleep/wake times
 *   5. Nutrition: meal log completeness + eating context quality
 *   6. Hydration: tracked via explicit hydration entries
 *   7. Sleep: sleep duration + quality from sleep logs
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

    return [
      this.computeMovement(logs),
      this.computeTouchGrass(logs),
      this.computeBrainHygiene(logs),
      this.computeCircadian(logs),
      this.computeNutrition(logs),
      this.computeSleep(logs),
    ];
  }

  private static async fetchLogs(dateStr: string): Promise<DayLogs> {
    const db = getDb();

    const activities = db.getAllSync(
      `SELECT * FROM activity_logs WHERE date(logged_at) = ? AND deleted_at IS NULL`,
      [dateStr]
    ) as any[];

    const meals = db.getAllSync(
      `SELECT * FROM nutrition_logs WHERE date(logged_at) = ? AND deleted_at IS NULL`,
      [dateStr]
    ) as any[];

    const sleep = db.getAllSync(
      `SELECT * FROM sleep_logs WHERE date(logged_at) = ? AND deleted_at IS NULL`,
      [dateStr]
    ) as any[];

    return { activities, meals, sleep };
  }

  // ── Movement ──
  // Goal: 600 MET-minutes/week (WHO) ≈ ~86/day
  private static computeMovement(logs: DayLogs): PillarScore {
    let totalMetMin = 0;
    for (const act of logs.activities) {
      const mets = act.met_value || act.default_mets || 1.5;
      const durMin = act.duration_min || 0;
      totalMetMin += mets * durMin;
    }

    const dailyTarget = 86;
    const pct = Math.min(100, Math.round((totalMetMin / dailyTarget) * 100));
    const status = pct >= 80 ? 'good' : pct >= 40 ? 'moderate' : 'low';

    return {
      id: 'movement',
      name: 'Movement',
      value: pct,
      target: '86 MET-min/day',
      metric: `${Math.round(totalMetMin)} MET-min`,
      status,
      details: [
        { label: 'MET-minutes', val: Math.round(totalMetMin).toString() },
        { label: 'Activities', val: logs.activities.length.toString() },
      ],
      whyText: 'WHO recommends 150-300 min moderate activity/week (600 MET-min). Movement reduces all-cause mortality.',
    };
  }

  // ── Touch Grass ──
  // Goal: 120 min/week nature exposure ≈ ~17 min/day
  private static computeTouchGrass(logs: DayLogs): PillarScore {
    let outdoorMin = 0;
    for (const act of logs.activities) {
      const isNature = act.is_nature === 1 || act.outdoors === 1;
      if (isNature) {
        outdoorMin += act.duration_min || 0;
      }
    }

    const dailyTarget = 17;
    const pct = Math.min(100, Math.round((outdoorMin / dailyTarget) * 100));
    const status = pct >= 80 ? 'good' : pct >= 40 ? 'moderate' : 'low';

    return {
      id: 'touch_grass',
      name: 'Touch Grass',
      value: pct,
      target: '17 min/day outdoors',
      metric: `${Math.round(outdoorMin)} min`,
      status,
      details: [
        { label: 'Outdoor time', val: `${Math.round(outdoorMin)} min` },
      ],
      whyText: '120 min/week in nature significantly improves wellbeing (White et al. 2019).',
    };
  }

  // ── Brain Hygiene ──
  // Positive: meditation, journal sessions. Negative: scrolling
  private static computeBrainHygiene(logs: DayLogs): PillarScore {
    let positiveMin = 0;
    let negativeMin = 0;

    for (const act of logs.activities) {
      const type = act.activity_type;
      if (type === 'meditation' || type === 'journal') {
        positiveMin += act.duration_min || 0;
      } else if (type === 'scrolling') {
        negativeMin += act.duration_min || 0;
      }
    }

    // 10 min meditation = good baseline, scrolling subtracts
    const netScore = Math.max(0, Math.min(100,
      Math.round((positiveMin / 10) * 60 - (negativeMin / 30) * 40)
    ));
    const status = netScore >= 60 ? 'good' : netScore >= 30 ? 'moderate' : 'low';

    return {
      id: 'brain_hygiene',
      name: 'Brain Hygiene',
      value: netScore,
      target: '10+ min mindfulness',
      metric: `${Math.round(positiveMin)} min positive`,
      status,
      details: [
        { label: 'Mindfulness', val: `${Math.round(positiveMin)} min` },
        { label: 'Screen scroll', val: `${Math.round(negativeMin)} min` },
      ],
      whyText: 'Regular mindfulness practice reduces cortisol and improves focus. Excessive scrolling increases anxiety.',
    };
  }

  // ── Circadian ──
  // Morning light within 30 min of wake-up, consistent sleep times
  private static computeCircadian(logs: DayLogs): PillarScore {
    let score = 50; // Start neutral

    for (const sl of logs.sleep) {
      // Morning light toggle
      if (sl.morning_light === 1) score += 25;

      // Consistent wake time (deviation from ideal)
      if (sl.wake_time) {
        const wakeHour = new Date(sl.wake_time).getHours();
        if (wakeHour >= 5 && wakeHour <= 8) score += 15;
        else if (wakeHour >= 8 && wakeHour <= 10) score += 5;
      }

      // Consistent bed time
      if (sl.bed_time) {
        const bedHour = new Date(sl.bed_time).getHours();
        if (bedHour >= 21 && bedHour <= 23) score += 10;
      }
    }

    score = Math.min(100, Math.max(0, score));
    const status = score >= 70 ? 'good' : score >= 40 ? 'moderate' : 'low';

    return {
      id: 'circadian',
      name: 'Circadian',
      value: score,
      target: 'Morning light + consistent times',
      metric: logs.sleep.some((s: any) => s.morning_light === 1) ? 'Morning light' : 'No morning light',
      status,
      details: [
        { label: 'Morning light', val: logs.sleep.some((s: any) => s.morning_light === 1) ? 'Yes' : 'No' },
        { label: 'Sleep logged', val: logs.sleep.length > 0 ? 'Yes' : 'No' },
      ],
      whyText: 'Morning sunlight within 30 min of waking sets circadian rhythm. Huberman Lab protocol.',
    };
  }

  // ── Nutrition ──
  // Based on meal log completeness + eating context
  private static computeNutrition(logs: DayLogs): PillarScore {
    const mealCount = logs.meals.length;
    let contextQuality = 0;

    for (const meal of logs.meals) {
      // Eating context factors
      if (meal.pace === 'slow') contextQuality += 1;
      if (meal.chewing === 'thorough') contextQuality += 1;
      if (meal.distraction === 'focused') contextQuality += 1;
      if (meal.stress === 'calm') contextQuality += 1;
    }

    // 3 meals = base 60, eating context adds up to 40
    const mealScore = Math.min(60, mealCount * 20);
    const contextScore = mealCount > 0 ? Math.min(40, Math.round((contextQuality / (mealCount * 4)) * 40)) : 0;
    const score = Math.min(100, mealScore + contextScore);
    const status = score >= 70 ? 'good' : score >= 40 ? 'moderate' : 'low';

    return {
      id: 'nutrition',
      name: 'Nutrition',
      value: score,
      target: '3 meals logged',
      metric: `${mealCount} meal${mealCount !== 1 ? 's' : ''} logged`,
      status,
      details: [
        { label: 'Meals', val: mealCount.toString() },
        { label: 'Context quality', val: contextScore > 20 ? 'Good' : contextScore > 0 ? 'Fair' : 'Not recorded' },
      ],
      whyText: 'Mindful eating (slow pace, focused, unstressed) improves nutrient absorption and satiety signals.',
    };
  }

  // ── Sleep ──
  // Duration + quality from sleep logs
  private static computeSleep(logs: DayLogs): PillarScore {
    if (logs.sleep.length === 0) {
      return {
        id: 'sleep',
        name: 'Sleep',
        value: 0,
        target: '7-9 hours',
        metric: 'Not logged',
        status: 'low',
        details: [{ label: 'Duration', val: 'Not logged' }],
        whyText: '7-9 hours of sleep is critical for cognitive function, immune health, and mood regulation.',
      };
    }

    const sl = logs.sleep[0];
    const totalMin = sl.total_minutes || 0;
    const hours = totalMin / 60;

    // Ideal: 7-9 hours
    let durationScore: number;
    if (hours >= 7 && hours <= 9) durationScore = 80;
    else if (hours >= 6 && hours <= 10) durationScore = 60;
    else durationScore = 30;

    // Quality bonus
    const qualityMap: Record<string, number> = { great: 20, good: 15, fair: 5, poor: 0 };
    const qualityBonus = qualityMap[sl.quality || ''] || 0;

    const score = Math.min(100, durationScore + qualityBonus);
    const status = score >= 70 ? 'good' : score >= 40 ? 'moderate' : 'low';

    return {
      id: 'sleep',
      name: 'Sleep',
      value: score,
      target: '7-9 hours',
      metric: `${hours.toFixed(1)}h`,
      status,
      details: [
        { label: 'Duration', val: `${hours.toFixed(1)} hours` },
        { label: 'Quality', val: sl.quality || 'N/A' },
      ],
      whyText: '7-9 hours of sleep is critical for cognitive function, immune health, and mood regulation.',
    };
  }
}
