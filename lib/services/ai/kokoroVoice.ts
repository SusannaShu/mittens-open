/**
 * Kokoro Voice -- On-device neural TTS via react-native-executorch.
 *
 * Wraps the Kokoro model (82M params) for natural-sounding speech synthesis.
 * Runs 100% on-device: no internet, no API keys, no per-request cost.
 *
 * Uses react-native-audio-api (Web Audio API) for waveform playback.
 * Falls back gracefully if model is not loaded or device cannot run it.
 */

// ─── Available Voices ───

export type KokoroVoiceId =
  | 'af_heart'
  | 'af_river'
  | 'af_sarah'
  | 'bf_emma'
  | 'am_adam'
  | 'am_michael'
  | 'am_santa'
  | 'bm_daniel';

export interface KokoroVoiceOption {
  id: KokoroVoiceId;
  label: string;
  gender: 'female' | 'male';
  style: string;
}

export const KOKORO_VOICES: KokoroVoiceOption[] = [
  { id: 'af_heart', label: 'Heart', gender: 'female', style: 'Warm, conversational' },
  { id: 'af_river', label: 'River', gender: 'female', style: 'Friendly, upbeat' },
  { id: 'af_sarah', label: 'Sarah', gender: 'female', style: 'Neutral, clear' },
  { id: 'bf_emma', label: 'Emma (GB)', gender: 'female', style: 'British, elegant' },
  { id: 'am_adam', label: 'Adam', gender: 'male', style: 'Confident, strong' },
  { id: 'am_michael', label: 'Michael', gender: 'male', style: 'Smooth, relaxed' },
  { id: 'am_santa', label: 'Santa', gender: 'male', style: 'Deep, warm' },
  { id: 'bm_daniel', label: 'Daniel (GB)', gender: 'male', style: 'British, formal' },
];

export const DEFAULT_VOICE: KokoroVoiceId = 'af_river';

// ─── Voice Constant Mapping ───

/**
 * Maps our voice ID strings to the react-native-executorch constants.
 * These constants are URLs to the voice style files on HuggingFace.
 */
function getVoiceConstant(voiceId: KokoroVoiceId): any {
  try {
    const ET = require('react-native-executorch');
    const map: Record<string, any> = {
      af_heart: ET.KOKORO_VOICE_AF_HEART,
      af_river: ET.KOKORO_VOICE_AF_RIVER,
      af_sarah: ET.KOKORO_VOICE_AF_SARAH,
      bf_emma: ET.KOKORO_VOICE_BF_EMMA,
      am_adam: ET.KOKORO_VOICE_AM_ADAM,
      am_michael: ET.KOKORO_VOICE_AM_MICHAEL,
      am_santa: ET.KOKORO_VOICE_AM_SANTA,
      bm_daniel: ET.KOKORO_VOICE_BM_DANIEL,
    };
    return map[voiceId] || ET.KOKORO_VOICE_AF_HEART;
  } catch {
    return voiceId;
  }
}

function getModelConstant(): any {
  try {
    const ET = require('react-native-executorch');
    return ET.KOKORO_MEDIUM;
  } catch {
    return 'kokoro_medium';
  }
}

// ─── State ───

let currentVoice: KokoroVoiceId = DEFAULT_VOICE;
let kokoroReady = false;
let kokoroFailed = false;
let ttsModule: any = null;
let audioCtx: any = null;
let activeSource: any = null;

// ─── Configuration ───

/** Set the active Kokoro voice. Returns a Promise that resolves when the module is ready. */
export async function setKokoroVoice(voiceId: KokoroVoiceId): Promise<void> {
  currentVoice = voiceId;
  console.log(`[KokoroVoice] Voice set to: ${voiceId}`);
  // If the voice changes, we need to reload the TTS module with the new voice
  if (ttsModule || kokoroReady) {
    await reloadTtsModule();
  }
}

/** Get the current voice ID. */
export function getKokoroVoice(): KokoroVoiceId {
  return currentVoice;
}

/** Check if Kokoro is ready for synthesis. */
export function isKokoroReady(): boolean {
  return kokoroReady && !kokoroFailed;
}

// ─── TTS Module Management ───

/** Load or reload the TTS module with current voice settings. */
async function reloadTtsModule(): Promise<boolean> {
  try {
    // Clean up previous instance
    if (ttsModule) {
      try { ttsModule.delete(); } catch { /* best effort */ }
      ttsModule = null;
    }

    const { TextToSpeechModule } = require('react-native-executorch');
    const model = getModelConstant();
    const voice = getVoiceConstant(currentVoice);

    console.log(`[KokoroVoice] Loading TTS module with voice: ${currentVoice}`);
    ttsModule = await TextToSpeechModule.fromModelName(
      { model, voice },
      (progress: number) => {
        if (progress < 1) {
          console.log(`[KokoroVoice] Downloading model: ${(progress * 100).toFixed(0)}%`);
        }
      },
    );
    console.log('[KokoroVoice] TTS module loaded successfully.');
    return true;
  } catch (err: any) {
    console.warn('[KokoroVoice] Failed to load TTS module:', err?.message);
    ttsModule = null;
    return false;
  }
}

// ─── Initialization ───

/**
 * Initialize the Kokoro TTS model. Call once at app startup.
 * Non-blocking: if it fails, the app falls back to native TTS.
 */
export async function initKokoro(): Promise<boolean> {
  if (kokoroReady || kokoroFailed) return kokoroReady;

  try {
    console.log('[KokoroVoice] Initializing Kokoro TTS model...');

    // Restore saved voice preference
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const savedVoice = await AsyncStorage.getItem('@mittens_voice_id');
      if (savedVoice && KOKORO_VOICES.some((v) => v.id === savedVoice)) {
        currentVoice = savedVoice as KokoroVoiceId;
        console.log(`[KokoroVoice] Restored voice: ${savedVoice}`);
      }
    } catch { /* ignore storage errors */ }

    // Create audio context for playback (24kHz for Kokoro output)
    const { AudioContext } = require('react-native-audio-api');
    audioCtx = new AudioContext({ sampleRate: 24000 });

    // Load the TTS module instance
    const loaded = await reloadTtsModule();
    if (!loaded) {
      kokoroFailed = true;
      return false;
    }

    kokoroReady = true;
    console.log('[KokoroVoice] Kokoro ready for synthesis.');
    return true;
  } catch (err: any) {
    console.warn('[KokoroVoice] Init failed (will use native TTS):', err?.message);
    kokoroFailed = true;
    return false;
  }
}

// ─── Synthesis & Playback ───

/** Stop any currently playing Kokoro audio. */
export function stopKokoro() {
  try {
    if (activeSource) {
      activeSource.stop();
      activeSource = null;
    }
  } catch {
    // Best-effort stop
  }
}

/**
 * Synthesize and play text using Kokoro on-device TTS.
 * Returns true if successful, false if Kokoro is unavailable.
 */
export async function speakKokoro(
  text: string,
  onDone?: () => void,
): Promise<boolean> {
  if (!kokoroReady || kokoroFailed || !ttsModule) return false;

  try {
    const { AudioContext } = require('react-native-audio-api');

    // Ensure audio context exists
    if (!audioCtx) {
      audioCtx = new AudioContext({ sampleRate: 24000 });
    }

    // Stop any currently playing audio
    stopKokoro();

    console.log(`[KokoroVoice] Synthesizing (${currentVoice}): "${text.slice(0, 50)}..."`);

    // Generate waveform using the TextToSpeechModule instance
    const waveform = await ttsModule.forward(text, 1.0);

    if (!waveform || waveform.length === 0) {
      console.warn('[KokoroVoice] Empty waveform returned');
      onDone?.();
      return false;
    }

    // Create AudioBuffer from the Float32Array waveform
    const buffer = audioCtx.createBuffer(1, waveform.length, 24000);
    buffer.getChannelData(0).set(waveform);

    // Play via BufferSourceNode
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    activeSource = source;

    let isDone = false;
    const handleDone = () => {
      if (isDone) return;
      isDone = true;
      if (activeSource === source) {
        activeSource = null;
      }
      onDone?.();
    };

    source.onended = handleDone;
    
    // Safety net: react-native-audio-api doesn't always fire onended reliably on iOS
    const durationMs = (waveform.length / 24000) * 1000;
    setTimeout(handleDone, durationMs + 250);

    source.start();
    console.log(`[KokoroVoice] Playing ${(waveform.length / 24000).toFixed(1)}s of audio`);
    return true;
  } catch (err: any) {
    console.error('[KokoroVoice] Synthesis failed:', err?.message);
    onDone?.();
    return false;
  }
}
