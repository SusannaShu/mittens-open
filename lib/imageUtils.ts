/**
 * Image optimization utilities for Mittens.
 *
 * Different brains have different optimal image sizes:
 *   - E2B (Gemma/LiteRT):  supports 70-1120 token budgets (384px to 768px)
 *   - LlamaRN (Gemma 3):  text-only model, resize still useful for cloud fallback
 *   - Cloud APIs:           accept large images, resize server-side
 *
 * We resize to reduce latency and memory, not because models can't handle larger.
 * On comfort tier (8GB+), we use 768px for better detail.
 * On balanced/lite tiers, we use 512px (smaller models benefit from focused input).
 *
 * Uses lazy requires to avoid crashing at startup if the native module isn't ready.
 */

const UPLOAD_SIZE = 800;

/** Get the optimal vision size based on active tier */
async function getVisionSize(): Promise<number> {
  try {
    const { getActiveTier } = require('./services/ai/tierSelector');
    const tier = await getActiveTier();
    // Comfort: 768px for Gemma's higher token budget
    // Standard/Lite: 512px -- Gemma 3 1B is text-only, but kept for cloud fallback
    return tier === 'comfort' ? 768 : 512;
  } catch {
    return 512; // fallback
  }
}

/** Resize an image for on-device vision. Returns local file URI. */
export async function resizeForVision(uri: string): Promise<string> {
  const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');
  const size = await getVisionSize();
  const result = await manipulateAsync(
    uri,
    [{ resize: { width: size } }],
    { compress: 0.85, format: SaveFormat.JPEG }
  );
  return result.uri;
}

/** Resize an image URI to 800x800 for cloud uploads. Returns local file URI. */
export async function resizeForUpload(uri: string): Promise<string> {
  const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');
  const result = await manipulateAsync(
    uri,
    [{ resize: { width: UPLOAD_SIZE, height: UPLOAD_SIZE } }],
    { compress: 0.8, format: SaveFormat.JPEG }
  );
  return result.uri;
}

/** Resize a base64 image for vision. Returns base64 string (no prefix). */
export async function resizeBase64ForVision(base64: string): Promise<string> {
  const FileSystem = require('expo-file-system/legacy');
  const tmpPath = FileSystem.cacheDirectory + `vision_tmp_${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(tmpPath, base64, { encoding: FileSystem.EncodingType.Base64 });
  const resized = await resizeForVision(tmpPath);
  const resizedBase64 = await FileSystem.readAsStringAsync(resized, { encoding: FileSystem.EncodingType.Base64 });
  FileSystem.deleteAsync(tmpPath, { idempotent: true }).catch(() => {});
  FileSystem.deleteAsync(resized, { idempotent: true }).catch(() => {});
  return resizedBase64;
}

/** Resize a base64 image to 800x800 for upload. Returns base64 string (no prefix). */
export async function resizeBase64ForUpload(base64: string): Promise<string> {
  const FileSystem = require('expo-file-system/legacy');
  const tmpPath = FileSystem.cacheDirectory + `upload_tmp_${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(tmpPath, base64, { encoding: FileSystem.EncodingType.Base64 });
  const resized = await resizeForUpload(tmpPath);
  const resizedBase64 = await FileSystem.readAsStringAsync(resized, { encoding: FileSystem.EncodingType.Base64 });
  FileSystem.deleteAsync(tmpPath, { idempotent: true }).catch(() => {});
  FileSystem.deleteAsync(resized, { idempotent: true }).catch(() => {});
  return resizedBase64;
}
