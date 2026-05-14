/**
 * ambient/pendantVoiceDispatch.ts -- Two-stage voice handler for pendant button press.
 *
 * Stage 1: Lightweight brain triage -- classify intent from transcript + frame.
 * Stage 2: Load only the relevant context, execute the action.
 *
 * All voice intents (face intro, meal, activity update, chat) flow through
 * the same pipeline. The brain decides, not hardcoded regex.
 */

import { getBrain } from '../../brain/selector';
import {
  buildMealContext,
  buildActivityContext,
  buildMealPrompt,
  buildActivityPrompt,
  parseDispatchResponse,
  executeMealAction,
  executeActivityAction,
} from './voiceDispatchHelpers';

// ─── Types ────

export interface VoiceDispatchResult {
  response: string;
  intent: string;
  action: string;
  logId?: number | null;
}

interface TriageResult {
  intent: 'face_intro' | 'face_correction' | 'meal' | 'activity_update' | 'chat';
  confidence: number;
  extractedName?: string;
}

// ─── Main Entry Point ────

/**
 * Handle a pendant voice input through two-stage brain triage.
 * Returns conversational response text for TTS.
 */
export async function dispatchVoice(
  transcript: string | null,
  framePath?: string,
  audioPath?: string,
): Promise<VoiceDispatchResult> {
  const brain = await getBrain();

  if (!transcript && !framePath) {
    return {
      response: 'I could not hear anything and no photo was captured.',
      intent: 'chat', action: 'respond',
    };
  }

  // Stage 1: Lightweight Triage
  const triage = await triageVoice(brain, transcript, framePath);
  console.log(`[VoiceDispatch] Triage: ${triage.intent} (${triage.confidence})`);

  // Filter low confidence triage to prevent errant logs
  if (triage.confidence < 0.3 && triage.intent !== 'chat') {
    console.log(`[VoiceDispatch] Low confidence (${triage.confidence}), falling back to chat`);
    triage.intent = 'chat';
  }

  // Stage 2: Context-Enriched Dispatch
  switch (triage.intent) {
    case 'face_intro':
      return handleFaceIntro(triage, transcript, framePath);
    case 'face_correction':
      return handleFaceCorrection(triage, transcript);
    case 'meal':
      return handleMealIntent(brain, transcript, framePath);
    case 'activity_update':
      return handleActivityUpdate(brain, transcript, framePath);
    case 'chat':
    default:
      return handleChat(brain, transcript, framePath);
  }
}

// ─── Stage 1: Triage ────

async function triageVoice(
  brain: any,
  transcript: string | null,
  framePath?: string,
): Promise<TriageResult> {
  const prompt = [
    'Classify this pendant voice input into exactly one intent.',
    'Return ONLY a JSON object, no other text.',
    '',
    `Transcript: "${transcript || '(no speech detected)'}"`,
    '',
    'Possible intents:',
    '- "face_intro": user is introducing a person (e.g. "this is Sarah", "meet my friend John")',
    '- "face_correction": user is correcting a false positive recognition (e.g. "that\'s not Caden", "wrong person", "whoops that is not John")',
    '- "meal": user is logging food/drink (e.g. "log two oranges", "I had a banana", "just ate lunch")',
    '- "activity_update": user is commenting on a current/recent activity (e.g. "meeting feels draining", "the walk was great", "I\'m so focused right now")',
    '- "chat": anything else (questions, conversation, commands unrelated to logging)',
    '',
    'JSON format: { "intent": "...", "confidence": 0.0-1.0, "extractedName": "..." }',
    'Only include extractedName for face_intro intent.',
  ].join('\n');

  try {
    let raw: string;
    if (framePath && brain.supportsVision) {
      raw = await brain.vision(prompt, [framePath]);
    } else {
      raw = await brain.text(prompt);
    }
    return parseTriageResponse(raw);
  } catch (err: any) {
    console.warn('[VoiceDispatch] Triage failed, defaulting to chat:', err?.message);
    return { intent: 'chat', confidence: 0.5 };
  }
}

function parseTriageResponse(raw: string): TriageResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (['face_intro', 'face_correction', 'meal', 'activity_update', 'chat'].includes(parsed.intent)) {
        return {
          intent: parsed.intent,
          confidence: parsed.confidence ?? 0.7,
          extractedName: parsed.extractedName,
        };
      }
    }
  } catch { /* JSON parse failed */ }
  return { intent: 'chat', confidence: 0.5 };
}

// ─── Face Introduction ────

async function handleFaceIntro(
  triage: TriageResult,
  _transcript: string | null,
  framePath?: string,
): Promise<VoiceDispatchResult> {
  const name = triage.extractedName;

  if (!name) {
    return {
      response: "I think you are introducing someone, but I did not catch the name. Could you say it again?",
      intent: 'face_intro', action: 'clarify',
    };
  }

  if (!framePath) {
    return {
      response: `I heard you say this is ${name}, but I do not have a photo. Could you try again?`,
      intent: 'face_intro', action: 'respond',
    };
  }

  try {
    const { introducePerson } = require('../faceRecognition/faceRecognitionService');
    const result = await introducePerson(name, framePath);

    if (result) {
      const response = result.isNew
        ? `Nice to meet you ${result.name}! I have learned your face and will remember you.`
        : `Got it, I have strengthened my memory of ${result.name}. I now have ${result.embeddingsSaved} sightings saved.`;
      return { response, intent: 'face_intro', action: result.isNew ? 'create' : 'update' };
    }

    return {
      response: `I heard you say this is ${name}, but I could not detect a face in the photo. Could you try again?`,
      intent: 'face_intro', action: 'respond',
    };
  } catch (err: any) {
    console.warn('[VoiceDispatch] Face intro failed:', err?.message);
    return {
      response: `Sorry, I had trouble registering ${name}. Could you try again?`,
      intent: 'face_intro', action: 'respond',
    };
  }
}

// ─── Face Correction ────

async function handleFaceCorrection(
  triage: TriageResult,
  transcript: string | null,
): Promise<VoiceDispatchResult> {
  try {
    const { undoLastReinforcement } = require('../faceRecognition/faceRecognitionApi');
    const undonePersonId = undoLastReinforcement();

    if (undonePersonId) {
      return {
        response: `Oops, sorry about that! I deleted the last memory I saved.`,
        intent: 'face_correction', action: 'delete',
      };
    } else {
      return {
        response: `I couldn't find a recent face memory to delete.`,
        intent: 'face_correction', action: 'respond',
      };
    }
  } catch (err: any) {
    console.warn('[VoiceDispatch] Face correction failed:', err?.message);
    return {
      response: `Sorry, I had trouble deleting the last face memory.`,
      intent: 'face_correction', action: 'respond',
    };
  }
}

// ─── Meal Intent ────

async function handleMealIntent(
  brain: any,
  transcript: string | null,
  framePath?: string,
): Promise<VoiceDispatchResult> {
  const context = buildMealContext();
  const prompt = buildMealPrompt(transcript, context);

  let raw: string;
  if (framePath && brain.supportsVision) {
    raw = await brain.vision(prompt, [framePath]);
  } else {
    raw = await brain.text(prompt);
  }

  const result = parseDispatchResponse(raw);
  const executed = await executeMealAction(result);
  return { ...executed, intent: 'meal' };
}

// ─── Activity Update ────

async function handleActivityUpdate(
  brain: any,
  transcript: string | null,
  framePath?: string,
): Promise<VoiceDispatchResult> {
  const context = buildActivityContext();
  const prompt = buildActivityPrompt(transcript, context);

  let raw: string;
  if (framePath && brain.supportsVision) {
    raw = await brain.vision(prompt, [framePath]);
  } else {
    raw = await brain.text(prompt);
  }

  const executed = executeActivityAction(raw);
  return { ...executed, intent: 'activity_update' };
}

// ─── Chat (default) ────

async function handleChat(
  brain: any,
  transcript: string | null,
  framePath?: string,
): Promise<VoiceDispatchResult> {
  const prompt = [
    transcript
      ? `The user spoke: "${transcript}"`
      : 'The user pressed the button but no speech was clearly heard.',
    framePath && brain.supportsVision
      ? 'Use your vision to observe your surroundings and consider it.'
      : '',
    'You are an embodied AI companion. Be highly conversational, natural, and use 1 short sentence maximum.',
  ].filter(Boolean).join(' ');

  let response: string;
  if (framePath && brain.supportsVision) {
    response = await brain.vision(prompt, [framePath]);
  } else {
    response = await brain.text(prompt);
  }

  return { response, intent: 'chat', action: 'respond' };
}
