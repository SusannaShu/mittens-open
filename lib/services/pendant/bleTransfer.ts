/**
 * pendant/bleTransfer.ts -- BLE chunked data transfer from pendant.
 *
 * Extracted from pendantService.ts to keep files under 400 lines.
 * Handles the full BLE pull sequence:
 *   1. Read DATA_INFO to get event type + data sizes
 *   2. Subscribe to DATA_STREAM for chunk notifications
 *   3. Write "PULL" to DATA_ACK to start transfer
 *   4. Collect chunks until all bytes received (with adaptive timeout)
 *   5. Write "DONE" to DATA_ACK
 *   6. Save JPEG + audio to disk
 *
 * Adaptive timeout strategy:
 *   - 60s overall timeout
 *   - 15s watchdog that resets on each received chunk
 *   - Partial saves: if 80%+ JPEG data received on timeout, save anyway
 */

import {
  PENDANT_SERVICE_UUID,
  DATA_INFO_UUID,
  DATA_STREAM_UUID,
  DATA_ACK_UUID,
} from './pendantProtocol';
import type { PendantEvent, PendantEventType } from './pendantProtocol';

// --- Types ---

export interface BleTransferResult {
  event: PendantEvent;
  receivedBytes: number;
  totalBytes: number;
  partial: boolean;
}

// --- Pull State ---

let isPulling = false;
let currentPullReject: ((err: Error) => void) | null = null;

export function getIsPulling(): boolean {
  return isPulling;
}

/**
 * Abort the current BLE pull if one is in progress.
 * Returns a promise that resolves when cleanup is done.
 */
export async function abortCurrentPull(): Promise<void> {
  if (!isPulling) return;
  if (currentPullReject) {
    currentPullReject(new Error('Pull aborted by new request'));
    currentPullReject = null;
  }
  let waitCount = 0;
  while (isPulling && waitCount < 10) {
    await new Promise(r => setTimeout(r, 100));
    waitCount++;
  }
}

// --- Main Transfer ---

/**
 * Pull captured data from the pendant over BLE chunked transfer.
 * Saves JPEG and audio files to the pendant directory.
 */
export async function pullDataOverBLE(bleDevice: any): Promise<BleTransferResult> {
  if (!bleDevice) {
    throw new Error('No BLE device connected');
  }

  if (isPulling) {
    console.log('[BLE Transfer] Pull already in progress, aborting old pull');
    await abortCurrentPull();
  }
  isPulling = true;

  let streamSub: any = null;

  try {
    const FileSystem = require('expo-file-system/legacy');
    const PENDANT_DIR = FileSystem.documentDirectory + 'pendant/';

    // Ensure directory exists
    const dirInfo = await FileSystem.getInfoAsync(PENDANT_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(PENDANT_DIR, { intermediates: true });
    }

    // 1. Read DATA_INFO: "EVENT_TYPE:jpegLen:audioLen"
    const infoChar = await bleDevice.readCharacteristicForService(
      PENDANT_SERVICE_UUID,
      DATA_INFO_UUID,
    );

    const infoStr = atob(infoChar.value);
    const [eventType, jpegLenStr, audioLenStr] = infoStr.split(':');
    const jpegLen = parseInt(jpegLenStr, 10) || 0;
    const audioLen = parseInt(audioLenStr, 10) || 0;
    const totalLen = jpegLen + audioLen;

    console.log(`[BLE Transfer] DATA_INFO: type=${eventType} jpeg=${jpegLen} audio=${audioLen} total=${totalLen}`);

    if (totalLen === 0) {
      throw new Error('No data to pull');
    }

    // 2. Collect chunks
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    let partial = false;

    const transferComplete = new Promise<void>((resolve, reject) => {
      currentPullReject = reject;

      // Adaptive timeout: 60s overall, resets a 15s watchdog on each chunk
      const overallTimeout = setTimeout(() => {
        if (jpegLen > 0 && receivedBytes >= jpegLen * 0.8) {
          console.warn(`[BLE Transfer] Partial (${receivedBytes}/${totalLen}), saving partial JPEG`);
          partial = true;
          resolve();
        } else {
          reject(new Error(`BLE transfer timeout (received ${receivedBytes}/${totalLen})`));
        }
      }, 60000);

      let watchdog: ReturnType<typeof setTimeout> | null = null;
      const resetWatchdog = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          clearTimeout(overallTimeout);
          if (jpegLen > 0 && receivedBytes >= jpegLen * 0.8) {
            console.warn(`[BLE Transfer] Stall after ${receivedBytes}/${totalLen} bytes, saving partial`);
            partial = true;
            resolve();
          } else {
            reject(new Error(`BLE transfer timeout (received ${receivedBytes}/${totalLen})`));
          }
        }, 15000);
      };
      resetWatchdog();

      streamSub = bleDevice.monitorCharacteristicForService(
        PENDANT_SERVICE_UUID,
        DATA_STREAM_UUID,
        (error: any, characteristic: any) => {
          if (error) {
            clearTimeout(overallTimeout);
            if (watchdog) clearTimeout(watchdog);
            reject(error);
            return;
          }

          if (characteristic?.value) {
            const b64 = characteristic.value;
            const binaryStr = atob(b64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }

            chunks.push(bytes);
            receivedBytes += bytes.length;
            resetWatchdog();

            if (chunks.length % 50 === 0) {
              console.log(`[BLE Transfer] ${receivedBytes}/${totalLen} bytes (${Math.round(100 * receivedBytes / totalLen)}%)`);
            }

            if (receivedBytes >= totalLen) {
              clearTimeout(overallTimeout);
              if (watchdog) clearTimeout(watchdog);
              resolve();
            }
          }
        },
      );
    });

    // 3. Send PULL command
    await bleDevice.writeCharacteristicWithResponseForService(
      PENDANT_SERVICE_UUID,
      DATA_ACK_UUID,
      btoa('PULL'),
    );
    console.log('[BLE Transfer] PULL sent, receiving chunks...');

    // 4. Wait for transfer
    await transferComplete;
    console.log(`[BLE Transfer] Complete: ${receivedBytes} bytes in ${chunks.length} chunks${partial ? ' (partial)' : ''}`);

    // 5. Cancel subscription
    if (streamSub) {
      streamSub.remove();
      streamSub = null;
    }

    // 6. Send DONE
    try {
      await bleDevice.writeCharacteristicWithResponseForService(
        PENDANT_SERVICE_UUID,
        DATA_ACK_UUID,
        btoa('DONE'),
      );
    } catch {
      // Pendant may have already disconnected
    }

    // 7. Reassemble data
    const fullData = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      fullData.set(chunk, offset);
      offset += chunk.length;
    }

    // 8. Save files
    const timestamp = Date.now();
    let framePath: string | undefined;
    let audioPath: string | undefined;

    // Save JPEG (use minimum of jpegLen and receivedBytes for partial transfers)
    const availableJpeg = Math.min(jpegLen, receivedBytes);
    if (availableJpeg > 0) {
      const jpegData = fullData.slice(0, availableJpeg);
      const frameFileName = `frame_${timestamp}.jpg`;
      framePath = PENDANT_DIR + frameFileName;
      let binary = '';
      for (let i = 0; i < jpegData.length; i++) {
        binary += String.fromCharCode(jpegData[i]);
      }
      await FileSystem.writeAsStringAsync(framePath, btoa(binary), {
        encoding: FileSystem.EncodingType.Base64,
      });
      console.log(`[BLE Transfer] Frame saved: ${frameFileName} (${availableJpeg} bytes${partial ? ', partial' : ''})`);
    }

    // Save audio (only if we have full JPEG data + audio bytes)
    if (audioLen > 0 && receivedBytes >= jpegLen + audioLen) {
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
      console.log(`[BLE Transfer] Audio saved: ${audioFileName} (${audioLen} bytes)`);
    }

    // 9. Build event
    const event: PendantEvent = {
      type: eventType as PendantEventType,
      timestamp,
      audioPath,
      framePath,
      meta: { type: eventType as PendantEventType, ts: timestamp },
    };

    return { event, receivedBytes, totalBytes: totalLen, partial };
  } finally {
    if (streamSub) {
      streamSub.remove();
    }
    isPulling = false;
    currentPullReject = null;
  }
}
