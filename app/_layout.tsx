import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { useFonts, ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import * as SplashScreen from 'expo-splash-screen';
import { Provider } from 'react-redux';
import { store } from '../lib/store';
import { colors } from '../lib/theme';
import { usePendantBridge } from '../lib/hooks/pendant/usePendantBridge';
import { setBackendUser } from '../lib/userContext';
import { initExecutorch } from 'react-native-executorch';
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';
import { restoreBackgroundBreakIfNeeded } from '../lib/services/focusTimerNotificationHandler';

SplashScreen.preventAutoHideAsync();

// Initialize Executorch so models can be downloaded properly
initExecutorch({ resourceFetcher: ExpoResourceFetcher });

let hasInitializedSession = false;

// Mock user for local-first operations
const mockLocalUser = {
  id: 1,
  username: 'local_user',
  email: 'local@mittens.app',
};

export default function RootLayout() {
  const [isInitializing, setIsInitializing] = useState(true);

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

  // Initialize local services exactly once
  useEffect(() => {
    if (hasInitializedSession) return;
    hasInitializedSession = true;

    (async () => {
      try {
        // 1. Set mock user globally so context providers don't throw
        setBackendUser(mockLocalUser);

        // 2. Initialize local SQLite database
        const { initializeDatabase } = require('../lib/database');
        await initializeDatabase();
        
        console.log('[init] Local database ready');

        // 3. Initialize voice system (Kokoro neural TTS + background audio keepalive)
        //    This MUST run early -- the silent audio keepalive keeps the JS thread alive
        //    when backgrounded, which is required for all setTimeout-based features
        //    (cooking timers, sleep nudges, focus break timers).
        //    Also loads the Kokoro model so speak() uses the neural voice, not Siri.
        try {
          const { initVoice } = require('../lib/services/ai/voiceService');
          await initVoice();
          console.log('[init] Voice system ready (Kokoro + keepalive)');
        } catch (voiceErr) {
          console.warn('[init] Voice init failed (TTS will use native fallback):', voiceErr);
        }

        // 3b. Restore background break timer (must run AFTER voice init so
        //     Kokoro is loaded and keepalive is running before we try to speak)
        restoreBackgroundBreakIfNeeded();

        // 4. Initialize Location & Motion Tracking
        const { initLocationServices, startActivityRecognition } = require('../lib/services/location/locationService');
        const { getDb } = require('../lib/database');
        const db = getDb();
        const rows = db.getAllSync('SELECT * FROM known_places ORDER BY name ASC');
        const places = rows.map((r: any) => ({
          id: r.id, name: r.name, latitude: r.latitude, longitude: r.longitude,
          radius: r.radius_m || 100, placeType: r.place_type || 'other', icon: r.icon,
        }));
        await initLocationServices(places);
        await startActivityRecognition();
        
        console.log('[init] Location services started');
      } catch (err) {
        console.warn('[init] Initialization failed:', err);
      } finally {
        setIsInitializing(false);
      }
    })();
  }, []);

  if (!fontsLoaded || isInitializing) return null;

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
