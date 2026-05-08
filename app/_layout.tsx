import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { useFonts, ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import * as SplashScreen from 'expo-splash-screen';
import { Provider } from 'react-redux';
import { store } from '../lib/store';
import { colors } from '../lib/theme';
import { usePendantBridge } from '../lib/hooks/pendant/usePendantBridge';
import { setBackendUser } from '../lib/userContext';

SplashScreen.preventAutoHideAsync();

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
