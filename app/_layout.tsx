import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { useFonts, ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import * as SplashScreen from 'expo-splash-screen';
import { Provider } from 'react-redux';
import { store } from '../lib/store';
import LoginScreen from '../components/common/LoginScreen';
import {
  registerForPushNotifications,
  addNotificationListener,
  addNotificationResponseListener,
} from '../lib/notifications';
import { colors } from '../lib/theme';
import { getApiBase, getAuthToken, setAuthToken, initApiBase } from '../lib/api';
import { setStrapiUser } from '../lib/userContext';
import { initLocationServices, stopLocationServices, startActivityRecognition } from '../lib/services/location/locationService';
import { startDwellDetection, stopDwellDetection } from '../lib/services/location/placeInference';
import { syncCalendarEvents } from '../lib/services/calendarService';
import { scheduleBedtimeAlarms, generateMorningWakeup, refreshAllAlarms } from '../lib/services/schedule/alarmScheduler';
import { clearUnread } from '../lib/mittensNotify';
import { Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useScreenDimmer } from '../hooks/useScreenDimmer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePendantBridge } from '../lib/hooks/pendant/usePendantBridge';

SplashScreen.preventAutoHideAsync();

let hasInitializedSession = false;

export default function RootLayout() {
  const [user, setUser] = useState<any>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const router = useRouter();

  // Restore session from AsyncStorage
  useEffect(() => {
    const restoreSession = async () => {
      try {
        // Probe Strapi version before any API calls
        await initApiBase();
        const storedToken = await AsyncStorage.getItem('mittens_jwt');
        const storedUserJSON = await AsyncStorage.getItem('mittens_user');
        if (storedToken && storedUserJSON) {
          const u = JSON.parse(storedUserJSON);
          setAuthToken(storedToken);
          setStrapiUser(u);
          setUser(u);
        }
      } catch (e) {
        console.warn('[init] Failed to restore session:', e);
      } finally {
        setIsInitializing(false);
      }
    };
    restoreSession();
  }, []);

  const handleLogin = async (u: any) => {
    setStrapiUser(u);
    setUser(u);
    try {
      const token = getAuthToken();
      if (token) await AsyncStorage.setItem('mittens_jwt', token);
      await AsyncStorage.setItem('mittens_user', JSON.stringify(u));
    } catch (e) {
      console.warn('Failed to persist session:', e);
    }
  };
  const { isDimmed } = useScreenDimmer();

  // Mount pendant bridge at app root so it works regardless of active tab
  usePendantBridge();

  const [fontsLoaded] = useFonts({
    ArchivoBlack: ArchivoBlack_400Regular,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  // Initialize services after login (run exactly once per session)
  useEffect(() => {
    if (!user) return;
    if (hasInitializedSession) return;
    hasInitializedSession = true;

    (async () => {
      // Initialize local database FIRST -- services (personService, activityTypeService)
      // access tables immediately on mount, so all tables must exist before anything else runs.
      try {
        const { initializeDatabase } = require('../lib/database');
        await initializeDatabase();
      } catch (dbErr) {
        console.warn('[init] Database init failed:', dbErr);
      }

      // Register for push notifications
      await registerForPushNotifications();

      // Fetch user profile for config
      const token = getAuthToken();
      if (!token) return;

      let profile: any = null;
      try {
        const res = await fetch(`${getApiBase()}/nutrition-profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) profile = await res.json();
      } catch (err) {
        console.warn('[init] Failed to fetch profile:', err);
      }

      // Auto-initialize E2B if it's the selected brain (persisted in AsyncStorage).
      // This ensures the model is always ready when the user opens the app.
      try {
        const { getBrainId, setBrainId } = require('../lib/brain/selector');
        if (profile?.aiModel) {
          const cloudBrains = new Set(['gemini-flash', 'claude-sonnet', 'claude-opus', 'groq-free', 'openrouter-free']);
          if (cloudBrains.has(profile.aiModel)) {
            await setBrainId(profile.aiModel);
          } else if (profile.aiModel === 'gemma-e2b' || profile.aiModel === 'on-device' || profile.aiModel === 'e2b-local') {
            await setBrainId('e2b');
          } else if (profile.aiModel === 'smolvlm2-256m') {
            await setBrainId('smolvlm2');
          } else if (profile.aiModel === 'fastvlm-0.5b') {
            await setBrainId('fastvlm');
          } else if (profile.aiModel === 'moondream2') {
            await setBrainId('moondream2');
          } else if (profile.aiModel === 'ollama-byok' || profile.aiModel === 'ollama-selfhost') {
            await setBrainId('gemma26b');
          }
        }
        const brainId = await getBrainId();

        if (brainId === 'e2b') {
          const { LocalInferenceService } = require('../lib/services/ai/localInference');
          if (LocalInferenceService.isNativeAvailable()) {
            // Download model if not present
            const downloaded = await LocalInferenceService.isModelDownloaded();
            if (!downloaded) {
              console.log('[init] E2B model not found, downloading...');
              let lastLoggedPct = -1;
              await LocalInferenceService.downloadModel('gemma-local', (p: number) => {
                const pct = Math.round(p * 100);
                if (pct % 10 === 0 && pct !== lastLoggedPct) {
                  lastLoggedPct = pct;
                  console.log(`[init] Gemma download: ${pct}%`);
                }
              });
            }
            // Load model into engine
            if (!LocalInferenceService.isModelLoaded()) {
              console.log('[init] Loading E2B model...');
              await LocalInferenceService.loadModel('gemma-local', 'cpu');
              console.log('[init] E2B model loaded');
            }
          }
        }
      } catch (err) {
        console.warn('[init] E2B auto-init failed (non-blocking):', err);
      }

      // Fetch known places and init location services
      try {
        const placesRes = await fetch(`${getApiBase()}/known-places`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (placesRes.ok) {
          const places = await placesRes.json();
          await initLocationServices(places);
          // Start dwell detection after location is initialized
          startDwellDetection();
          // Start Activity Recognition (native ML motion detection)
          startActivityRecognition();
        }
      } catch (err) {
        console.warn('[init] Location services init failed:', err);
      }

      // Sync calendar events
      try {
        if (profile?.googleCalendarToken?.accessToken) {
          const syncResult = await syncCalendarEvents();
          if (syncResult) {
            console.log(`[init] Calendar synced: ${syncResult.count} events`);

            // Fetch today's events for alarm scheduling
            const eventsRes = await fetch(
              `${getApiBase()}/calendar-events/today?tz=${new Date().getTimezoneOffset()}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (eventsRes.ok) {
              const { events } = await eventsRes.json();
              const { getCurrentLocation } = require('../lib/services/location/locationService');
              const loc = getCurrentLocation();

              // Schedule departure alarms
              await refreshAllAlarms(
                events,
                loc,
                profile?.travelMode || 'transit'
              );

              // Generate morning wakeup ONLY if not already sent today and proactiveness is on and sleep not logged
              try {
                if (profile?.proactiveCheckins !== false) {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  // Check if sleep is already logged
                  const sleepRes = await fetch(`${getApiBase()}/sleep-logs?_limit=1&created_at_gte=${today.toISOString()}`, { headers: { Authorization: `Bearer ${token}` } });
                  const sleepData = sleepRes.ok ? await sleepRes.json() : [];
                  
                  if (sleepData.length === 0) {
                    const msgsRes = await fetch(
                      `${getApiBase()}/mittens-messages?_limit=1&_sort=created_at:DESC&activityType=morning_wakeup&created_at_gte=${today.toISOString()}`,
                      { headers: { Authorization: `Bearer ${token}` } }
                    );
                    const msgsData = msgsRes.ok ? await msgsRes.json() : { messages: [] };
                    const existingBriefings = Array.isArray(msgsData) ? msgsData : (msgsData.messages || []);
                    const currentHour = new Date().getHours();
                    
                    if (existingBriefings.length === 0 && currentHour >= 4 && currentHour < 12) {
                      await generateMorningWakeup();
                      console.log('[init] Morning wakeup generated');
                    }
                  }
                }
              } catch (briefErr) {
                console.warn('[init] Wakeup check failed:', briefErr);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[init] Calendar sync failed:', err);
      }

      // Generate meal plan on app open if not yet created today (works even without calendar)
      try {
        const planRes = await fetch(`${getApiBase()}/daily-meal-plan/today`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (planRes.ok) {
          const { plan } = await planRes.json();
          if (!plan) {
            // No plan for today -- kick off async generation (no need to wait)
            await fetch(`${getApiBase()}/daily-meal-plan/generate-async`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
            });
            console.log('[init] Meal plan async generation started on app open');
          }
        }
      } catch (err) {
        console.warn('[init] Meal plan check failed:', err);
      }

      // Inferred sleep end: complete open sleep-log on first app open
      try {
        const sleepRes = await fetch(
          `${getApiBase()}/sleep-logs?_limit=1&_sort=created_at:DESC`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (sleepRes.ok) {
          const sleepLogs = await sleepRes.json();
          const lastSleep = sleepLogs[0];
          // If there's an incomplete inferred sleep (has start, no end, within last 14h)
          if (
            lastSleep &&
            lastSleep.source === 'inferred' &&
            lastSleep.sleepStart &&
            !lastSleep.sleepEnd
          ) {
            const sleepStart = new Date(lastSleep.sleepStart);
            const hoursSinceStart = (Date.now() - sleepStart.getTime()) / 3600000;
            // Only complete if reasonable sleep window (2-14 hours)
            if (hoursSinceStart >= 2 && hoursSinceStart <= 14) {
              const now = new Date();
              const totalMinutes = Math.round((now.getTime() - sleepStart.getTime()) / 60000);
              await fetch(`${getApiBase()}/sleep-logs/${lastSleep.id}`, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  sleepEnd: now.toISOString(),
                  totalMinutes,
                }),
              });
              console.log(`[init] Inferred sleep end: ${Math.round(totalMinutes / 60 * 10) / 10}h`);
            }
          }
        }
      } catch (err) {
        console.warn('[init] Sleep inference failed:', err);
      }




      // Schedule bedtime alarms and rhythm blocks
      if (profile?.homeLongitude && profile?.scheduleEnabled !== false) {
        try {
          const { getCurrentLocation } = require('../lib/services/location/locationService');
          const loc = getCurrentLocation();
          await scheduleBedtimeAlarms(
            profile.sleepHours || 8,
            { lat: profile.homeLatitude, lon: profile.homeLongitude },
            loc,
            profile.travelMode || 'transit',
            undefined,
            profile
          );
        } catch (err) {
          console.warn('[init] Bedtime scheduling failed:', err);
        }
      }

      // Smart Alarms: Dynamically recalculate alarms when we move
      try {
        const { onLocationChange, getLastMotionType, getCurrentLocation } = require('../lib/services/location/locationService');
        const { dynamicallyUpdateAlarms } = require('../lib/services/schedule/alarmScheduler');
        
        onLocationChange(() => {
          const loc = getCurrentLocation();
          const motion = getLastMotionType();
          if (loc && motion) {
            dynamicallyUpdateAlarms(loc, motion).catch(() => {});
          }
        });
      } catch (err) {
        console.warn('[init] Failed to bind smart alarms to location changes:', err);
      }
    })();
  }, [user]);

  // Manage notification listeners (runs safely on mount/unmount)
  useEffect(() => {
    if (!user) return;

    // Handle notification responses (taps)
    const notifCleanup = addNotificationListener(async (notification) => {
      const data = notification.request.content.data;
      if (data?.type === 'morning_wakeup') {
        // Navigate to chat tab to see briefing
      }
      // Auto-trigger nightly check-in generation when notification fires
      if (data?.type === 'nightly_checkin') {
        try {
          const token = getAuthToken();
          if (token) {
            await fetch(`${getApiBase()}/nutrition-log/nightly-checkin`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
            });
            console.log('[notif] Nightly check-in generated from notification');
          }
        } catch (err) {
          console.warn('[notif] Nightly check-in trigger failed:', err);
        }
      }
    });

    const responseCleanup = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data as Record<string, string> | undefined;
      if (data?.type === 'mittens_message') {
        // Navigate to chat tab and clear badge
        clearUnread();
        try { router.push('/(tabs)/chat'); } catch { /* navigation might not be ready */ }
      }
      if (data?.type === 'departure' && data?.meetingLink) {
        Linking.openURL(data.meetingLink);
      }
      if (data?.type === 'bedtime' && data?.stage === 'sleep') {
        Linking.openURL('shortcuts://run-shortcut?name=Mittens%20Shutdown').catch(() => {});
      }
    });

    return () => {
      notifCleanup();
      responseCleanup();
    };
  }, [user]);

  // Cleanup on logout
  useEffect(() => {
    return () => {
      stopDwellDetection();
      stopLocationServices();
    };
  }, []);

  if (!fontsLoaded || isInitializing) return null;

  if (!user) {
    return (
      <Provider store={store}>
        <LoginScreen onLogin={handleLogin} />
      </Provider>
    );
  }

  return (
    <Provider store={store}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen
          name="results"
          options={{
            headerShown: true,
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.textPrimary,
            headerTitle: 'Results',
            presentation: 'modal',
          }}
        />
      </Stack>
    </Provider>
  );
}
