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
  | 'af_bella'
  | 'af_nicole'
  | 'af_sarah'
  | 'af_sky'
  | 'am_adam'
  | 'am_michael'
  | 'am_liam';

export interface KokoroVoiceOption {
  id: KokoroVoiceId;
  label: string;
  gender: 'female' | 'male';
  style: string;
}

export const KOKORO_VOICES: KokoroVoiceOption[] = [
  { id: 'af_heart', label: 'Heart', gender: 'female', style: 'Warm, conversational' },
  { id: 'af_bella', label: 'Bella', gender: 'female', style: 'Friendly, upbeat' },
  { id: 'af_nicole', label: 'Nicole', gender: 'female', style: 'Calm, professional' },
  { id: 'af_sarah', label: 'Sarah', gender: 'female', style: 'Neutral, clear' },
  { id: 'af_sky', label: 'Sky', gender: 'female', style: 'Light, airy' },
  { id: 'am_adam', label: 'Adam', gender: 'male', style: 'Confident, strong' },
  { id: 'am_michael', label: 'Michael', gender: 'male', style: 'Smooth, relaxed' },
  { id: 'am_liam', label: 'Liam', gender: 'male', style: 'Warm, casual' },
];

export const DEFAULT_VOICE: KokoroVoiceId = 'af_heart';

// ─── Voice Constant Mapping ───

/**
 * Maps our voice ID strings to the react-native-executorch constants.
 * These constants are URLs to the voice style files on HuggingFace.
 */
function getVoiceConstant(voiceId: KokoroVoiceId): string {
  try {
    const ET = require('react-native-executorch');
    const map: Record<string, any> = {
      af_heart: ET.KOKORO_VOICE_AF_HEART,
      af_bella: ET.KOKORO_VOICE_AF_BELLA,
      af_nicole: ET.KOKORO_VOICE_AF_NICOLE,
      af_sarah: ET.KOKORO_VOICE_AF_SARAH,
      af_sky: ET.KOKORO_VOICE_AF_SKY,
      am_adam: ET.KOKORO_VOICE_AM_ADAM,
      am_michael: ET.KOKORO_VOICE_AM_MICHAEL,
      am_liam: ET.KOKORO_VOICE_AM_LIAM,
    };
    return map[voiceId] || ET.KOKORO_VOICE_AF_HEART;
  } catch {
    return voiceId;
  }
}

function getModelConstant(): string {
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
let ttsInstance: any = null;
let audioCtx: any = null;
let activeSource: any = null;

// ─── Configuration ───

/** Set the active Kokoro voice. */
export function setKokoroVoice(voiceId: KokoroVoiceId) {
  currentVoice = voiceId;
  // If TTS is already initialized, it will pick up the new voice on next speak call
  console.log(`[KokoroVoice] Voice set to: ${voiceId}`);
}

/** Get the current voice ID. */
export function getKokoroVoice(): KokoroVoiceId {
  return currentVoice;
}

/** Check if Kokoro is ready for synthesis. */
export function isKokoroReady(): boolean {
  return kokoroReady && !kokoroFailed;
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

    // Lazy-import to avoid crash if the native module is not linked
    const { useTextToSpeech } = require('react-native-executorch');
    const { AudioContext } = require('react-native-audio-api');

    // Note: useTextToSpeech is a React hook and cannot be called outside
    // a component. We use a different approach below for non-hook usage.
    // This init just validates the modules are available.

    // Create audio context for playback (24kHz for Kokoro output)
    audioCtx = new AudioContext({ sampleRate: 24000 });

    kokoroReady = true;
    console.log('[KokoroVoice] Kokoro modules loaded successfully.');
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
  if (!kokoroReady || kokoroFailed) return false;

  try {
    const ET = require('react-native-executorch');
    const { AudioContext } = require('react-native-audio-api');

    // Ensure audio context exists
    if (!audioCtx) {
      audioCtx = new AudioContext({ sampleRate: 24000 });
    }

    // Stop any currently playing audio
    stopKokoro();

    console.log(`[KokoroVoice] Synthesizing (${currentVoice}): "${text.slice(0, 50)}..."`);

    // Generate waveform using the ExecuTorch Kokoro model
    const waveform = await ET.generate(
      getModelConstant(),
      text,
      getVoiceConstant(currentVoice),
      1.0,
    );

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

    source.onended = () => {
      activeSource = null;
      onDone?.();
    };

    source.start();
    console.log(`[KokoroVoice] Playing ${(waveform.length / 24000).toFixed(1)}s of audio`);
    return true;
  } catch (err: any) {
    console.error('[KokoroVoice] Synthesis failed:', err?.message);
    onDone?.();
    return false;
  }
}
