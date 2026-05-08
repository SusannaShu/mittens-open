/**
 * Push notification registration and handling for Mittens.
 * Registers for Expo push notifications and sends the token to the Mittens server.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

/**
 * Register for push notifications. Returns the Expo push token.
 * Must be called on a physical device (not simulator).
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device');
    return null;
  }

  // Check existing permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request permission if not already granted
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('Push notification permission denied');
    return null;
  }

  // Get the Expo push token
  let token = null;
  try {
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? '00000000-0000-0000-0000-000000000000';
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    token = tokenData.data;
    console.log('Expo push token:', token);
  } catch (e) {
    console.warn('Could not fetch push token:', e);
  }

  // Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('mittens-alarms', {
      name: 'Mittens Alarms',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 500, 250, 500],
      enableVibrate: true,
    });
  }

  return token;
}

/**
 * Send the push token to the Mittens Railway server.
 * The server stores it and uses it to send push notifications instead of email.
 */
export async function registerTokenWithMittens(
  token: string,
  mittensUrl: string,
  apiKey: string
): Promise<boolean> {
  try {
    const res = await fetch(`${mittensUrl}/push-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ token, platform: Platform.OS }),
    });

    if (res.ok) {
      console.log('Push token registered with Mittens server');
      return true;
    } else {
      console.error('Failed to register token:', await res.text());
      return false;
    }
  } catch (err) {
    console.error('Failed to register push token:', err);
    return false;
  }
}

/**
 * Listen for incoming notifications.
 * Returns a cleanup function to remove the listener.
 */
export function addNotificationListener(
  onReceive: (notification: Notifications.Notification) => void
) {
  const sub = Notifications.addNotificationReceivedListener(onReceive);
  return () => sub.remove();
}

/**
 * Listen for notification taps (user interacts with notification).
 */
export function addNotificationResponseListener(
  onResponse: (response: Notifications.NotificationResponse) => void
) {
  const sub = Notifications.addNotificationResponseReceivedListener(onResponse);
  return () => sub.remove();
}
