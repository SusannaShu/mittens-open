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

/** Speak text via TTS. Strips markdown for natural speech. */
export function speak(text: string, onDone?: () => void) {
  const clean = stripMarkdown(text);
  if (!clean) return;

  Speech.speak(clean, {
    language: 'en-US',
    rate: 1.0,
    pitch: 1.0,
    onDone,
    onStopped: onDone,
    onError: onDone,
  });
}

/** Stop any currently playing TTS. */
export function stopSpeaking() {
  Speech.stop();
}

/** Check if TTS is currently speaking. */
export async function isSpeaking(): Promise<boolean> {
  return Speech.isSpeakingAsync();
}

// Re-export the event hook for components to use directly
export { useSpeechRecognitionEvent };
