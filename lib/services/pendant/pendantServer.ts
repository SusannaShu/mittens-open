/**
 * Pendant Server -- lightweight HTTP server to receive data from the pendant.
 *
 * Uses react-native-tcp-socket to create a raw TCP server.
 * Socket data arrives as strings; we parse HTTP manually.
 *
 * NOTE: All TCP/Buffer usage is lazy-loaded inside start() to avoid
 * crashing on import in environments where the native module isn't ready.
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { PendantEventMeta, PendantEvent } from './pendantProtocol';
import { PENDANT_HTTP_PORT } from './pendantProtocol';

const PENDANT_DIR = FileSystem.documentDirectory + 'pendant/';

type EventCallback = (event: PendantEvent) => void;

export class PendantServer {
  private server: any = null;
  private running = false;
  private eventCallbacks: EventCallback[] = [];

  /** Start the HTTP server on the pendant port. */
  async start(): Promise<void> {
    if (this.running) return;

    // Ensure pendant directory exists
    const dirInfo = await FileSystem.getInfoAsync(PENDANT_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(PENDANT_DIR, { intermediates: true });
    }

    try {
      // Lazy require -- react-native-tcp-socket may not be installed
      let TcpSocket: any;
      try {
        const tcpModule = require('react-native-tcp-socket');
        TcpSocket = tcpModule.default || tcpModule;
      } catch {
        console.warn('[PendantServer] react-native-tcp-socket not installed, server will not listen');
        this.running = true;
        return;
      }

      this.server = TcpSocket.createServer((socket: any) => {
        const chunks: Uint8Array[] = [];

        // No encoding means we get raw Buffers (Uint8Array)
        socket.on('data', (data: Uint8Array) => {
          chunks.push(data);
        });

        socket.on('end', () => {
          const totalLength = chunks.reduce((acc, val) => acc + val.length, 0);
          const raw = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            raw.set(chunk, offset);
            offset += chunk.length;
          }
          this.handleHttpRequest(raw, socket);
        });

        socket.on('error', (err: any) => {
          console.error('[PendantServer] Socket error:', err?.message);
        });

        // Timeout after 60 seconds for slow connections
        socket.setTimeout(60000);
        socket.on('timeout', () => {
          if (chunks.length > 0) {
            const totalLength = chunks.reduce((acc, val) => acc + val.length, 0);
            const raw = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
              raw.set(chunk, offset);
              offset += chunk.length;
            }
            this.handleHttpRequest(raw, socket);
          }
          socket.destroy();
        });
      });

      // iOS 14+ Local Network Privacy Trigger
      // Passive listen() or low-level TCP might not trigger the OS permission dialog.
      // We use a high-level fetch to the local gateway to force iOS to ask.
      try {
        console.log('[PendantServer] Triggering Local Network Privacy dialog via fetch...');
        fetch('http://172.20.10.1', { method: 'HEAD', mode: 'no-cors' }).catch(() => {});
      } catch (e) {
        // Ignore fetch error
      }

      console.log(`[PendantServer] Attempting to listen on port ${PENDANT_HTTP_PORT}...`);
      this.server.listen({ port: PENDANT_HTTP_PORT, host: '0.0.0.0' }, () => {
        this.running = true;
        console.log(`[PendantServer] Listening on port ${PENDANT_HTTP_PORT}`);
      });
      console.log(`[PendantServer] listen() called synchronously`);

      this.server.on('error', (err: any) => {
        console.error('[PendantServer] Server error:', err?.message);
      });
    } catch (err: any) {
      console.warn('[PendantServer] TCP library not available:', err?.message);
      this.running = true; // Mark running so service layer works with mock data
    }
  }

  /** Stop the HTTP server. */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.running = false;
    console.log('[PendantServer] Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Register a callback for incoming pendant events. */
  onEvent(callback: EventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      this.eventCallbacks = this.eventCallbacks.filter(cb => cb !== callback);
    };
  }

  // ─── HTTP Parsing ───

  private bytesToString(bytes: Uint8Array, start: number, end: number): string {
    let s = '';
    for (let i = start; i < end; i++) {
      s += String.fromCharCode(bytes[i]);
    }
    return s;
  }

  private findSequence(data: Uint8Array, seq: number[], fromIndex = 0): number {
    for (let i = fromIndex; i <= data.length - seq.length; i++) {
      let found = true;
      for (let j = 0; j < seq.length; j++) {
        if (data[i + j] !== seq[j]) { found = false; break; }
      }
      if (found) return i;
    }
    return -1;
  }

  private handleHttpRequest(raw: Uint8Array, socket: any): void {
    try {
      // Find header/body separator: \r\n\r\n
      const headerEnd = this.findSequence(raw, [0x0D, 0x0A, 0x0D, 0x0A]);
      if (headerEnd === -1) {
        this.sendResponse(socket, 400, 'Bad request');
        return;
      }

      const headers = this.bytesToString(raw, 0, headerEnd);

      // Extract boundary from Content-Type
      const boundaryMatch = headers.match(/boundary=([^\r\n;]+)/);
      if (!boundaryMatch) {
        // Not multipart -- try simple JSON POST
        const body = this.bytesToString(raw, headerEnd + 4, raw.length);
        try {
          const meta = JSON.parse(body) as PendantEventMeta;
          this.handleIncomingEvent(meta);
          this.sendResponse(socket, 200, '{"ok":true}');
        } catch {
          this.sendResponse(socket, 400, 'Invalid body');
        }
        return;
      }

      const boundary = boundaryMatch[1].trim();
      const body = raw.slice(headerEnd + 4);

      // Parse multipart parts
      const parts = this.parseMultipart(body, boundary);

      let meta: PendantEventMeta | undefined;
      let audioData: Uint8Array | undefined;
      let frameData: Uint8Array | undefined;

      for (const part of parts) {
        if (part.name === 'meta') {
          const jsonStr = this.bytesToString(part.data, 0, part.data.length);
          meta = JSON.parse(jsonStr);
        } else if (part.name === 'audio') {
          audioData = part.data;
        } else if (part.name === 'frame') {
          frameData = part.data;
        }
      }

      if (meta) {
        this.handleIncomingEvent(meta, audioData, frameData);
        this.sendResponse(socket, 200, '{"ok":true}');
      } else {
        this.sendResponse(socket, 400, 'Missing meta');
      }
    } catch (err: any) {
      console.error('[PendantServer] Request parse error:', err?.message);
      this.sendResponse(socket, 500, 'Server error');
    }
  }

  private parseMultipart(body: Uint8Array, boundary: string): Array<{ name: string; data: Uint8Array }> {
    const parts: Array<{ name: string; data: Uint8Array }> = [];
    const boundaryStr = '--' + boundary;
    const boundaryBytes = new Uint8Array(boundaryStr.length);
    for (let i = 0; i < boundaryStr.length; i++) {
      boundaryBytes[i] = boundaryStr.charCodeAt(i);
    }

    // Find all boundary positions
    const positions: number[] = [];
    let searchFrom = 0;
    while (searchFrom < body.length) {
      const idx = this.findSequence(body, Array.from(boundaryBytes), searchFrom);
      if (idx === -1) break;
      positions.push(idx);
      searchFrom = idx + boundaryBytes.length;
    }

    for (let p = 0; p < positions.length - 1; p++) {
      const start = positions[p] + boundaryBytes.length;
      const end = positions[p + 1];

      const partSlice = body.slice(start, end);

      // Find header/body separator in this part
      const sepIdx = this.findSequence(partSlice, [0x0D, 0x0A, 0x0D, 0x0A]);
      if (sepIdx === -1) continue;

      const headerStr = this.bytesToString(partSlice, 0, sepIdx);
      const dataStart = sepIdx + 4;
      let dataEnd = partSlice.length;
      // Trim trailing CRLF before next boundary
      if (dataEnd >= 2 && partSlice[dataEnd - 2] === 0x0D && partSlice[dataEnd - 1] === 0x0A) {
        dataEnd -= 2;
      }

      const nameMatch = headerStr.match(/name="([^"]+)"/);
      if (nameMatch) {
        parts.push({
          name: nameMatch[1],
          data: partSlice.slice(dataStart, dataEnd),
        });
      }
    }

    return parts;
  }

  private sendResponse(socket: any, status: number, body: string): void {
    const statusText = status === 200 ? 'OK' : status === 400 ? 'Bad Request' : 'Error';
    const response = [
      `HTTP/1.1 ${status} ${statusText}`,
      'Content-Type: application/json',
      `Content-Length: ${body.length}`,
      'Connection: close',
      '',
      body,
    ].join('\r\n');

    try {
      socket.write(response);
      socket.destroy();
    } catch {
      // Socket may already be closed
    }
  }

  // ─── Event Handling ───

  /**
   * Handle an incoming pendant event.
   * Saves audio/frame to disk and emits the event.
   * Public so it can be called for testing or from BLE fallback.
   */
  async handleIncomingEvent(
    meta: PendantEventMeta,
    audioData?: Uint8Array,
    frameData?: Uint8Array,
  ): Promise<void> {
    const timestamp = Date.now();
    let audioPath: string | undefined;
    let framePath: string | undefined;

    // Save audio to disk
    if (audioData && audioData.length > 0) {
      const audioFileName = `audio_${timestamp}.pcm`;
      audioPath = PENDANT_DIR + audioFileName;
      const base64 = this.uint8ToBase64(audioData);
      await FileSystem.writeAsStringAsync(audioPath, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      console.log(`[PendantServer] Audio saved: ${audioFileName} (${audioData.length} bytes)`);
    }

    // Save frame to disk
    if (frameData && frameData.length > 0) {
      const frameFileName = `frame_${timestamp}.jpg`;
      framePath = PENDANT_DIR + frameFileName;
      const base64 = this.uint8ToBase64(frameData);
      await FileSystem.writeAsStringAsync(framePath, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      console.log(`[PendantServer] Frame saved: ${frameFileName} (${frameData.length} bytes)`);
    }

    // Emit event
    const event: PendantEvent = {
      type: meta.type,
      timestamp,
      audioPath,
      framePath,
      meta,
    };

    console.log(`[PendantServer] Emitting event: ${event.type}`);
    for (const cb of this.eventCallbacks) {
      try {
        cb(event);
      } catch (err) {
        console.error('[PendantServer] Event callback error:', err);
      }
    }
  }

  private uint8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /** Clean up old pendant files (older than 1 hour). */
  async cleanup(): Promise<void> {
    try {
      const files = await FileSystem.readDirectoryAsync(PENDANT_DIR);
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      for (const file of files) {
        const tsMatch = file.match(/_(\d+)\./);
        if (tsMatch) {
          const fileTs = parseInt(tsMatch[1], 10);
          if (fileTs < oneHourAgo) {
            await FileSystem.deleteAsync(PENDANT_DIR + file, { idempotent: true });
          }
        }
      }
    } catch {
      // Non-blocking
    }
  }
}
