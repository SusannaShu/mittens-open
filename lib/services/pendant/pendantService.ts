/**
 * Pendant Service -- orchestrates BLE signaling + WiFi data reception.
 *
 * This is the main service that manages the pendant connection.
 * It coordinates two wireless channels:
 *   - BLE: low-power signaling (tap events, pairing, config)
 *   - WiFi: data transfer (audio + frames via HTTP server)
 *
 * LIFECYCLE:
 *   1. App boots -> pendantService.initialize()
 *   2. BLE scan for pendant -> connect -> subscribe to events
 *   3. Start HTTP server for WiFi data reception
 *   4. On BLE event signal -> wait for corresponding WiFi data -> emit combined event
 *   5. App shuts down -> pendantService.shutdown()
 *
 * PAIRING:
 *   During initial pairing, the app sends WiFi credentials (hotspot SSID/password)
 *   to the pendant via BLE COMMAND write. The pendant stores these in NVS and uses
 *   them for all subsequent WiFi connections.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { PendantServer } from './pendantServer';
import type { PendantEvent, PendantEventType } from './pendantProtocol';
import { PENDANT_SERVICE_UUID, buildWifiCredentialCommand } from './pendantProtocol';

// AsyncStorage keys
const STORAGE_DEVICE_ID = '@pendant_device_id';
const STORAGE_WIFI_SSID = '@pendant_wifi_ssid';

// ─── Event Callbacks ───

type DoubleTapCallback = (audioPath: string, framePath?: string) => void;
type SingleTapCallback = () => void;
type MotionFrameCallback = (framePath: string) => void;
type DisconnectCallback = () => void;
type ConnectionCallback = (connected: boolean) => void;
type WifiFailCallback = () => void;

export class PendantService {
  private server: PendantServer;
  private initialized = false;
  private connected = false;
  private deviceId: string | null = null;

  // BLE state (populated when react-native-ble-plx is installed)
  private bleManager: any = null;
  private bleDevice: any = null;

  // Event callbacks
  private doubleTapCbs: DoubleTapCallback[] = [];
  private singleTapCbs: SingleTapCallback[] = [];
  private motionFrameCbs: MotionFrameCallback[] = [];
  private disconnectCbs: DisconnectCallback[] = [];
  private connectionCbs: ConnectionCallback[] = [];
  private wifiFailCbs: WifiFailCallback[] = [];

  constructor() {
    this.server = new PendantServer();
  }

  // ─── Lifecycle ───

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Start HTTP server for WiFi data reception
    await this.server.start();

    // Register for server events
    this.server.onEvent((event) => this.handlePendantEvent(event));

    // Load saved device ID for auto-reconnect
    this.deviceId = await AsyncStorage.getItem(STORAGE_DEVICE_ID);

    // Initialize BLE manager
    try {
      const { BleManager } = require('react-native-ble-plx');
      this.bleManager = new BleManager();
      console.log('[Pendant] BLE manager created');
      if (this.deviceId) {
        // Wait for Bluetooth to be powered on before connecting
        const subscription = this.bleManager.onStateChange((state: string) => {
          if (state === 'PoweredOn') {
            subscription.remove();
            this.connectToDevice(this.deviceId!);
          }
        }, true);
      }
    } catch (err: any) {
      console.log('[Pendant] BLE library not available:', err?.message);
    }

    this.initialized = true;
    console.log('[Pendant] Service initialized');
  }

  shutdown(): void {
    this.server.stop();
    this.disconnect();
    this.initialized = false;
    console.log('[Pendant] Service shut down');
  }

  // ─── Connection ───

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Scan for the pendant and connect.
   * Returns the device ID on success.
   */
  async scanAndConnect(): Promise<string | null> {
    if (!this.bleManager) {
      console.log('[Pendant] BLE not available, cannot scan');
      return null;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.bleManager.stopDeviceScan();
        resolve(null);
      }, 10000);

      this.bleManager.startDeviceScan(
        [PENDANT_SERVICE_UUID],
        null,
        async (error: any, device: any) => {
          if (error) {
            console.error('[Pendant] Scan error:', error.message);
            return;
          }

          if (device) {
            clearTimeout(timeout);
            this.bleManager.stopDeviceScan();

            try {
              await this.connectToDevice(device.id);
              resolve(device.id);
            } catch (err) {
              console.error('[Pendant] Connect failed:', err);
              resolve(null);
            }
          }
        },
      );
    });
  }

  private async connectToDevice(deviceId: string): Promise<void> {
    if (!this.bleManager) return;

    try {
      this.bleDevice = await this.bleManager.connectToDevice(deviceId);
      await this.bleDevice.discoverAllServicesAndCharacteristics();

      // Subscribe to event signal notifications
      this.bleDevice.monitorCharacteristicForService(
        PENDANT_SERVICE_UUID,
        '6e400003-b5a3-f393-e0a9-e50e24dcca9e', // EVENT_SIGNAL_UUID
        (error: any, characteristic: any) => {
          if (error) return;
          if (characteristic?.value) {
            this.handleBleSignal(characteristic.value);
          }
        },
      );

      // Monitor disconnection
      this.bleDevice.onDisconnected(() => {
        this.connected = false;
        this.emitConnectionChange(false);
        for (const cb of this.disconnectCbs) cb();
        // Auto-reconnect after 2 seconds
        setTimeout(() => this.connectToDevice(deviceId), 2000);
      });

      this.deviceId = deviceId;
      this.connected = true;
      this.emitConnectionChange(true);
      await AsyncStorage.setItem(STORAGE_DEVICE_ID, deviceId);
      console.log('[Pendant] Connected to', deviceId);
    } catch (err) {
      console.error('[Pendant] Connection error:', err);
      this.connected = false;
      this.emitConnectionChange(false);
    }
  }

  disconnect(): void {
    if (this.bleDevice) {
      this.bleDevice.cancelConnection().catch(() => {});
      this.bleDevice = null;
    }
    this.connected = false;
    this.emitConnectionChange(false);
  }

  // ─── WiFi Credential Provisioning ───

  /**
   * Send WiFi credentials to the pendant during pairing.
   * The pendant stores these and uses them for WiFi data transfer.
   */
  async sendWifiCredentials(ssid: string, password: string, phoneIP?: string): Promise<void> {
    if (!this.bleDevice) {
      throw new Error('Pendant not connected');
    }

    const command = buildWifiCredentialCommand(ssid, password, phoneIP);

    await this.bleDevice.writeCharacteristicWithResponseForService(
      PENDANT_SERVICE_UUID,
      '6e400004-b5a3-f393-e0a9-e50e24dcca9e', // COMMAND_UUID
      btoa(command), // BLE expects base64
    );

    // Persist SSID for UI display
    await AsyncStorage.setItem(STORAGE_WIFI_SSID, ssid);
    console.log('[Pendant] WiFi credentials sent:', ssid);
  }

  /**
   * Send a command to the pendant.
   */
  async sendCommand(cmd: string): Promise<void> {
    if (!this.bleDevice) {
      throw new Error('Pendant not connected');
    }

    await this.bleDevice.writeCharacteristicWithResponseForService(
      PENDANT_SERVICE_UUID,
      '6e400004-b5a3-f393-e0a9-e50e24dcca9e', // COMMAND_UUID
      btoa(cmd),
    );
  }

  // ─── Event Handlers ───

  private handleBleSignal(base64Value: string): void {
    try {
      const json = atob(base64Value);
      const signal = JSON.parse(json);
      console.log('[Pendant] BLE signal:', signal.type);

      // For SINGLE_TAP we have all we need from BLE
      if (signal.type === 'SINGLE_TAP') {
        for (const cb of this.singleTapCbs) cb();
      }

      // WIFI_FAIL: pendant tried connecting but failed
      if (signal.type === 'WIFI_FAIL') {
        console.log('[Pendant] WiFi connection failed on pendant');
        for (const cb of this.wifiFailCbs) cb();
      }

      // PROVISIONED: pendant successfully connected to WiFi
      if (signal.type === 'PROVISIONED') {
        console.log('[Pendant] Pendant WiFi provisioned successfully');
      }

      // DOUBLE_TAP and MOTION will also arrive via WiFi with data
      // The WiFi handler (handlePendantEvent) handles those
    } catch {
      console.error('[Pendant] BLE signal parse error');
    }
  }

  private handlePendantEvent(event: PendantEvent): void {
    console.log(`[Pendant] Event: ${event.type}, audio: ${event.audioPath ? 'yes' : 'no'}, frame: ${event.framePath ? 'yes' : 'no'}`);

    switch (event.type) {
      case 'DOUBLE_TAP':
        if (event.audioPath) {
          for (const cb of this.doubleTapCbs) {
            cb(event.audioPath, event.framePath);
          }
        }
        break;

      case 'MOTION':
        if (event.framePath) {
          for (const cb of this.motionFrameCbs) {
            cb(event.framePath);
          }
        }
        break;

      case 'SINGLE_TAP':
        for (const cb of this.singleTapCbs) cb();
        break;
    }
  }

  private emitConnectionChange(connected: boolean): void {
    for (const cb of this.connectionCbs) cb(connected);
  }

  // ─── Event Registration ───

  onDoubleTap(cb: DoubleTapCallback): () => void {
    this.doubleTapCbs.push(cb);
    return () => { this.doubleTapCbs = this.doubleTapCbs.filter(c => c !== cb); };
  }

  onSingleTap(cb: SingleTapCallback): () => void {
    this.singleTapCbs.push(cb);
    return () => { this.singleTapCbs = this.singleTapCbs.filter(c => c !== cb); };
  }

  onMotionFrame(cb: MotionFrameCallback): () => void {
    this.motionFrameCbs.push(cb);
    return () => { this.motionFrameCbs = this.motionFrameCbs.filter(c => c !== cb); };
  }

  onDisconnect(cb: DisconnectCallback): () => void {
    this.disconnectCbs.push(cb);
    return () => { this.disconnectCbs = this.disconnectCbs.filter(c => c !== cb); };
  }

  onConnectionChange(cb: ConnectionCallback): () => void {
    this.connectionCbs.push(cb);
    return () => { this.connectionCbs = this.connectionCbs.filter(c => c !== cb); };
  }

  onWifiFail(cb: WifiFailCallback): () => void {
    this.wifiFailCbs.push(cb);
    return () => { this.wifiFailCbs = this.wifiFailCbs.filter(c => c !== cb); };
  }

  // ─── Getters ───

  async getSavedWifiSSID(): Promise<string | null> {
    return AsyncStorage.getItem(STORAGE_WIFI_SSID);
  }

  getDeviceId(): string | null {
    return this.deviceId;
  }

  // ─── Testing ───

  /**
   * Simulate a double-tap event for testing.
   * Records audio from the phone mic for `durationMs` using
   * expo-speech-recognition, then feeds it through the pendant pipeline.
   */
  async simulateDoubleTap(durationMs = 5000): Promise<void> {
    console.log(`[Pendant] Simulating double-tap (${durationMs}ms)...`);

    try {
      const ExpoSpeechRecognition = require('expo-speech-recognition');
      const FileSystem = require('expo-file-system/legacy');

      // Check if audio recording is supported
      const supportsRecording = ExpoSpeechRecognition.supportsRecording?.() ?? true;
      if (!supportsRecording) {
        console.warn('[Pendant] Speech recognition recording not supported, using text fallback');
        // Fallback: just fire callbacks with no audio to test TTS
        for (const cb of this.doubleTapCbs) {
          cb('', undefined);
        }
        return;
      }

      // Start speech recognition with recording enabled
      ExpoSpeechRecognition.ExpoSpeechRecognitionModule?.start?.({
        lang: 'en-US',
        interimResults: false,
        recordingOptions: {
          persist: true,
          outputDirectory: FileSystem.documentDirectory + 'pendant/',
          outputFileName: `sim_audio_${Date.now()}`,
          outputEncoding: 'pcm16',
          outputSampleRate: 16000,
        },
      });

      console.log('[Pendant] Recording...');

      // Wait for duration then stop
      await new Promise(resolve => setTimeout(resolve, durationMs));

      // Get the recording URI from the end event
      const audioPath = FileSystem.documentDirectory + `pendant/sim_audio_${Date.now()}.wav`;
      
      try {
        ExpoSpeechRecognition.ExpoSpeechRecognitionModule?.stop?.();
      } catch {}

      console.log('[Pendant] Simulate recording stopped');

      // Fire callbacks -- even without a real audio file,
      // this tests the bridge -> brain -> TTS pipeline
      for (const cb of this.doubleTapCbs) {
        cb(audioPath, undefined);
      }
    } catch (err: any) {
      console.error('[Pendant] Simulate failed:', err?.message || err);
      // Still fire callbacks for pipeline testing
      for (const cb of this.doubleTapCbs) {
        cb('', undefined);
      }
    }
  }
}

// ─── Singleton ───

let _instance: PendantService | null = null;

export function getPendantService(): PendantService {
  if (!_instance) {
    _instance = new PendantService();
  }
  return _instance;
}
