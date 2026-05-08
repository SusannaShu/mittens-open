/**
 * API client for the Strapi nutrition backend.
 * All calls go through the authenticated Strapi REST API.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DailySummary, SnapResponse, WeeklySummary } from './types';
import { LocalInferenceService } from './services/ai/localInference';

/**
 * Smart network detection for the Strapi backend URL.
 *
 * In dev mode, Expo's debuggerHost contains the IP of the computer running
 * the dev server (e.g. "192.168.1.185:8081"). We extract just the IP portion
 * and use it to reach Strapi on port 1338. This automatically adapts when
 * you switch between home, school, or any other network -- no manual IP changes.
 *
 * Strapi version detection:
 * - Local dev: probes the backend at startup to detect v3 vs v5
 * - Production Heroku: v3 (no /api prefix)
 *
 * Priority:
 * 1. EXPO_PUBLIC_API_URL env variable (explicit override)
 * 2. Auto-detected IP from Expo dev server (dev mode on physical device)
 * 3. localhost fallback (simulator)
 * 4. Production URL (release builds)
 */

const HEROKU_URL = 'https://sheyou-backend.herokuapp.com';

/** Return the raw Strapi host (no /api prefix) */
function getStrapiHost(): string {
  // If we already resolved a tunnel URL, use it
  if (_tunnelUrl) return _tunnelUrl;

  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  const isSimulator = !Device.isDevice
    || Device.modelName?.includes('Simulator')
    || Constants.executionEnvironment === 'simulator';

  if (!isSimulator) {
    // Physical device -> try tunnel first (set by initApiBase),
    // fall back to production
    return HEROKU_URL;
  }

  // Simulator always uses localhost (both run on the same machine)
  return 'http://127.0.0.1:1338';
}

// Cached state
let _apiPrefix: string | null = null;
let _strapiHost: string | null = null;
let _tunnelUrl: string | null = null;
let _devHubTunnelUrl: string | null = null;

/**
 * Probe the Strapi backend to detect v3 vs v5.
 * v5 serves all content API routes under /api/*.
 * We test by hitting /api/users-permissions/roles -- if it responds (200 or 403),
 * it's v5. If 404, it's v3.
 */
async function detectStrapiVersion(host: string): Promise<string> {
  // Explicit env override
  const envVersion = process.env.EXPO_PUBLIC_STRAPI_VERSION;
  if (envVersion === 'v5') return '/api';
  if (envVersion === 'v3') return '';

  // Production Heroku is v3
  if (host.includes('herokuapp.com')) return '';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${host}/api/content-type-builder/content-types`, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    // v5 responds with 200, 401, or 403; v3 would give 404
    if (res.status !== 404) {
      console.log('[mittens] Detected Strapi v5 (using /api prefix)');
      return '/api';
    }
  } catch {
    // Network error or timeout -- try v5 as default for local dev
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      console.log('[mittens] Backend probe failed, defaulting to /api for local dev');
      return '/api';
    }
  }

  console.log('[mittens] Detected Strapi v3 (no prefix)');
  return '';
}

/**
 * Get the full API base URL (host + version prefix).
 * On first call, uses a synchronous best-guess. Call initApiBase() early
 * in app startup to probe and cache the correct version.
 */
export function getApiBase(): string {
  const host = _strapiHost || getStrapiHost();
  const prefix = _apiPrefix !== null ? _apiPrefix : (host.includes('herokuapp.com') ? '' : '/api');
  return host + prefix;
}

/**
 * Fetch the Cloudflare tunnel URL from production Heroku backend.
 * The dev-hub launch script pushes the tunnel URL there so the Mittens
 * app on a physical device can auto-connect to the local dev backend.
 */
export function getDevHubTunnelUrl(): string | null {
  return _devHubTunnelUrl;
}

export async function fetchTunnelUrl(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${HEROKU_URL}/mittens-pipeline/tunnel`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.tunnelUrl) {
      const parts = data.tunnelUrl.split(',');
      const strapiUrl = parts[0];
      if (parts.length > 1) {
        _devHubTunnelUrl = parts[1];
      } else {
        _devHubTunnelUrl = null;
      }

      if (parts.length > 2) {
        const ollamaUrl = parts[2];
        await AsyncStorage.setItem('mittens_ollama_url', ollamaUrl);
        await AsyncStorage.setItem('mittens_ollama_model', 'gemma4:e2b');
        console.log(`[mittens] Configured Self-Hosted Ollama: ${ollamaUrl}`);
      }

      // Verify the tunnel is actually reachable
      const probeController = new AbortController();
      const probeTimeout = setTimeout(() => probeController.abort(), 3000);
      const probe = await fetch(`${strapiUrl}/health`, {
        method: 'HEAD',
        signal: probeController.signal,
      }).catch(() => null);
      clearTimeout(probeTimeout);
      
      // Strapi doesn't have /health! So it returns 404!
      // But 404 is still an ok response from the proxy, meaning the tunnel works!
      if (probe && probe.status !== 502 && probe.status !== 503) {
        console.log(`[mittens] Tunnel URL found: ${strapiUrl} (updated ${data.updatedAt})`);
        return strapiUrl;
      }
      console.log('[mittens] Tunnel URL found but not reachable, using production');
    }
  } catch (err) {
    console.log('[mittens] Tunnel fetch failed, using production');
  }
  return null;
}

/** Call once at app startup to probe Strapi version and resolve tunnel */
export async function initApiBase(): Promise<void> {
  _strapiHost = getStrapiHost();

  // On physical device, try to find a tunnel URL
  const isSimulator = !Device.isDevice
    || Device.modelName?.includes('Simulator')
    || Constants.executionEnvironment === 'simulator';

  if (!isSimulator) {
    const tunnel = await fetchTunnelUrl();
    if (tunnel) {
      _tunnelUrl = tunnel;
      _strapiHost = tunnel;
    }
  }

  _apiPrefix = await detectStrapiVersion(_strapiHost);
  console.log('[mittens] API_BASE:', getApiBase(), '| isDevice:', Device.isDevice, '| model:', Device.modelName, _tunnelUrl ? '| via tunnel' : '');
}

const API_BASE_SYNC = getStrapiHost();
if (__DEV__) console.log('[mittens] API_BASE (initial):', API_BASE_SYNC + (API_BASE_SYNC.includes('herokuapp.com') ? '' : '/api'), '| isDevice:', Device.isDevice, '| model:', Device.modelName);

let authToken: string | null = null;

export function setAuthToken(token: string) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

/** Log in to Strapi with email/password, returns JWT */
export async function login(identifier: string, password: string): Promise<{ jwt: string; user: any }> {
  const res = await fetch(`${getApiBase()}/auth/local`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login failed: ${text.substring(0, 200)}`);
  }

  const data = await res.json();
  authToken = data.jwt;
  return data;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) h['Authorization'] = `Bearer ${authToken}`;
  return h;
}

async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: { ...headers(), ...options?.headers },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.substring(0, 200)}`);
  }

  // Sliding-window: silently update token if backend refreshed it
  const refreshedToken = res.headers.get('X-Refreshed-Token');
  if (refreshedToken) {
    authToken = refreshedToken;
  }

  return res.json();
}

export interface BrainProxyResponse {
  text: string;
  provider: string;
  model: string;
}

export async function brainText(prompt: string, aiModel: string, opts?: any): Promise<BrainProxyResponse> {
  return apiCall<BrainProxyResponse>('/mittens-pipeline/brain/text', {
    method: 'POST',
    body: JSON.stringify({ prompt, aiModel, opts }),
  });
}

export async function brainVision(
  prompt: string,
  images: string[],
  aiModel: string,
  opts?: any,
): Promise<BrainProxyResponse> {
  return apiCall<BrainProxyResponse>('/mittens-pipeline/brain/vision', {
    method: 'POST',
    body: JSON.stringify({ prompt, images, aiModel, opts }),
  });
}

/** Upload base64 image to Strapi */
export async function uploadImage(imageBase64: string): Promise<number | null> {
  const formData = new FormData();
  formData.append('files', {
    uri: `data:image/jpeg;base64,${imageBase64}`,
    name: `photo_${Date.now()}.jpg`,
    type: 'image/jpeg',
  } as any);

  try {
    const res = await fetch(`${getApiBase()}/upload`, {
      method: 'POST',
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: formData,
    });

    if (!res.ok) throw new Error('Upload failed');
    const uploadedFiles = await res.json();
    return uploadedFiles[0]?.id || null;
  } catch (err) {
    console.error('Image upload error:', err);
    return null;
  }
}

export async function snapMeal(
  imageBase64: string,
  mealType?: string,
  imageId?: number | null
): Promise<SnapResponse> {
  return apiCall('/nutrition-log/snap', {
    method: 'POST',
    body: JSON.stringify({ image: imageBase64, mealType, imageId }),
  });
}

/** Analyze photo only (no logging) */
export async function analyzePhoto(
  imageBase64: string,
  mode: 'meal' | 'fridge' = 'meal'
) {
  return apiCall<{ foods: any[] }>('/nutrition-log/analyze', {
    method: 'POST',
    body: JSON.stringify({ image: imageBase64, mode }),
  });
}

/** Ask Gemini to analyze a missing item via text (and optional image contextualization) */
export async function analyzeText(text: string, imageId?: number, mealType?: string) {
  return apiCall('/nutrition-log/analyze-text', {
    method: 'POST',
    body: JSON.stringify({ text, imageId, mealType }),
  });
}

/** Log confirmed items after user review */
export async function logConfirmed(
  mealName: string,
  foods: any[],
  mealType: string,
  imageId?: number
) {
  return apiCall('/nutrition-log/log', {
    method: 'POST',
    body: JSON.stringify({ mealName, foods, mealType, source: 'vision', imageId }),
  });
}

/** Get today's nutrition summary */
export async function getDailySummary(date?: string): Promise<DailySummary> {
  const q = date ? `?date=${date}` : '';
  return apiCall(`/nutrition-log/daily${q}`);
}

/** Get 7-day rolling summary */
export async function getWeeklySummary(): Promise<WeeklySummary> {
  return apiCall('/nutrition-log/weekly');
}

/** Get food recommendations */
export async function getRecommendations() {
  return apiCall<{ gaps: any[]; recommendations: any[] }>('/nutrition-log/recs');
}

/** Delete a logged entry */
export async function deleteEntry(id: number) {
  return apiCall(`/nutrition-log/${id}`, { method: 'DELETE' });
}

/** Update a logged entry text (AI re-analysis) */
export async function updateEntry(id: number, text: string) {
  return apiCall(`/nutrition-log/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ text }),
  });
}

/** Update a logged entry with direct item edits (no AI) */
export async function updateEntryDirect(id: number, items: any[], logName?: string) {
  return apiCall(`/nutrition-log/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ items, logName }),
  });
}

/** Scan fridge photo */
export async function scanFridge(imageBase64: string) {
  return apiCall<{ pantry: any[]; nutrientGaps: any[]; grocerySuggestions: any[] }>(
    '/nutrition-pantry/scan',
    { method: 'POST', body: JSON.stringify({ image: imageBase64 }) }
  );
}

/** Smart snap: auto-detect meal vs fridge */
export async function smartSnap(imageBase64: string) {
  return apiCall<any>(
    '/nutrition-log/smart-snap',
    { method: 'POST', body: JSON.stringify({ image: imageBase64 }) }
  );
}

/** Get pantry inventory */
export async function getPantry() {
  return apiCall<{ pantry: any[] }>('/nutrition-pantry');
}

/** Get grocery list */
export async function getGroceryList() {
  return apiCall<{ gaps: any[]; groceryList: any[] }>('/nutrition-pantry/grocery-list');
}

/** Get user profile/habits */
export async function getProfile() {
  return apiCall<any>('/nutrition-profile', {
    headers: { 'Cache-Control': 'no-cache' }
  });
}

/** Update user profile/habits */
export async function updateProfile(data: any) {
  return apiCall<any>('/nutrition-profile', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}



/** Talk to Mittens: conversational AI */
export async function chatWithMittens(message: string, messageId?: string, tzOffset?: number) {
  const payload: any = { 
    message, 
    messageId, 
    tz: tzOffset !== undefined ? tzOffset : new Date().getTimezoneOffset()
  };
  
  let res = await apiCall<any>(
    '/nutrition-log/chat',
    { method: 'POST', body: JSON.stringify(payload) }
  );

  // Stage 1 local: Strapi sends capability check prompt for on-device execution
  if (res && res.type === 'local_inference_required' && res.stage === 1) {
    console.log(`[chatWithMittens] Stage 1 capability check → running locally (${res.prompt.length} chars)`);
    const stage1Json = await LocalInferenceService.generateLocalResponse(res.prompt);
    // Send Stage 1 result back; Strapi will pull the right data and return Stage 2 prompt
    res = await apiCall<any>(
      '/nutrition-log/chat',
      { method: 'POST', body: JSON.stringify({ ...payload, local_stage1_result: stage1Json }) }
    );
  }

  // Stage 2 local: Strapi sends the full chat prompt for on-device execution
  if (res && res.type === 'local_inference_required' && res.stage === 2) {
    console.log(`[chatWithMittens] Stage 2 chat → running locally (${res.prompt.length} chars)`);
    try {
      const localJsonStr = await LocalInferenceService.generateLocalResponse(res.prompt);
      // Send Stage 2 result back; Strapi executes DB saves and returns final reply
      res = await apiCall<any>(
        '/nutrition-log/chat',
        { method: 'POST', body: JSON.stringify({ ...payload, local_inference_result: localJsonStr }) }
      );
    } catch (e) {
      console.error('[chatWithMittens] Local inference failed', e);
      throw e;
    }
  }

  return res;
}

/** Get USDA food recommendations for a specific nutrient */
export async function getNutrientRecs(nutrient: string) {
  return apiCall<{
    nutrient: string;
    name: string;
    unit: string;
    actual: number;
    rda: number;
    deficit: number;
    pct: number;
    foods: Array<{ food: string; portion: string; amount: number; servingsNeeded?: number; source: string }>;
  }>(
    '/nutrition-log/nutrient-recs',
    { method: 'POST', body: JSON.stringify({ nutrient }) }
  );
}

/** Toggle food dislike on user profile */
export async function dislikeFood(food: string, reason?: string) {
  return apiCall<{ dislikedFoods: Array<{ food: string; reason?: string | null }>; action: string }>(
    '/nutrition-log/dislike',
    { method: 'POST', body: JSON.stringify({ food, reason }) }
  );
}

/** Load persisted chat messages (newest first) */
export async function loadMessages(limit = 100, start = 0) {
  return apiCall<{ messages: any[]; total: number }>(
    `/mittens-messages?_limit=${limit}&_start=${start}&_sort=created_at:DESC`
  );
}

/** Upload a local file URI to Strapi */
export async function uploadLocalImage(uri: string): Promise<number | null> {
  try {
    const res = await FileSystem.uploadAsync(`${getApiBase()}/upload`, uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'files',
      mimeType: 'image/jpeg',
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    });

    if (res.status >= 200 && res.status < 300) {
      const uploadedFiles = JSON.parse(res.body);
      return uploadedFiles[0]?.id || null;
    } else {
      console.error('Upload failed with status', res.status, res.body);
      return null;
    }
  } catch (err) {
    console.error('Local image upload error:', err);
    return null;
  }
}

/** Save a single chat message */
export async function saveMessage(msg: {
  role: 'user' | 'mittens';
  text: string;
  photos?: string[];
  activityType?: string;
  metadata?: any;
}) {
  const payload = { ...msg };
  
  if (payload.photos && payload.photos.length > 0) {
    const uploadedIds: number[] = [];
    for (const photo of payload.photos) {
      if (typeof photo === 'string' && photo.startsWith('file://')) {
        const id = await uploadLocalImage(photo);
        if (id) uploadedIds.push(id);
      } else if (typeof photo === 'number') {
        uploadedIds.push(photo);
      }
    }
    if (uploadedIds.length > 0) {
      payload.photos = uploadedIds as any;
    } else {
      delete payload.photos;
    }
  } else {
    delete payload.photos;
  }

  return apiCall<{ id: number }>('/mittens-messages', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Save a batch of messages (user + mittens reply pair) */
export async function saveMessageBatch(messages: Array<{
  role: 'user' | 'mittens';
  text: string;
  photos?: string[];
  activityType?: string;
  metadata?: any;
}>) {
  const payloadMessages = [];
  for (const m of messages) {
    const p = { ...m };
    if (p.photos && p.photos.length > 0) {
      const uploadedIds: number[] = [];
      for (const photo of p.photos) {
        if (typeof photo === 'string' && photo.startsWith('file://')) {
          const id = await uploadLocalImage(photo);
          if (id) uploadedIds.push(id);
        } else if (typeof photo === 'number') {
          uploadedIds.push(photo);
        }
      }
      if (uploadedIds.length > 0) p.photos = uploadedIds as any;
      else delete p.photos;
    } else {
      delete p.photos;
    }
    payloadMessages.push(p);
  }

  return apiCall<{ saved: number }>('/mittens-messages/batch', {
    method: 'POST',
    body: JSON.stringify({ messages: payloadMessages }),
  });
}
