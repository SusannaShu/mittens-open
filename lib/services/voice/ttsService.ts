/**
 * voice/ttsService.ts -- Barrel re-export for TTS functions.
 *
 * Multiple ambient pipeline files import from this path.
 * The actual implementation lives in ai/voiceService.ts.
 */
export { speak, stopSpeaking, isSpeaking } from '../ai/voiceService';
