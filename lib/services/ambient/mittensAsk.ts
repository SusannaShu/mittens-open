/**
 * ambient/mittensAsk.ts -- Proactive voice nudges with button-gated response.
 *
 * When the ambient pipeline encounters ambiguity (e.g., "yogurt or kefir?",
 * confidence < 0.7), it can ask the user via TTS and arm a one-shot
 * listener for the pendant's double-tap button to capture the verbal response.
 *
 * Flow:
 *   1. Pipeline calls mittensAsk("Is that yogurt or kefir?")
 *   2. TTS speaks the question aloud
 *   3. Arms the pendant double-tap listener for 30s
 *   4. User taps button and speaks response
 *   5. Response is transcribed and returned to the pipeline
 *   6. If no response within 30s, returns null (question unanswered)
 *
 * User agency is preserved: Mittens asks, user decides whether to respond.
 */

/** Timeout for waiting for user response after asking */
const ASK_TIMEOUT_MS = 30_000; // 30 seconds

/** Currently armed ask session (only one at a time) */
let pendingAsk: {
  question: string;
  resolve: (answer: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

/**
 * Ask the user a question via TTS and wait for button-gated response.
 * Returns the user's transcribed answer, or null if no response.
 */
export async function mittensAsk(question: string): Promise<string | null> {
  // Cancel any pending ask
  if (pendingAsk) {
    clearTimeout(pendingAsk.timer);
    pendingAsk.resolve(null);
    pendingAsk = null;
  }

  console.log(`[MittensAsk] Asking: "${question}"`);

  // 1. Speak the question via TTS
  const { speak } = require('../../services/ai/voiceService');
  await new Promise<void>((resolve) => {
    speak(question, () => resolve());
  });

  // 2. Arm listener and wait for response
  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      console.log('[MittensAsk] Timed out waiting for response');
      pendingAsk = null;
      resolve(null);
    }, ASK_TIMEOUT_MS);

    pendingAsk = { question, resolve, timer };
    console.log('[MittensAsk] Armed -- waiting for button tap + verbal response');
  });
}

/**
 * Called by usePendantBridge when user responds to an armed ask.
 * The double-tap handler should check if there's a pending ask
 * and route the transcribed response here.
 */
export function resolveAsk(answer: string): void {
  if (!pendingAsk) {
    console.log('[MittensAsk] No pending ask to resolve');
    return;
  }

  console.log(`[MittensAsk] User answered: "${answer}"`);
  clearTimeout(pendingAsk.timer);
  pendingAsk.resolve(answer);
  pendingAsk = null;
}

/**
 * Check if there's currently a pending ask waiting for response.
 */
export function hasPendingAsk(): boolean {
  return pendingAsk !== null;
}

/**
 * Get the current pending question (for UI display).
 */
export function getPendingQuestion(): string | null {
  return pendingAsk?.question || null;
}

/**
 * Cancel any pending ask without providing a response.
 */
export function cancelAsk(): void {
  if (pendingAsk) {
    clearTimeout(pendingAsk.timer);
    pendingAsk.resolve(null);
    pendingAsk = null;
    console.log('[MittensAsk] Cancelled');
  }
}
