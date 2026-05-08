import { ScheduleProfile } from '../../types';
import * as Notifications from 'expo-notifications';
import { fetchSunrise } from './alarmScheduler';

export async function scheduleLightPrompt(profile: ScheduleProfile, wakeUtc: Date) {
  if (!profile.homeLatitude || profile.homeLongitude === null) return;
  
  const sunrise = await fetchSunrise(profile.homeLatitude, profile.homeLongitude, 0);
  const minutesFromSunrise = sunrise ? (wakeUtc.getTime() - sunrise.getTime()) / 60000 : null;

  let body: string;
  if (minutesFromSunrise === null) {
    body = 'Get 10 min of bright light in the next hour to anchor your day.';
  } else if (minutesFromSunrise < -90) {
    // Waking well before sunrise — polar winter or very early riser
    body = 'It\'s still dark out — 30 min with a 10,000 lux light box supports your circadian rhythm.';
  } else if (minutesFromSunrise >= -90 && minutesFromSunrise <= 120) {
    // Within the good window: step outside
    body = 'Get 10 min of outdoor light in the next hour — natural morning light anchors your day best.';
  } else {
    // Waking well after sunrise — summer at high latitudes or late sleeper
    body = 'The sun\'s been up for a while. Still get 10 min of outdoor light to reinforce your wake signal.';
  }

  const secondsUntilWake = Math.max(0, (wakeUtc.getTime() - Date.now()) / 1000);
  if (secondsUntilWake <= 0) return;

  await scheduleLightNotif(body, secondsUntilWake);
}

async function scheduleLightNotif(body: string, seconds: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync('morning-light').catch(() => {});
  
  await Notifications.scheduleNotificationAsync({
    identifier: 'morning-light',
    content: { 
      title: 'Morning light', 
      body, 
      data: { type: 'light_prompt' },
      sound: 'default' 
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.round(seconds),
      repeats: false,
    },
  });
}
