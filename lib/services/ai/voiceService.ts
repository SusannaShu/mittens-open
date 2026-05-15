/**
 * Voice Service -- wraps expo-speech-recognition (STT) and expo-speech (TTS).
 *
 * Provides a clean interface for:
 * - Starting/stopping speech recognition
 * - Speaking Mittens' replies via TTS
 * - Permission management
 */

import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';

/** Request mic + speech recognition permissions. Returns true if granted. */
export async function requestVoicePermissions(): Promise<boolean> {
  const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  return result.granted;
}

/** Check if voice permissions are already granted. */
export async function checkVoicePermissions(): Promise<boolean> {
  const result = await ExpoSpeechRecognitionModule.getPermissionsAsync();
  return result.granted;
}

/** Start speech recognition. Emits interim/final results via events. */
export function startListening() {
  ExpoSpeechRecognitionModule.start({
    lang: 'en-US',
    interimResults: true,
  });
}

/** Stop speech recognition gracefully (returns final result). */
export function stopListening() {
  ExpoSpeechRecognitionModule.stop();
}

/** Abort speech recognition immediately (no final result). */
export function abortListening() {
  ExpoSpeechRecognitionModule.abort();
}

/** Convert raw PCM to WAV with 44-byte header for iOS speech recognition. */
async function convertPcmToWav(pcmPath: string, sampleRate: number = 8000): Promise<string> {
  const FileSystem = require('expo-file-system/legacy');
  const base64js = require('base64-js');
  
  // Clean up "file://" prefix if present to ensure proper FileSystem paths
  const cleanPath = pcmPath.startsWith('file://') ? pcmPath.substring(7) : pcmPath;
  
  const pcmBase64 = await FileSystem.readAsStringAsync(cleanPath, { encoding: FileSystem.EncodingType.Base64 });
  const pcmData = base64js.toByteArray(pcmBase64);
  
  const pcmSize = pcmData.length;
  const numChannels = 1;
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const bitsPerSample = 16;

  const buffer = new ArrayBuffer(44 + pcmSize);
  const view = new DataView(buffer);
  const out = new Uint8Array(buffer);

  // RIFF chunk descriptor
  out.set([82, 73, 70, 70], 0); // "RIFF"
  view.setUint32(4, 36 + pcmSize, true); // ChunkSize
  out.set([87, 65, 86, 69], 8); // "WAVE"

  // fmt sub-chunk
  out.set([102, 109, 116, 32], 12); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample

  // data sub-chunk
  out.set([100, 97, 116, 97], 36); // "data"
  view.setUint32(40, pcmSize, true); // Subchunk2Size

  out.set(pcmData, 44);

  const wavBase64 = base64js.fromByteArray(out);
  const wavPath = cleanPath.replace('.pcm', '.wav');
  await FileSystem.writeAsStringAsync(wavPath, wavBase64, { encoding: FileSystem.EncodingType.Base64 });
  return wavPath;
}

/** Transcribe an audio file offline/online. Returns the recognized text. */
export async function transcribeAudioFile(audioPath: string): Promise<string> {
  const granted = await checkVoicePermissions();
  if (!granted) {
    const requested = await requestVoicePermissions();
    if (!requested) throw new Error('Speech permissions not granted');
  }

  // Apple's STT cannot read raw headless PCM, convert it to WAV first
  let targetPath = audioPath;
  if (targetPath.endsWith('.pcm')) {
    try {
      targetPath = await convertPcmToWav(targetPath);
    } catch (e) {
      console.warn('[VoiceService] Failed to convert PCM to WAV:', e);
    }
  }

  return new Promise((resolve, reject) => {
    let resultListener: any = null;
    let errorListener: any = null;

    const cleanup = () => {
      resultListener?.remove();
      errorListener?.remove();
    };

    resultListener = ExpoSpeechRecognitionModule.addListener('result', (event: any) => {
      if (event.isFinal) {
        cleanup();
        const text = event.results?.[0]?.transcript || '';
        resolve(text);
      }
    });

    errorListener = ExpoSpeechRecognitionModule.addListener('error', (event: any) => {
      cleanup();
      // "no-speech" isn't a hard error if we just captured empty noise
      if (event.error === 'no-speech') resolve('');
      else reject(new Error(event.message || event.error || 'Speech recognition failed'));
    });

    try {
      const uri = targetPath.startsWith('file://') || targetPath.startsWith('http') ? targetPath : `file://${targetPath}`;
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: false,
        audioSource: { uri },
      });
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

/**
 * Strip markdown/formatting from text for cleaner TTS output.
 * Removes **, *, _, `, #, bullet points, etc.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')    // bold
    .replace(/\*(.*?)\*/g, '$1')         // italic
    .replace(/_(.*?)_/g, '$1')           // underscores
    .replace(/`(.*?)`/g, '$1')           // inline code
    .replace(/^#{1,6}\s*/gm, '')         // headings
    .replace(/^[-*]\s+/gm, '')           // bullet points
    .replace(/\n{2,}/g, '. ')            // double newlines to pause
    .replace(/\n/g, ' ')                 // single newlines
    .trim();
}

// ─── Audio Configuration (for native TTS fallback + background playback) ───

let audioConfigured = false;
async function configureAudioForSpeech() {
  if (audioConfigured) return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      interruptionModeIOS: 1, // DoNotMix
      playThroughEarpieceAndroid: false,
    });
    audioConfigured = true;
  } catch (err) {
    console.warn('[VoiceService] Failed to set audio mode:', err);
  }
}

// ─── Background Audio Keepalive ───
//
// iOS suspends audio sessions when the app moves to background. expo-speech
// (AVSpeechSynthesizer) is NOT treated as a media playback source, so iOS
// kills TTS as soon as the screen turns off.
//
// Fix: keep a silent Audio.Sound playing in a loop via expo-av. This forces
// the AVAudioSession category to "playback" with staysActiveInBackground,
// which prevents iOS from suspending the audio pipeline. When Mittens needs
// to speak (via Kokoro or native TTS), it plays over this active session.

let keepaliveSound: Audio.Sound | null = null;
let keepaliveRunning = false;

async function startBackgroundKeepalive() {
  if (keepaliveRunning) return;
  try {
    await configureAudioForSpeech();

    // Generate a ~1 second silent WAV in-memory and load it
    const { Sound } = Audio;
    const sound = new Sound();

    // Use a tiny silent audio source -- 0.5s of silence at 24kHz mono 16-bit
    // Encoded as base64 WAV
    const sampleRate = 24000;
    const durationSec = 0.5;
    const numSamples = sampleRate * durationSec;
    const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample
    const fileSize = 44 + dataSize;

    // Build WAV header
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    // RIFF
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, fileSize - 8, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    // fmt
    view.setUint32(12, 0x666D7420, false); // "fmt "
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    // data
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataSize, true);

    // Combine header + silent samples into a single Uint8Array
    const wav = new Uint8Array(fileSize);
    wav.set(new Uint8Array(header), 0);
    // Samples are all zeros (silence) -- Uint8Array is zero-initialized

    // Write to a temp file so expo-av can load it
    const FileSystem = require('expo-file-system/legacy');
    const base64js = require('base64-js');
    const silentPath = FileSystem.cacheDirectory + 'silence_keepalive.wav';
    const b64 = base64js.fromByteArray(wav);
    await FileSystem.writeAsStringAsync(silentPath, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    await sound.loadAsync({ uri: silentPath }, {
      isLooping: true,
      volume: 0.01, // Nearly inaudible
      shouldPlay: true,
    });

    keepaliveSound = sound;
    keepaliveRunning = true;
    console.log('[VoiceService] Background audio keepalive started.');
  } catch (err: any) {
    console.warn('[VoiceService] Keepalive start failed:', err?.message);
  }
}

async function stopBackgroundKeepalive() {
  if (!keepaliveRunning || !keepaliveSound) return;
  try {
    await keepaliveSound.stopAsync();
    await keepaliveSound.unloadAsync();
  } catch { /* best effort */ }
  keepaliveSound = null;
  keepaliveRunning = false;
  console.log('[VoiceService] Background audio keepalive stopped.');
}

// ─── Kokoro Integration ───

let kokoroModule: typeof import('./kokoroVoice') | null = null;

/** Initialize the voice system. Call once at app boot. */
export async function initVoice(): Promise<void> {
  await configureAudioForSpeech();

  // Start background keepalive for screen-off TTS
  startBackgroundKeepalive();

  // Listen for app state changes to manage keepalive
  try {
    const { AppState } = require('react-native');
    AppState.addEventListener('change', (state: string) => {
      if (state === 'active') {
        // Re-ensure keepalive when returning to foreground
        if (!keepaliveRunning) startBackgroundKeepalive();
      }
    });
  } catch { /* AppState listener is best-effort */ }

  try {
    kokoroModule = require('./kokoroVoice');
    const ready = await kokoroModule!.initKokoro();
    if (ready) {
      console.log('[VoiceService] Kokoro neural voice ready.');
    } else {
      console.log('[VoiceService] Kokoro unavailable, using native TTS fallback.');
      kokoroModule = null;
    }
  } catch (err: any) {
    console.warn('[VoiceService] Kokoro module failed to load:', err?.message);
    kokoroModule = null;
  }
}

// ─── Speak ───

/**
 * Speak text. Tries Kokoro on-device neural voice first.
 * Falls back to native iOS/Android TTS if Kokoro is unavailable.
 */
export function speak(text: string, onDone?: () => void) {
  const clean = stripMarkdown(text);
  if (!clean) return;

  configureAudioForSpeech().then(async () => {
    // Try Kokoro neural voice first
    if (kokoroModule && kokoroModule.isKokoroReady()) {
      try {
        const success = await kokoroModule.speakKokoro(clean, onDone);
        if (success) return;
      } catch (err: any) {
        console.warn('[VoiceService] Kokoro speak failed, falling back:', err?.message);
      }
    }

    // Fallback: native iOS/Android TTS
    Speech.speak(clean, {
      language: 'en-US',
      rate: 1.05,
      pitch: 1.05,
      onDone,
      onStopped: onDone,
      onError: onDone,
    });
  });
}

/** Stop any currently playing TTS. */
export function stopSpeaking() {
  // Stop Kokoro audio
  try {
    kokoroModule?.stopKokoro();
  } catch { /* best effort */ }
  // Stop native TTS
  Speech.stop();
}

/** Check if TTS is currently speaking. */
export async function isSpeaking(): Promise<boolean> {
  return Speech.isSpeakingAsync();
}

// Re-export the event hook for components to use directly
export { useSpeechRecognitionEvent };

