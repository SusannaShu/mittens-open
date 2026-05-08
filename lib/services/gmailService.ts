/**
 * Gmail OAuth Service.
 *
 * Independent from calendarService -- separate token, separate scopes.
 * Handles OAuth flow, token storage (local + Strapi), and refresh.
 */

import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBase, getAuthToken } from '../api';

WebBrowser.maybeCompleteAuthSession();

const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
];

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

const GMAIL_TOKEN_KEY = 'mittens_gmail_token';

interface GmailToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

// ── Token Storage (local + Strapi) ──

async function saveTokenLocally(token: GmailToken): Promise<void> {
  await AsyncStorage.setItem(GMAIL_TOKEN_KEY, JSON.stringify(token));
}

async function getLocalToken(): Promise<GmailToken | null> {
  const raw = await AsyncStorage.getItem(GMAIL_TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveTokenToStrapi(token: GmailToken): Promise<void> {
  try {
    const jwt = getAuthToken();
    if (!jwt) return;
    await fetch(`${getApiBase()}/nutrition-profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ gmailToken: token }),
    });
  } catch {
    // Strapi save is non-blocking -- local token is the source of truth
  }
}

// ── Public API ──

/**
 * Start the Gmail OAuth flow.
 * Returns true if connected successfully.
 */
export async function connectGmail(): Promise<boolean> {
  try {
    const isExpoGo = Constants.appOwnership === 'expo';
    const isNative = Platform.OS === 'ios' && !isExpoGo;
    const clientId = isNative ? IOS_CLIENT_ID : WEB_CLIENT_ID;

    let redirectUri: string;
    if (isNative && IOS_CLIENT_ID) {
      const reversedClientId = `com.googleusercontent.apps.${IOS_CLIENT_ID.split('.apps.googleusercontent.com')[0]}`;
      redirectUri = `${reversedClientId}:/oauthredirect`;
    } else {
      redirectUri = AuthSession.makeRedirectUri({ path: 'oauthredirect' });
    }

    const request = new AuthSession.AuthRequest({
      clientId,
      redirectUri,
      scopes: GMAIL_SCOPES,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      extraParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    });

    const result = await request.promptAsync(discovery);

    if (result.type !== 'success' || !result.params.code) {
      console.warn('[gmail] OAuth flow cancelled or failed:', result.type);
      return false;
    }

    // Exchange code for tokens via Strapi backend
    const jwt = getAuthToken();
    if (!jwt) return false;

    const exchangeRes = await fetch(`${getApiBase()}/gmail/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        code: result.params.code,
        redirectUri,
        codeVerifier: request.codeVerifier,
        clientId,
      }),
    });

    if (!exchangeRes.ok) {
      console.error('[gmail] Token exchange failed:', await exchangeRes.text());
      return false;
    }

    const tokenData = await exchangeRes.json();
    const token: GmailToken = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
    };

    // Save to both local and Strapi
    await saveTokenLocally(token);
    await saveTokenToStrapi(token);

    return true;
  } catch (err) {
    console.error('[gmail] OAuth error:', err);
    return false;
  }
}

/**
 * Check if Gmail is connected (token exists locally).
 */
export async function isGmailConnected(): Promise<boolean> {
  const token = await getLocalToken();
  return token !== null && !!token.accessToken;
}

/**
 * Get the current Gmail access token.
 * Handles local refresh if expired (via Strapi).
 * Returns null if not connected.
 */
export async function getGmailAccessToken(): Promise<string | null> {
  const token = await getLocalToken();
  if (!token) return null;

  // Check if token is expired (with 5-min buffer)
  if (token.expiresAt && Date.now() > token.expiresAt - 5 * 60 * 1000) {
    // Try to refresh via Strapi
    try {
      const jwt = getAuthToken();
      if (!jwt) return null;

      const res = await fetch(`${getApiBase()}/gmail/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
      });

      if (res.ok) {
        const refreshed = await res.json();
        const newToken: GmailToken = {
          accessToken: refreshed.access_token,
          refreshToken: token.refreshToken,
          expiresAt: Date.now() + (refreshed.expires_in || 3600) * 1000,
        };
        await saveTokenLocally(newToken);
        await saveTokenToStrapi(newToken);
        return newToken.accessToken;
      }
    } catch {
      // Refresh failed -- return existing token (may still work)
    }
  }

  return token.accessToken;
}

/**
 * Disconnect Gmail -- clear token locally and from Strapi.
 */
export async function disconnectGmail(): Promise<void> {
  await AsyncStorage.removeItem(GMAIL_TOKEN_KEY);
  try {
    const jwt = getAuthToken();
    if (jwt) {
      await fetch(`${getApiBase()}/nutrition-profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ gmailToken: null }),
      });
    }
  } catch {
    // Non-blocking
  }
}
