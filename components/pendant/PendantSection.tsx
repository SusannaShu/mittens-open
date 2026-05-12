/**
 * PendantSection -- Profile tab section for pendant status and setup.
 *
 * Uses real BLE connection state from usePendantConnection.
 * Auto-scans on mount. Shows WiFi setup modal when:
 *   - Pendant connects but no WiFi is configured
 *   - Pendant reports WiFi connection failure (WIFI_FAIL signal)
 * Shows saved WiFi SSID so user can see what network is configured.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { PendantStatusBar } from './PendantStatusBar';
import { WifiSetupModal } from './WifiSetupModal';
import { usePendantFeed } from '../../lib/hooks/pendant/usePendantFeed';
import { usePendantConnection } from '../../lib/hooks/pendant/usePendantConnection';
import { profileStyles } from '../profile/profileStyles';

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  onOpenFeed: () => void;
}

export function PendantSection({ collapsed, onToggle, onOpenFeed }: Props) {
  const { captures, todayStats } = usePendantFeed();
  const {
    isConnected,
    isScanning,
    deviceId,
    wifiSSID,
    wifiFailed,
    scanAndPair,
    configureWifi,
    clearWifiFailed,
    disconnect,
  } = usePendantConnection();

  const [showWifiModal, setShowWifiModal] = useState(false);

  // Auto-scan on mount if no saved device
  useEffect(() => {
    if (!deviceId && !isScanning && !isConnected) {
      scanAndPair();
    }
  }, []);

  // Wi-Fi is not currently used; disabled auto-popups for Wi-Fi setup.

  const handleDismissModal = () => {
    setShowWifiModal(false);
    clearWifiFailed();
  };

  const lastCapture = captures.length > 0 ? captures[0] : null;

  const statusLabel = isScanning
    ? 'Scanning...'
    : isConnected
      ? 'Connected'
      : deviceId
        ? 'Reconnecting...'
        : 'Not paired';

  return (
    <View style={profileStyles.card}>
      <TouchableOpacity
        style={[profileStyles.sectionHeader, !collapsed && { marginBottom: 16 }]}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <View style={styles.headerLeft}>
          <Feather name="disc" size={16} color={colors.textPrimary} />
          <Text style={profileStyles.cardTitle}>PENDANT</Text>
          {isConnected && <View style={styles.connectedDot} />}
          {isScanning && (
            <ActivityIndicator size="small" color={colors.textMuted} style={{ marginLeft: 4 }} />
          )}
        </View>
        <Feather
          name={collapsed ? 'chevron-right' : 'chevron-down'}
          size={16}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      {!collapsed && (
        <View style={styles.body}>
          <PendantStatusBar
            isConnected={isConnected}
            todayMotionCount={todayStats.motionCount}
            todayAudioCount={todayStats.audioCount}
            lastEventTime={lastCapture?.timestamp}
            onPress={onOpenFeed}
          />

          {/* Connection actions */}
          {!isConnected && !isScanning && (
            <TouchableOpacity
              style={styles.scanButton}
              onPress={scanAndPair}
              activeOpacity={0.7}
            >
              <Feather name="bluetooth" size={14} color={colors.textPrimary} />
              <Text style={styles.scanButtonText}>
                {deviceId ? 'Reconnect Pendant' : 'Find Pendant'}
              </Text>
            </TouchableOpacity>
          )}

          {/* WiFi status row -- shows saved SSID or failure */}
          {isConnected && (
            <TouchableOpacity
              style={[
                styles.wifiRow,
                wifiFailed && styles.wifiRowFailed,
              ]}
              onPress={() => setShowWifiModal(true)}
              activeOpacity={0.7}
            >
              <Feather
                name="wifi"
                size={12}
                color={wifiFailed ? '#E53935' : wifiSSID ? colors.tagFeatureText : colors.textMuted}
              />
              <Text style={[
                styles.wifiRowText,
                wifiFailed && styles.wifiRowTextFailed,
              ]}>
                {wifiFailed
                  ? `Connection failed: ${wifiSSID || 'unknown'}`
                  : wifiSSID
                    ? `Connecting to ${wifiSSID}...`
                    : 'Set up WiFi'}
              </Text>
              <Feather name="chevron-right" size={12} color={colors.textMuted} />
            </TouchableOpacity>
          )}

          {/* Saved WiFi info when not connected */}
          {!isConnected && wifiSSID && (
            <TouchableOpacity
              style={styles.wifiRow}
              onPress={() => setShowWifiModal(true)}
              activeOpacity={0.7}
            >
              <Feather name="wifi" size={12} color={colors.textMuted} />
              <Text style={styles.wifiRowText}>
                Last WiFi: {wifiSSID}
              </Text>
              <Feather name="edit-2" size={12} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>
          )}

          {/* Latest capture preview */}
          {lastCapture && (
            <TouchableOpacity
              style={styles.latestCard}
              onPress={onOpenFeed}
              activeOpacity={0.7}
            >
              <Feather
                name={lastCapture.type === 'DOUBLE_TAP' ? 'mic' : 'camera'}
                size={14}
                color={colors.textSecondary}
              />
              <Text style={styles.latestText} numberOfLines={1}>
                {lastCapture.brainResponse ||
                  lastCapture.transcript ||
                  `${lastCapture.type === 'DOUBLE_TAP' ? 'Voice' : 'Frame'} captured`}
              </Text>
              <Feather name="arrow-right" size={12} color={colors.textMuted} />
            </TouchableOpacity>
          )}

          {/* Open feed */}
          <TouchableOpacity
            style={styles.feedButton}
            onPress={onOpenFeed}
            activeOpacity={0.7}
          >
            <Text style={styles.feedButtonText}>View Capture Feed</Text>
            <Feather name="arrow-right" size={14} color={colors.textPrimary} />
          </TouchableOpacity>

          {/* Disconnect */}
          {isConnected && (
            <TouchableOpacity
              style={styles.disconnectButton}
              onPress={disconnect}
              activeOpacity={0.7}
            >
              <Text style={styles.disconnectText}>Disconnect Pendant</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <WifiSetupModal
        visible={showWifiModal}
        mode={wifiFailed && wifiSSID ? 'hotspot_fix' : 'setup'}
        lastWiFi={wifiSSID}
        onDismiss={handleDismissModal}
        onSubmit={async (ssid, password) => {
          await configureWifi(ssid, password);
          setShowWifiModal(false);
          clearWifiFailed();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4CAF50',
    marginLeft: 4,
  },
  body: {
    gap: spacing.md,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    backgroundColor: '#FAFAFA',
  },
  scanButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  wifiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: '#F5F5F5',
  },
  wifiRowFailed: {
    backgroundColor: '#FFF3F3',
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  wifiRowText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  wifiRowTextFailed: {
    color: '#E53935',
  },
  latestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  latestText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
  },
  feedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.textPrimary,
  },
  feedButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  disconnectButton: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  disconnectText: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
