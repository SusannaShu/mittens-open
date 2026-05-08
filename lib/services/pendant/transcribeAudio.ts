/**
 * transcribeAudio -- converts a local audio file to text via expo-speech-recognition.
 *
 * Used by the pendant bridge when the active brain doesn't support native audio
 * input (i.e. cloud brains like Claude/Gemini). The pendant records PCM16 audio;
 * this function feeds it to the on-device speech recognizer and returns a transcript.
 *
 * AUDIO SOURCE SUPPORT:
 *   expo-speech-recognition supports `audioSource.uri` which accepts a file:// path
 *   to a WAV/PCM file. On Android, you can specify encoding and sample rate.
 *   On iOS, it uses the system speech recognizer with the file as input.
 *
 * USAGE:
 *   const text = await transcribeAudio('file:///path/to/audio.pcm');
 *   // text = "Hey Mittens, what should I eat for lunch?"
 */

import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

/**
 * Transcribe a local audio file to text.
 *
 * @param audioPath - file:// URI or absolute path to audio file (PCM16 16kHz mono or WAV)
 * @param options - optional config for sample rate, channels, timeout
 * @returns The transcribed text, or empty string if transcription failed
 */
export async function transcribeAudio(
  audioPath: string,
  options?: {
    sampleRate?: number;
    audioChannels?: number;
    timeoutMs?: number;
    lang?: string;
  },
): Promise<string> {
  if (!audioPath) {
    console.warn('[transcribeAudio] No audio path provided');
    return '';
  }

  // Ensure file:// prefix
  const uri = audioPath.startsWith('file://') ? audioPath : `file://${audioPath}`;
  const timeoutMs = options?.timeoutMs ?? 15000;

  console.log('[transcribeAudio] Starting transcription:', uri.slice(-40));

  return new Promise<string>((resolve) => {
    let transcript = '';
    let settled = false;

    const settle = (result: string) => {
      if (settled) return;
      settled = true;
      // Clean up listeners
      resultSub.remove();
      errorSub.remove();
      endSub.remove();
      clearTimeout(timer);
      console.log('[transcribeAudio] Result:', result.slice(0, 80) || '(empty)');
      resolve(result);
    };

    // Timeout safety net
    const timer = setTimeout(() => {
      console.warn('[transcribeAudio] Timed out after', timeoutMs, 'ms');
      try { ExpoSpeechRecognitionModule.abort(); } catch {}
      settle(transcript); // Return whatever we got so far
    }, timeoutMs);

    // Listen for results
    const resultSub = ExpoSpeechRecognitionModule.addListener('result', (event) => {
      if (event.results && event.results.length > 0) {
        transcript = event.results[0].transcript;
        if (event.isFinal) {
          settle(transcript);
        }
      }
    });

    // Listen for errors
    const errorSub = ExpoSpeechRecognitionModule.addListener('error', (event) => {
      console.error('[transcribeAudio] Error:', event.error, event.message);
      settle(transcript); // Return whatever we got, even on error
    });

    // Listen for end (recognition session finished)
    const endSub = ExpoSpeechRecognitionModule.addListener('end', () => {
      settle(transcript);
    });

    // Start recognition from audio file
    try {
      ExpoSpeechRecognitionModule.start({
        lang: options?.lang ?? 'en-US',
        interimResults: false, // We only need the final result
        addsPunctuation: true,
        audioSource: {
          uri,
          audioChannels: options?.audioChannels ?? 1,
          sampleRate: options?.sampleRate ?? 16000,
        },
      });
    } catch (err: any) {
      console.error('[transcribeAudio] Start failed:', err?.message);
      settle('');
    }
  });
}
