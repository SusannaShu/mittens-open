import * as FileSystem from 'expo-file-system';

// Safe Base64 <-> Uint8Array conversion
function bytesToBase64(bytes: Uint8Array): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let base64 = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    base64 += chars[(chunk & 16515072) >> 18] + chars[(chunk & 258048) >> 12] +
              (i + 1 < bytes.length ? chars[(chunk & 4032) >> 6] : "=") +
              (i + 2 < bytes.length ? chars[chunk & 63] : "=");
  }
  return base64;
}

function base64ToBytes(base64: string): Uint8Array {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  let bufferLength = base64.length * 0.75,
  len = base64.length, i = 0, p = 0;
  if (base64[base64.length - 1] === "=") { bufferLength--; if (base64[base64.length - 2] === "=") bufferLength--; }
  const bytes = new Uint8Array(bufferLength);
  for (i = 0; i < len; i += 4) {
    const encoded1 = lookup[base64.charCodeAt(i)];
    const encoded2 = lookup[base64.charCodeAt(i+1)];
    const encoded3 = lookup[base64.charCodeAt(i+2)];
    const encoded4 = lookup[base64.charCodeAt(i+3)];
    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (encoded3 !== undefined) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    if (encoded4 !== undefined) bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
  }
  return bytes;
}

/**
 * Converts a raw PCM file to a playable WAV file by writing a 44-byte WAV header.
 * Designed for 16kHz, mono, 16-bit PCM (from Mittens pendant).
 * Returns the URI of the newly created WAV file.
 */
export async function convertPcmToWav(pcmPath: string, sampleRate = 16000): Promise<string> {
  const pcmUri = pcmPath.startsWith('file://') ? pcmPath : `file://${pcmPath}`;
  const wavPath = pcmUri.replace('.pcm', '_play.wav');

  // Check if WAV already exists
  const wavInfo = await FileSystem.getInfoAsync(wavPath);
  if (wavInfo.exists) {
    return wavPath;
  }

  // Read PCM data as base64
  const pcmBase64 = await FileSystem.readAsStringAsync(pcmUri, {
    encoding: FileSystem.EncodingType.Base64
  });

  // Convert base64 to byte array
  const pcmBytes = base64ToBytes(pcmBase64);
  const dataLen = pcmBytes.length;

  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;

  // 44-byte WAV header
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);

  // RIFF chunk descriptor
  header.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, 36 + dataLen, true);
  header.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"

  // fmt sub-chunk
  header.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  header.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, dataLen, true);

  // Combine header and PCM data
  const combinedBytes = new Uint8Array(44 + dataLen);
  combinedBytes.set(header, 0);
  combinedBytes.set(pcmBytes, 44);

  const wavBase64 = bytesToBase64(combinedBytes);

  await FileSystem.writeAsStringAsync(wavPath, wavBase64, {
    encoding: FileSystem.EncodingType.Base64
  });

  return wavPath;
}
