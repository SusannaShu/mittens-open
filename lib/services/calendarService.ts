/**
 * Google Calendar OAuth Service.
 *
 * Native iOS flow: uses iOS client ID with reversed-client-ID URL scheme.
 * Backend exchanges the auth code for tokens using the web client secret.
 */

import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getApiBase, getAuthToken } from '../api';

WebBrowser.maybeCompleteAuthSession();

// Mittens project OAuth client IDs
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
];

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

/**
 * Start the Google Calendar OAuth flow.
 * On native iOS (dev-client or production): uses iOS client ID with reversed-client-ID scheme.
 * On Expo Go: falls back to web client ID with auth proxy.
 */
export async function connectGoogleCalendar(): Promise<boolean> {
  try {
    // Dev-client IS native -- appOwnership is null/undefined for standalone/dev-client,
    // 'expo' for Expo Go. __DEV__ is true for both, so we can't use it.
    const isExpoGo = Constants.appOwnership === 'expo';
    const isNative = Platform.OS === 'ios' && !isExpoGo;

    const clientId = isNative ? IOS_CLIENT_ID : WEB_CLIENT_ID;

    // Build redirect URI
    let redirectUri: string;
    if (isNative && IOS_CLIENT_ID) {
      // Native iOS: use reversed client ID scheme (registered in Info.plist)
      const reversedClientId = `com.googleusercontent.apps.${IOS_CLIENT_ID.split('.apps.googleusercontent.com')[0]}`;
      redirectUri = `${reversedClientId}:/oauthredirect`;
    } else {
      // Expo Go / web: use auth proxy
      redirectUri = AuthSession.makeRedirectUri({ path: 'oauthredirect' });
    }

    console.log('[calendar] clientId:', clientId?.substring(0, 20) + '...');
    console.log('[calendar] redirectUri:', redirectUri);

    const request = new AuthSession.AuthRequest({
      clientId,
      redirectUri,
      scopes: SCOPES,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      extraParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    });

    const result = await request.promptAsync(discovery);

    if (result.type !== 'success' || !result.params.code) {
      console.warn('[calendar] OAuth flow cancelled or failed:', result.type);
      return false;
    }

    // Send code to backend for exchange (backend has the web client secret)
    const token = getAuthToken();
    if (!token) return false;

    const exchangeRes = await fetch(`${getApiBase()}/calendar-events/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        code: result.params.code,
        redirectUri,
        codeVerifier: request.codeVerifier,
        clientId,
      }),
    });

    if (!exchangeRes.ok) {
      console.error('[calendar] Token exchange failed:', await exchangeRes.text());
      return false;
    }

    // Trigger initial sync
    const syncRes = await fetch(`${getApiBase()}/calendar-events/sync?tz=${new Date().getTimezoneOffset()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (syncRes.ok) {
      const data = await syncRes.json();
      console.log(`[calendar] Initial sync: ${data.count} events`);
    }

    return true;
  } catch (err) {
    console.error('[calendar] OAuth error:', err);
    return false;
  }
}

/**
 * Trigger a calendar sync (fetch latest events from Google).
 */
export async function syncCalendarEvents(): Promise<{ count: number } | null> {
  try {
    const token = getAuthToken();
    if (!token) return null;

    const res = await fetch(`${getApiBase()}/calendar-events/sync?tz=${new Date().getTimezoneOffset()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn('[calendar] Sync failed:', text);
      return null;
    }

    return res.json();
  } catch (err) {
    console.warn('[calendar] Sync error:', err);
    return null;
  }
}

/**
 * Check if Google Calendar is connected for this user.
 */
export async function isCalendarConnected(): Promise<boolean> {
  try {
    const token = getAuthToken();
    if (!token) return false;

    const res = await fetch(`${getApiBase()}/nutrition-profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) return false;
    const profile = await res.json();
    return !!(profile.googleCalendarToken?.accessToken);
  } catch {
    return false;
  }
}
