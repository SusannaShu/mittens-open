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
import { PENDANT_SERVICE_UUID, DATA_INFO_UUID, DATA_STREAM_UUID, DATA_ACK_UUID, buildWifiCredentialCommand } from './pendantProtocol';

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

  private isConnecting = false;

  private disconnectSub: any = null;

  private async connectToDevice(deviceId: string): Promise<void> {
    if (!this.bleManager || this.isConnecting) return;
    this.isConnecting = true;

    try {
      this.bleDevice = await this.bleManager.connectToDevice(deviceId, {
        timeout: 5000, // 5s connection timeout
      });
      await this.bleDevice.discoverAllServicesAndCharacteristics();

      // Request higher MTU for faster chunked transfer (512 = max ESP32 supports)
      try {
        await this.bleDevice.requestMTU(512);
        console.log('[Pendant] MTU negotiated');
      } catch {
        console.log('[Pendant] MTU negotiation skipped');
      }

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

      // Clean up old disconnect listener if it exists
      if (this.disconnectSub) {
        this.disconnectSub.remove();
        this.disconnectSub = null;
      }

      // Monitor disconnection -- start background scan when pendant disconnects
      this.disconnectSub = this.bleDevice.onDisconnected(() => {
        console.log('[Pendant] Disconnected -- starting background scan');
        this.connected = false;
        this.bleDevice = null;
        this.emitConnectionChange(false);
        for (const cb of this.disconnectCbs) cb();
        // Start scanning for pendant to reconnect when it wakes up
        this.startBackgroundScan(deviceId);
      });

      this.deviceId = deviceId;
      this.connected = true;
      this.isConnecting = false;
      this.emitConnectionChange(true);
      await AsyncStorage.setItem(STORAGE_DEVICE_ID, deviceId);
      console.log('[Pendant] Connected to', deviceId);

      // Proactively check if pendant already has data ready
      // (handles case where DATA_READY was signaled before phone connected)
      try {
        const infoChar = await this.bleDevice.readCharacteristicForService(
          PENDANT_SERVICE_UUID,
          DATA_INFO_UUID,
        );
        if (infoChar?.value) {
          const infoStr = atob(infoChar.value);
          if (infoStr && !infoStr.startsWith('none')) {
            console.log('[Pendant] Data already waiting on pendant:', infoStr);
            this.pullDataOverBLE().catch((err) => {
              console.error('[Pendant] Proactive BLE pull failed:', err?.message || err);
            });
          }
        }
      } catch (e: any) {
        // DATA_INFO characteristic may not exist yet (old firmware)
        console.log('[Pendant] DATA_INFO check skipped:', e?.message);
      }
    } catch (err) {
      console.error('[Pendant] Connection error:', err);
      this.connected = false;
      this.isConnecting = false;
      this.bleDevice = null;
      this.emitConnectionChange(false);
      // Pendant is probably asleep -- start scanning so we catch it when it wakes
      this.startBackgroundScan(deviceId);
    }
  }

  /**
   * Background scan for pendant. Runs continuously until the pendant
   * is found and connected. The pendant only advertises briefly after
   * waking from deep sleep, so we need to be actively scanning.
   */
  private backgroundScanActive = false;

  private startBackgroundScan(deviceId: string): void {
    if (!this.bleManager || this.backgroundScanActive) return;
    this.backgroundScanActive = true;

    console.log('[Pendant] Background scan started -- waiting for pendant to wake...');

    this.bleManager.startDeviceScan(
      [PENDANT_SERVICE_UUID],
      { allowDuplicates: true },
      async (error: any, device: any) => {
        if (error) {
          console.warn('[Pendant] Background scan error:', error.message);
          this.backgroundScanActive = false;
          // Retry scan after a delay
          setTimeout(() => this.startBackgroundScan(deviceId), 3000);
          return;
        }

        if (device && (device.id === deviceId || device.name === 'Mittens Pendant')) {
          console.log('[Pendant] Found pendant advertising! Reconnecting...');
          this.bleManager.stopDeviceScan();
          this.backgroundScanActive = false;

          try {
            await this.connectToDevice(device.id);
          } catch (err) {
            console.error('[Pendant] Reconnect failed:', err);
            // Retry scan
            setTimeout(() => this.startBackgroundScan(deviceId), 2000);
          }
        }
      },
    );
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

      // DATA_READY: pendant has captured data, pull it over BLE
      if (signal.type === 'DATA_READY') {
        console.log('[Pendant] Data ready -- pulling over BLE...');
        this.pullDataOverBLE().catch((err) => {
          console.error('[Pendant] BLE data pull failed:', err?.message || err);
        });
      }

      // DOUBLE_TAP and MOTION are also signaled separately for UI feedback
      // Data arrives via DATA_READY flow above
    } catch {
      console.error('[Pendant] BLE signal parse error');
    }
  }

  /**
   * Pull captured data from the pendant over BLE chunked transfer.
   * 1. Read DATA_INFO to get event type + data sizes
   * 2. Subscribe to DATA_STREAM for chunk notifications
   * 3. Write "PULL" to DATA_ACK to start transfer
   * 4. Collect chunks until all bytes received
   * 5. Write "DONE" to DATA_ACK
   * 6. Save to disk and emit event
   */
  private async pullDataOverBLE(): Promise<void> {
    if (!this.bleDevice) {
      console.warn('[Pendant] No BLE device connected, cannot pull data');
      return;
    }

    const FileSystem = require('expo-file-system/legacy');
    const PENDANT_DIR = FileSystem.documentDirectory + 'pendant/';

    // Ensure directory exists
    const dirInfo = await FileSystem.getInfoAsync(PENDANT_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(PENDANT_DIR, { intermediates: true });
    }

    // 1. Read DATA_INFO: "EVENT_TYPE:jpegLen:audioLen"
    const infoChar = await this.bleDevice.readCharacteristicForService(
      PENDANT_SERVICE_UUID,
      DATA_INFO_UUID,
    );

    const infoStr = atob(infoChar.value);
    const [eventType, jpegLenStr, audioLenStr] = infoStr.split(':');
    const jpegLen = parseInt(jpegLenStr, 10) || 0;
    const audioLen = parseInt(audioLenStr, 10) || 0;
    const totalLen = jpegLen + audioLen;

    console.log(`[Pendant] DATA_INFO: type=${eventType} jpeg=${jpegLen} audio=${audioLen} total=${totalLen}`);

    if (totalLen === 0) {
      console.warn('[Pendant] No data to pull');
      return;
    }

    // 2. Set up chunk collection
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    // Create a promise that resolves when all bytes are received
    const transferComplete = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`BLE transfer timeout (received ${receivedBytes}/${totalLen})`));
      }, 30000); // 30s timeout

      // Subscribe to DATA_STREAM notifications
      this.bleDevice.monitorCharacteristicForService(
        PENDANT_SERVICE_UUID,
        DATA_STREAM_UUID,
        (error: any, characteristic: any) => {
          if (error) {
            clearTimeout(timeout);
            reject(error);
            return;
          }

          if (characteristic?.value) {
            // Decode base64 chunk to bytes
            const b64 = characteristic.value;
            const binaryStr = atob(b64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }

            chunks.push(bytes);
            receivedBytes += bytes.length;

            // Log progress every ~5KB
            if (chunks.length % 10 === 0) {
              console.log(`[Pendant] BLE received ${receivedBytes}/${totalLen} bytes (${Math.round(100 * receivedBytes / totalLen)}%)`);
            }

            // Check if we have all data
            if (receivedBytes >= totalLen) {
              clearTimeout(timeout);
              resolve();
            }
          }
        },
      );
    });

    // 3. Send PULL command to start transfer
    await this.bleDevice.writeCharacteristicWithResponseForService(
      PENDANT_SERVICE_UUID,
      DATA_ACK_UUID,
      btoa('PULL'),
    );
    console.log('[Pendant] PULL sent, receiving chunks...');

    // 4. Wait for all data
    await transferComplete;
    console.log(`[Pendant] BLE transfer complete: ${receivedBytes} bytes in ${chunks.length} chunks`);

    // 5. Send DONE acknowledgment
    try {
      await this.bleDevice.writeCharacteristicWithResponseForService(
        PENDANT_SERVICE_UUID,
        DATA_ACK_UUID,
        btoa('DONE'),
      );
    } catch {
      // Pendant may have already disconnected
    }

    // 6. Reassemble data
    const fullData = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      fullData.set(chunk, offset);
      offset += chunk.length;
    }

    // 7. Save JPEG and audio to disk
    const timestamp = Date.now();
    let framePath: string | undefined;
    let audioPath: string | undefined;

    if (jpegLen > 0) {
      const jpegData = fullData.slice(0, jpegLen);
      const frameFileName = `frame_${timestamp}.jpg`;
      framePath = PENDANT_DIR + frameFileName;
      // Convert to base64 for FileSystem
      let binary = '';
      for (let i = 0; i < jpegData.length; i++) {
        binary += String.fromCharCode(jpegData[i]);
      }
      await FileSystem.writeAsStringAsync(framePath, btoa(binary), {
        encoding: FileSystem.EncodingType.Base64,
      });
      console.log(`[Pendant] Frame saved: ${frameFileName} (${jpegLen} bytes)`);
    }

    if (audioLen > 0) {
      const audioData = fullData.slice(jpegLen, jpegLen + audioLen);
      const audioFileName = `audio_${timestamp}.pcm`;
      audioPath = PENDANT_DIR + audioFileName;
      let binary = '';
      for (let i = 0; i < audioData.length; i++) {
        binary += String.fromCharCode(audioData[i]);
      }
      await FileSystem.writeAsStringAsync(audioPath, btoa(binary), {
        encoding: FileSystem.EncodingType.Base64,
      });
      console.log(`[Pendant] Audio saved: ${audioFileName} (${audioLen} bytes)`);
    }

    // 8. Emit event through the standard pendant pipeline
    const event: PendantEvent = {
      type: eventType as PendantEventType,
      timestamp,
      audioPath,
      framePath,
      meta: { type: eventType as PendantEventType, ts: timestamp },
    };

    this.handlePendantEvent(event);
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
