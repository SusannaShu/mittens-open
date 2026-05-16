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
import { triage } from '../../pipelines/triage';
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
  items?: any[];
}

interface TriageResult {
  intent: 'face_intro' | 'face_correction' | 'meal' | 'activity_update' | 'chat' | 'timer';
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

  // Stage 1: Unified Triage
  const triageRes = await triage(framePath ? [framePath] : [], transcript || '');
  const topIntent = triageRes.intents[0];
  
  console.log(`[VoiceDispatch] Triage: ${topIntent.pipeline} (${topIntent.confidence})`);

  // Filter low confidence triage to prevent errant logs
  let pipeline = topIntent.pipeline;
  if (topIntent.confidence < 0.3 && pipeline !== 'chat') {
    console.log(`[VoiceDispatch] Low confidence (${topIntent.confidence}), falling back to chat`);
    pipeline = 'chat';
  }

  const triageData: TriageResult = {
    intent: pipeline as any,
    confidence: topIntent.confidence,
    extractedName: topIntent.context?.extractedName,
  };

  // Stage 2: Context-Enriched Dispatch
  switch (pipeline) {
    case 'face_intro':
      return handleFaceIntro(triageData, transcript, framePath);
    case 'face_correction':
      return handleFaceCorrection(triageData, transcript);
    case 'meal':
      return handleMealIntent(brain, transcript, framePath);
    case 'activity':
    case 'activity_update':
      return handleActivityUpdate(brain, transcript, framePath);
    case 'timer':
      return handleTimerIntent(brain, transcript, framePath);
    case 'chat':
    default:
      return handleChat(brain, transcript, framePath);
  }
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

  // Add recent pendant log context for corrections
  const pendantContext = buildPendantNutritionContext();
  const prompt = buildMealPrompt(transcript, context + pendantContext);

  let raw: string;
  if (framePath && brain.supportsVision) {
    raw = await brain.vision(prompt, [framePath]);
  } else {
    raw = await brain.text(prompt);
  }

  const result = parseDispatchResponse(raw);

  // Handle pendant correction actions
  if (result.action === 'update' && result.data?.correction) {
    return handlePendantCorrection(result);
  }

  const executed = await executeMealAction(result);
  return { ...executed, intent: 'meal' };
}

/**
 * Build context about the most recent pendant-auto-logged meal.
 * Enables corrections like "no that's a carrot" or "I'm not eating it".
 */
function buildPendantNutritionContext(): string {
  try {
    const { getDb } = require('../../database');
    const db = getDb();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const recent = db.getFirstSync(
      `SELECT id, log_name, items, logged_at
       FROM nutrition_logs
       WHERE source = 'pendant' AND logged_at >= ? AND deleted_at IS NULL
       ORDER BY logged_at DESC LIMIT 1`,
      [fiveMinAgo],
    ) as any;

    if (!recent) return '';

    const time = new Date(recent.logged_at).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });

    return [
      '',
      '',
      `RECENT AUTO-LOG: The pendant camera just auto-logged "${recent.log_name}" at ${time} (log #${recent.id}).`,
      'If the user is CORRECTING this (e.g., "no that\'s a carrot", "I\'m not eating it"),',
      'set action to "update" with targetLogId=' + recent.id + ' and data.correction=true.',
      'If they say to remove it, set data.remove=true.',
      'If they say it\'s something else, set data.replaceItems=[{name:"correct item"}].',
    ].join('\n');
  } catch {
    return '';
  }
}

/**
 * Handle corrections to pendant-auto-logged nutrition.
 */
async function handlePendantCorrection(result: any): Promise<VoiceDispatchResult> {
  const logId = result.targetLogId;
  if (!logId) {
    return { response: result.response || 'Got it.', intent: 'meal', action: 'respond' };
  }

  try {
    if (result.data?.remove) {
      const { removeNutritionLog } = require('./nutritionCorrection');
      removeNutritionLog(logId);
      return {
        response: result.response || 'Removed that from your log.',
        intent: 'meal', action: 'delete', logId,
      };
    }

    if (result.data?.replaceItems?.length > 0) {
      const { replaceNutritionLogItems } = require('./nutritionCorrection');
      await replaceNutritionLogItems(logId, result.data.replaceItems);
      const names = result.data.replaceItems.map((i: any) => i.name).join(', ');
      return {
        response: result.response || `Updated to ${names}.`,
        intent: 'meal', action: 'update', logId,
      };
    }

    return { response: result.response || 'Got it.', intent: 'meal', action: 'respond' };
  } catch (err: any) {
    console.warn('[VoiceDispatch] Pendant correction failed:', err?.message);
    return {
      response: 'Sorry, I had trouble updating that.',
      intent: 'meal', action: 'respond',
    };
  }
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

// ─── Timer Intent ────

async function handleTimerIntent(
  brain: any,
  transcript: string | null,
  framePath?: string,
): Promise<VoiceDispatchResult> {
  const { buildTimerPrompt, executeTimerAction } = require('./voiceDispatchHelpers');
  const prompt = buildTimerPrompt(transcript);

  let raw: string;
  if (framePath && brain.supportsVision) {
    raw = await brain.vision(prompt, [framePath]);
  } else {
    raw = await brain.text(prompt);
  }

  const executed = await executeTimerAction(raw);
  return { ...executed, intent: 'timer' };
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
