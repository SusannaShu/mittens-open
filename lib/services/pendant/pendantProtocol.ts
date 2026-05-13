/**
 * Pendant Protocol -- BLE UUIDs, event types, HTTP config, and helpers.
 *
 * Shared constants between the pendant firmware and the React Native app.
 * Keep in sync with pendant_main.ino.
 */

// ─── BLE UUIDs ───

export const PENDANT_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const EVENT_SIGNAL_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
export const COMMAND_UUID = '6e400004-b5a3-f393-e0a9-e50e24dcca9e';

// BLE chunked data transfer (added for WiFi-free operation)
export const DATA_INFO_UUID = '6e400005-b5a3-f393-e0a9-e50e24dcca9e';
export const DATA_STREAM_UUID = '6e400006-b5a3-f393-e0a9-e50e24dcca9e';
export const DATA_ACK_UUID = '6e400007-b5a3-f393-e0a9-e50e24dcca9e';

// ─── Event Types ───

export type PendantEventType = 'BUTTON_PRESS' | 'SINGLE_TAP' | 'TRIPLE_TAP' | 'MOTION';

export interface PendantEventMeta {
  type: PendantEventType;
  ts: number;
  wake?: number;
  audioRate?: number;
  audioChannels?: number;
}

// ─── HTTP Server Config ───

export const PENDANT_HTTP_PORT = 8742;
export const PENDANT_ENDPOINT = '/pendant/event';

// iOS personal hotspot default gateway IP
export const IOS_HOTSPOT_IP = '172.20.10.1';

// ─── Pendant Event (after data assembly) ───

export interface PendantEvent {
  type: PendantEventType;
  timestamp: number;
  audioPath?: string;   // file:// path to saved PCM audio
  framePath?: string;   // file:// path to saved JPEG frame
  meta: PendantEventMeta;
}

// ─── BLE Command Builders ───

/**
 * Build a WiFi credentials command string for the pendant.
 * Format: "wifi:SSID:PASSWORD:PHONE_IP"
 */
export function buildWifiCredentialCommand(
  ssid: string,
  password: string,
  phoneIP: string = IOS_HOTSPOT_IP,
): string {
  return `wifi:${ssid}:${password}:${phoneIP}`;
}

// ─── Multipart Parser ───

/**
 * Parse a simple multipart/form-data body.
 * Returns a map of field name -> { data, filename, contentType }.
 *
 * This is a minimal parser for the pendant's simple multipart format.
 * The pendant sends: meta (JSON), audio (PCM binary), frame (JPEG binary).
 */
export interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  data: ArrayBuffer;
}

export function parseMultipart(body: ArrayBuffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const bodyBytes = new Uint8Array(body);
  const boundaryBytes = new TextEncoder().encode('--' + boundary);

  // Find all boundary positions
  const positions: number[] = [];
  for (let i = 0; i <= bodyBytes.length - boundaryBytes.length; i++) {
    let match = true;
    for (let j = 0; j < boundaryBytes.length; j++) {
      if (bodyBytes[i + j] !== boundaryBytes[j]) {
        match = false;
        break;
      }
    }
    if (match) positions.push(i);
  }

  for (let p = 0; p < positions.length - 1; p++) {
    const start = positions[p] + boundaryBytes.length;
    const end = positions[p + 1];

    // Find the blank line separating headers from body (CRLFCRLF)
    let headerEnd = -1;
    for (let i = start; i < end - 3; i++) {
      if (bodyBytes[i] === 0x0D && bodyBytes[i + 1] === 0x0A &&
        bodyBytes[i + 2] === 0x0D && bodyBytes[i + 3] === 0x0A) {
        headerEnd = i;
        break;
      }
    }
    if (headerEnd === -1) continue;

    const headerStr = new TextDecoder().decode(bodyBytes.slice(start, headerEnd));
    const dataStart = headerEnd + 4;
    // Trim trailing CRLF before next boundary
    let dataEnd = end;
    if (bodyBytes[dataEnd - 2] === 0x0D && bodyBytes[dataEnd - 1] === 0x0A) {
      dataEnd -= 2;
    }

    // Parse headers
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch = headerStr.match(/Content-Type:\s*(\S+)/i);

    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: filenameMatch?.[1],
        contentType: ctMatch?.[1],
        data: bodyBytes.slice(dataStart, dataEnd).buffer,
      });
    }
  }

  return parts;
}
