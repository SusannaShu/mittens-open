/**
 * usePendantConnection -- UI-facing hook for pendant connection state.
 *
 * Provides reactive state for pendant connection, pairing flow,
 * and settings. Used by the Settings screen and status indicators.
 * Exposes wifiFailed flag that triggers when pendant reports WIFI_FAIL.
 */

import { useState, useEffect, useCallback } from 'react';
import { getPendantService } from '../../services/pendant/pendantService';

interface PendantConnectionState {
  /** Whether the pendant is currently connected via BLE. */
  isConnected: boolean;
  /** Whether we're actively scanning for a pendant. */
  isScanning: boolean;
  /** The paired device ID (null if never paired). */
  deviceId: string | null;
  /** The WiFi SSID configured for data transfer. */
  wifiSSID: string | null;
  /** True when pendant reports WiFi connection failure. */
  wifiFailed: boolean;
}

export function usePendantConnection() {
  const [state, setState] = useState<PendantConnectionState>({
    isConnected: false,
    isScanning: false,
    deviceId: null,
    wifiSSID: null,
    wifiFailed: false,
  });

  useEffect(() => {
    const service = getPendantService();

    // Load initial state
    setState(prev => ({
      ...prev,
      isConnected: service.isConnected(),
      deviceId: service.getDeviceId(),
    }));

    service.getSavedWifiSSID().then(ssid => {
      setState(prev => ({ ...prev, wifiSSID: ssid }));
    });

    // Subscribe to connection changes
    const unsubConn = service.onConnectionChange((connected) => {
      setState(prev => ({
        ...prev,
        isConnected: connected,
        deviceId: service.getDeviceId(),
        // Clear wifi failure when we disconnect
        wifiFailed: connected ? prev.wifiFailed : false,
      }));
    });

    // Subscribe to WiFi failure events from pendant
    const unsubWifi = service.onWifiFail(() => {
      setState(prev => ({ ...prev, wifiFailed: true }));
    });

    return () => {
      unsubConn();
      unsubWifi();
    };
  }, []);

  /**
   * Scan for and connect to a pendant.
   */
  const scanAndPair = useCallback(async () => {
    const service = getPendantService();
    setState(prev => ({ ...prev, isScanning: true }));

    try {
      const deviceId = await service.scanAndConnect();
      if (deviceId) {
        setState(prev => ({
          ...prev,
          isConnected: true,
          deviceId,
          isScanning: false,
        }));
        return deviceId;
      }
    } catch (err) {
      console.error('[usePendantConnection] Scan failed:', err);
    }

    setState(prev => ({ ...prev, isScanning: false }));
    return null;
  }, []);

  /**
   * Send WiFi credentials to the pendant for data transfer.
   */
  const configureWifi = useCallback(async (ssid: string, password: string) => {
    const service = getPendantService();
    await service.sendWifiCredentials(ssid, password);
    setState(prev => ({ ...prev, wifiSSID: ssid, wifiFailed: false }));
  }, []);

  /**
   * Clear the wifi failure flag (e.g. after user dismisses modal).
   */
  const clearWifiFailed = useCallback(() => {
    setState(prev => ({ ...prev, wifiFailed: false }));
  }, []);

  /**
   * Disconnect from the pendant.
   */
  const disconnect = useCallback(() => {
    const service = getPendantService();
    service.disconnect();
    setState(prev => ({ ...prev, isConnected: false, wifiFailed: false }));
  }, []);

  return {
    ...state,
    scanAndPair,
    configureWifi,
    clearWifiFailed,
    disconnect,
  };
}
