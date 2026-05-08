import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  TextInput,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, fonts } from '../lib/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { fetchTunnelUrl, getDevHubTunnelUrl } from '../lib/api';

/**
 * Dev Hub -- Full WebView integration with the Dev Hub dashboard.
 *
 * Smart URL discovery flow:
 *   1. Try localhost (simulator / same machine)
 *   2. Try cached LAN IP (same WiFi network)
 *   3. Try cached Cloudflare Tunnel URL (remote access)
 *   4. Show error with retry if all fail
 *
 * Once connected, fetches the current tunnel URL from the server
 * and caches it for future sessions.
 */

const STORAGE_KEY_TUNNEL = 'outreachhub_tunnel_url';
const STORAGE_KEY_LAN = 'outreachhub_lan_url';
const DEV_HUB_LOCAL = 'http://localhost:4100';
const HEALTH_TIMEOUT_MS = 3000;

type ConnectionMode = 'local' | 'lan' | 'tunnel' | 'discovering';

async function probeHealth(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

export default function OutreachHubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [hubUrl, setHubUrl] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('discovering');
  const [error, setError] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState('');

  // Discover the best available URL on mount
  useEffect(() => {
    discoverUrl();
  }, []);

  const discoverUrl = useCallback(async (overrideUrl?: string) => {
    setLoading(true);
    setError(null);
    setConnectionMode('discovering');

    if (overrideUrl) {
      if (await probeHealth(overrideUrl)) {
        setHubUrl(overrideUrl);
        setConnectionMode('tunnel');
        cacheTunnelUrl(overrideUrl);
        return;
      } else {
        setLoading(false);
        setError(`Failed to connect to ${overrideUrl}`);
        return;
      }
    }

    // 1. Try localhost (simulator or same machine)
    if (await probeHealth(DEV_HUB_LOCAL)) {
      setHubUrl(DEV_HUB_LOCAL);
      setConnectionMode('local');
      // Fetch and cache tunnel URL for future remote sessions
      cacheTunnelUrl(DEV_HUB_LOCAL);
      return;
    }

    // 1.5. Try Expo auto-detected LAN IP (for physical devices on same network)
    if (__DEV__) {
      const debuggerHost = Constants.expoConfig?.hostUri ?? Constants.debuggerHost;
      if (debuggerHost) {
        const host = debuggerHost.split(':')[0];
        const expoLanUrl = `http://${host}:4100`;
        if (await probeHealth(expoLanUrl)) {
          setHubUrl(expoLanUrl);
          setConnectionMode('lan');
          cacheTunnelUrl(expoLanUrl);
          return;
        }
      }
    }

    // 2. Try cached LAN IP
    const cachedLan = await AsyncStorage.getItem(STORAGE_KEY_LAN);
    if (cachedLan && await probeHealth(cachedLan)) {
      setHubUrl(cachedLan);
      setConnectionMode('lan');
      cacheTunnelUrl(cachedLan);
      return;
    }

    // 3. Try cached tunnel URL
    const cachedTunnel = await AsyncStorage.getItem(STORAGE_KEY_TUNNEL);
    if (cachedTunnel && await probeHealth(cachedTunnel)) {
      setHubUrl(cachedTunnel);
      setConnectionMode('tunnel');
      return;
    }

    // 4. Try Heroku backend for active tunnel URL
    // fetchTunnelUrl queries Heroku and caches both Strapi and DevHub tunnels
    await fetchTunnelUrl();
    const herokuTunnel = getDevHubTunnelUrl();
    if (herokuTunnel && await probeHealth(herokuTunnel)) {
      setHubUrl(herokuTunnel);
      setConnectionMode('tunnel');
      cacheTunnelUrl(herokuTunnel);
      return;
    }

    // All failed
    setLoading(false);
    setError(
      'Cannot reach Outreach Hub.\n\nMake sure the server is running (npm start in outreach-hub) and tunnel is enabled for remote access.'
    );
  }, []);

  // Fetch tunnel + LAN URLs from the server and cache them
  const cacheTunnelUrl = useCallback(async (baseUrl: string) => {
    try {
      const res = await fetch(`${baseUrl}/api/tunnel-url`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.tunnelUrl) {
        await AsyncStorage.setItem(STORAGE_KEY_TUNNEL, data.tunnelUrl);
      }
      if (data.lanAddress) {
        await AsyncStorage.setItem(STORAGE_KEY_LAN, data.lanAddress);
      }
    } catch { /* non-critical */ }
  }, []);

  const injectAuth = useCallback(async () => {
    try {
      const jwt = await AsyncStorage.getItem('mittens_jwt');
      if (jwt && webviewRef.current) {
        webviewRef.current.injectJavaScript(`
          document.cookie = 'devhub_jwt=${jwt}; path=/; SameSite=Lax';
          if (window.location.pathname === '/' && !document.cookie.includes('devhub_jwt')) {
            window.location.reload();
          }
          true;
        `);
      }
    } catch {}
  }, []);

  const handleLoad = useCallback(() => {
    setLoading(false);
    setError(null);
    injectAuth();
  }, [injectAuth]);

  const handleError = useCallback(() => {
    setLoading(false);
    setError('Connection lost. Outreach Hub may have restarted.');
  }, []);

  const modeLabel: Record<ConnectionMode, string> = {
    local: 'Local',
    lan: 'LAN',
    tunnel: 'Tunnel',
    discovering: '...',
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, Platform.OS === 'ios' ? 40 : 20) }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Feather name="chevron-left" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Outreach Hub</Text>
          {connectionMode !== 'discovering' && (
            <View style={styles.modeBadge}>
              <View style={[styles.modeDot, connectionMode === 'tunnel' ? styles.modeDotTunnel : styles.modeDotLocal]} />
              <Text style={styles.modeText}>{modeLabel[connectionMode]}</Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerAction}
            onPress={() => router.push('/dev-notes')}
          >
            <Image source={require('../assets/icon.png')} style={{ width: 26, height: 26, borderRadius: 13 }} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerAction}
            onPress={() => webviewRef.current?.reload()}
          >
            <Feather name="refresh-cw" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Loading indicator */}
      {loading && (
        <View style={styles.loadingBar}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.loadingText}>
            {connectionMode === 'discovering'
              ? 'Discovering Outreach Hub...'
              : 'Connecting...'}
          </Text>
        </View>
      )}

      {/* Error state */}
      {error && (
        <View style={styles.errorContainer}>
          <Feather name="wifi-off" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          
          <View style={styles.manualUrlContainer}>
            <Text style={styles.manualUrlLabel}>Outside of local network?</Text>
            <Text style={styles.manualUrlHint}>Paste the Cloudflare tunnel URL from your Mac terminal:</Text>
            <View style={styles.manualUrlInputRow}>
              <TextInput
                style={styles.manualUrlInput}
                placeholder="https://..."
                placeholderTextColor={colors.textDim}
                value={manualUrl}
                onChangeText={setManualUrl}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.connectBtn, !manualUrl && styles.connectBtnDisabled]}
                disabled={!manualUrl}
                onPress={() => discoverUrl(manualUrl.trim())}
              >
                <Text style={styles.connectBtnText}>Connect</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => discoverUrl()}
          >
            <Text style={styles.retryBtnText}>Auto Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* WebView */}
      {hubUrl && (
        <WebView
          ref={webviewRef}
          source={{ uri: hubUrl }}
          style={[styles.webview, error ? styles.webviewHidden : null]}
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction={false}
          onLoad={handleLoad}
          onError={handleError}
          onHttpError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            if (nativeEvent.statusCode >= 400) {
              setError(`Server returned ${nativeEvent.statusCode}`);
            }
          }}
          startInLoadingState={false}
          allowsInlineMediaPlayback
          mixedContentMode="compatibility"
          originWhitelist={['*']}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  backButton: {
    padding: spacing.xs,
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.textPrimary,
  },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  modeDotLocal: {
    backgroundColor: '#6B8F71', // sage
  },
  modeDotTunnel: {
    backgroundColor: '#C67A4B', // terracotta
  },
  modeText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerAction: {
    padding: spacing.xs,
  },
  loadingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  loadingText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  errorText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  manualUrlContainer: {
    width: '100%',
    backgroundColor: colors.bgCard,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xl,
  },
  manualUrlLabel: {
    fontFamily: fonts.heading,
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  manualUrlHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 12,
  },
  manualUrlInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  manualUrlInput: {
    flex: 1,
    height: 40,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 13,
    color: colors.textPrimary,
    fontFamily: fonts.mono,
  },
  connectBtn: {
    height: 40,
    paddingHorizontal: 16,
    backgroundColor: colors.accent,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectBtnDisabled: {
    opacity: 0.5,
  },
  connectBtnText: {
    color: colors.bg,
    fontSize: 13,
    fontWeight: '600',
  },
  retryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  webviewHidden: {
    height: 0,
    overflow: 'hidden',
  },
});
