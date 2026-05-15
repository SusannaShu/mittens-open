/**
 * handleMessage -- Unified message handler for ALL user inputs.
 *
 * Flow:
 *   1. Save user message to local DB
 *   2. Dedup check (same photo hash or text within 5-min window)
 *   3. Ensure brain is ready (download model if missing, show "waking up...")
 *   4. Triage (agent classifies intent(s) -- could be many)
 *   5. Show intent cards immediately (collapsible per-pipeline progress)
 *   6. Resolve timestamp (text refs, EXIF, manual, or now)
 *   7. Run all detected pipelines sequentially (E2B is single-threaded)
 *   8. Persist results to DB via RTK mutations
 *   9. Compose reply from all pipeline results
 *  10. Save reply to local DB
 *
 * A single input can trigger multiple pipelines:
 *   "biked to park and got a smoothie" -> activity + meal
 */

import { ChatMessage } from '../../../components/chat/ChatBubble';
import { PendingEntry } from '../../../components/chat/EntryReviewCard';
import type { PantryPipelineItem, PantryPipelineStatus } from '../../../components/chat/PantryPipelineCard';
import type { PipelineIntent, IntentPhase } from '../../../components/chat/IntentCardsRow';
import type { ChatContext, DomainStatus } from './types';
import { triage, resolveTimestamp } from '../../pipelines/triage';
import { PipelineRunner, PipelineInput, PipelineState } from '../../pipelines/runner';
import { getDataProvider, getInferenceProvider, getAgentEnabled, getAgentProvider } from '../../providers/providerFactory';
import { speak } from '../../services/ai/voiceService';
import type { DetectedIntent } from '../../pipelines/types';
import { getBrainId } from '../../brain/selector';
import { foodIdToPipeline } from '../useNutrientPipeline';

// ──────────── Phase definitions per pipeline ────────────

const MEAL_PHASES: Array<{ key: string; label: string; featherIcon: string }> = [
  { key: 'identify', label: 'Identifying foods', featherIcon: 'search' },
  { key: 'nutrients', label: 'Nutrients', featherIcon: 'bar-chart-2' },
  { key: 'bioavailability', label: 'Bioavailability', featherIcon: 'thermometer' },
  { key: 'validate', label: 'Gut health', featherIcon: 'shield' },
  { key: 'eatingContext', label: 'Eating context', featherIcon: 'clock' },
];

const ACTIVITY_PHASES: Array<{ key: string; label: string; featherIcon: string }> = [
  { key: 'detect', label: 'Detecting activity', featherIcon: 'crosshair' },
  { key: 'environment', label: 'Environment', featherIcon: 'compass' },
  { key: 'social', label: 'Social context', featherIcon: 'users' },
  { key: 'objects', label: 'Objects', featherIcon: 'box' },
  { key: 'lifeDesign', label: 'Life design', featherIcon: 'target' },
];

const SLEEP_PHASES: Array<{ key: string; label: string; featherIcon: string }> = [
  { key: 'detect', label: 'Sleep detection', featherIcon: 'moon' },
];

const PANTRY_PHASES: Array<{ key: string; label: string; featherIcon: string }> = [
  { key: 'identify', label: 'Identifying items', featherIcon: 'search' },
];

const CHAT_PHASES: Array<{ key: string; label: string; featherIcon: string }> = [
  { key: 'classify', label: 'Thinking', featherIcon: 'cpu' },
  { key: 'respond', label: 'Composing reply', featherIcon: 'message-circle' },
];

/**
 * Build the phase list for a triage intent, respecting inferrablePhases.
 * Only shows phases with evidence (if specified).
 */
function buildPhasesForIntent(intent: DetectedIntent): IntentPhase[] {
  let allPhases: Array<{ key: string; label: string; featherIcon: string }>;
  switch (intent.pipeline) {
    case 'meal': allPhases = MEAL_PHASES; break;
    case 'activity': allPhases = ACTIVITY_PHASES; break;
    case 'sleep': allPhases = SLEEP_PHASES; break;
    case 'pantry': allPhases = PANTRY_PHASES; break;
    case 'chat': allPhases = CHAT_PHASES; break;
    default: return [];
  }

  // Filter to only phases with evidence (if inferrablePhases specified)
  const allowed = intent.inferrablePhases;
  if (allowed && allowed.length > 0) {
    allPhases = allPhases.filter(p => allowed.includes(p.key));
  }

  return allPhases.map(p => ({ ...p, status: 'queued' as const }));
}

/**
 * Check if this input was recently logged (dedup).
 * Prevents double-logging when user accidentally sends the same thing.
 */
async function checkDedup(text: string, photos: string[]): Promise<boolean> {
  try {
    const dataProvider = await getDataProvider();
    const recent = await dataProvider.getRecentMessages?.(5);
    if (!recent || recent.length === 0) return false;

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    for (const msg of recent) {
      if (msg.role !== 'user') continue;
      const msgTime = new Date(msg.createdAt || msg.timestamp).getTime();
      if (msgTime < fiveMinAgo) continue;

      // Text match
      if (text && msg.text === text) return true;

      // Photo count match (rough proxy for same photos)
      if (photos.length > 0 && msg.photos?.length === photos.length) {
        // If same count and same caption, likely duplicate
        if (text && msg.text === text) return true;
      }
    }
  } catch {
    // Dedup failure is non-blocking
  }
  return false;
}

/**
 * Compose a natural reply from multiple pipeline results.
 */
function composeReply(
  results: PromiseSettledResult<{ type: string; data: any }>[],
  intents: DetectedIntent[],
): { text: string; pendingEntries: PendingEntry[]; emailData?: any; pantryPipelineItems?: PantryPipelineItem[]; pantryPipelineStatus?: PantryPipelineStatus } {
  const parts: string[] = [];
  const pendingEntries: PendingEntry[] = [];
  let emailData: any = null;
  let pantryPipelineItems: PantryPipelineItem[] | undefined;
  let pantryPipelineStatus: PantryPipelineStatus | undefined;

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { type, data } = r.value;

    switch (type) {
      case 'activity':
        if (data?.logName) {
          parts.push(`Logged ${data.logName}${data.duration_min ? ` (${data.duration_min}min)` : ''}.`);
          pendingEntries.push({
            entryType: 'activity',
            name: data.logName,
            activitySubtype: data.activityType,
            duration_min: data.duration_min,
            _confirmed: true,
          });
        }
        break;

      case 'meal':
        // Food pipeline results are handled separately via pipelineFoods in the message
        if (data?.foods?.length > 0) {
          const names = data.foods.map((f: any) => f.name).join(', ');
          parts.push(`Detected: ${names}. Estimating nutrients...`);
        }
        break;

      case 'pantry':
        if (Array.isArray(data) && data.length > 0) {
          parts.push(`Found ${data.length} item${data.length !== 1 ? 's' : ''} in your pantry.`);
          pantryPipelineItems = data.map((item: any) => ({
            name: item.name || item.foodName || 'Unknown',
            quantity: item.quantity || '',
            confidence: item.confidence ?? 0.8,
            status: 'complete' as const,
            freshness: item.freshness,
            storageLocation: item.storageLocation,
            checkBy: item.checkBy,
          }));
          pantryPipelineStatus = 'complete';
        }
        break;

      case 'sleep':
        if (data?.totalMinutes) {
          const hrs = Math.floor(data.totalMinutes / 60);
          const mins = data.totalMinutes % 60;
          parts.push(`Logged ${hrs}h${mins > 0 ? ` ${mins}m` : ''} of sleep.`);
          pendingEntries.push({
            entryType: 'other' as any,
            name: `Sleep`,
            activitySubtype: 'rest',
            _confirmed: true,
          });
        }
        break;

      case 'chat':
        if (data?.reply) {
          parts.push(data.reply);
        }
        break;

      case 'email':
        emailData = data;
        if (data?.needsConnect) {
          parts.push('I need access to your Gmail to do this.');
        } else if (data?.orderItems?.length > 0) {
          parts.push(`Found ${data.orderItems.length} order item${data.orderItems.length !== 1 ? 's' : ''} from ${data.stats?.searched || 0} emails.`);
        } else if (data?.answer) {
          parts.push(data.answer);
        } else if (data?.extractedEvent) {
          const evt = data.extractedEvent;
          parts.push(`Found event: "${evt.title}" on ${evt.date}${evt.startTime ? ` at ${evt.startTime}` : ''}.`);
        } else if (data?.draft) {
          parts.push(`Here's a draft for ${data.draft.to || 'your recipient'}:`);
        } else if (data?.plan) {
          parts.push("I searched but couldn't find matching emails. Want to try different search terms?");
        }
        break;
    }
  }

  const text = parts.length > 0
    ? parts.join(' ')
    : 'Got it! Let me know if you need anything else.';

  return { text, pendingEntries, emailData, pantryPipelineItems, pantryPipelineStatus };
}

/**
 * Run a single pipeline intent through the PipelineRunner.
 * Returns typed result with domain label.
 */
async function runIntent(
  runner: PipelineRunner,
  intent: DetectedIntent,
  input: PipelineInput,
  onPantryProgress?: (items: any[], status: string) => void,
): Promise<{ type: string; data: any }> {
  switch (intent.pipeline) {
    case 'meal':
      return { type: 'meal', data: await runner.runFoodPipeline(input, intent.inferrablePhases) };

    case 'activity':
      return {
        type: 'activity',
        data: await runner.runActivityPipeline({
          ...input,
          manualData: {
            ...(input.manualData || {}),
            activityType: intent.context?.activityType,
          },
        }, intent.inferrablePhases),
      };

    case 'pantry':
      return { type: 'pantry', data: await runner.runPantryPipeline(input, onPantryProgress) };

    case 'sleep':
      return { type: 'sleep', data: await runner.runSleepPipeline(input) };

    case 'chat':
      return { type: 'chat', data: await runner.runChatPipeline(input) };

    case 'email': {
      // Check Gmail connection before running
      const { isGmailConnected } = await import('../../services/gmailService');
      const connected = await isGmailConnected();
      if (!connected) {
        return {
          type: 'email',
          data: { needsConnect: true },
        };
      }
      return { type: 'email', data: await runner.runEmailPipeline(input) };
    }

    default:
      return { type: 'chat', data: null };
  }
}

/**
 * The unified message handler. ALL inputs go through this.
 */
export async function handleMessage(
  text: string,
  photos: string[],
  ctx: ChatContext,
  photoTime?: Date | null,
  userMsgId?: string,
): Promise<void> {
  console.log('[Pipeline] === handleMessage START ===');
  console.log('[Pipeline] text:', text ? `"${text.slice(0, 60)}"` : '(none)');
  console.log('[Pipeline] photos:', photos.length);
  const dataProvider = await getDataProvider();

  // 1. Save user message to local DB
  // Find the most recent user message with a temp ID to update
  const tempUserMsgId = userMsgId || ctx.messages
    .slice()
    .reverse()
    .find(m => m.role === 'user' && m.id.startsWith('u-'))?.id;

  try {
    const saved = await dataProvider.saveMessage({
      role: 'user',
      text: text || 'Photo',
      photos: photos.length > 0 ? photos : undefined,
    });
    if (saved?.id && tempUserMsgId) {
      ctx.setMessages(prev => prev.map(m =>
        m.id === tempUserMsgId
          ? { ...m, id: `db-${saved.id}` }
          : m
      ));
    }
  } catch {
    // Save failure is non-blocking -- message still appears in UI
  }

  // 2. Dedup check
  const isDupe = await checkDedup(text, photos);
  if (isDupe) {
    const dupeReply: ChatMessage = {
      id: `m-${Date.now()}`,
      role: 'mittens',
      text: 'Hey, you sent me this already! Need to update something?',
      timestamp: new Date(),
    };
    ctx.addMessage(dupeReply);
    ctx.scrollToEnd();
    try {
      await dataProvider.saveMessage({ role: 'mittens', text: dupeReply.text });
    } catch {}
    return;
  }

  // 3. Ensure brain is ready (may need to download model)
  const { getBrain } = require('../../brain/selector');
  const brain = await getBrain();
  const brainId = await getBrainId();
  console.log('[Pipeline] Brain:', brainId, brain.name);

  if (typeof brain.ensureReady === 'function') {
    const wakingUpId = `wakeup-${Date.now()}`;
    let wakingMsgAdded = false;

    try {
      await brain.ensureReady((p: any) => {
        if (!wakingMsgAdded) {
          ctx.addMessage({
            id: wakingUpId,
            role: 'mittens',
            text: 'Waking up...',
            timestamp: new Date(),
          });
          wakingMsgAdded = true;
          ctx.scrollToEnd();
        }

        const subtext = p.progress != null
          ? `${p.message} ${Math.round(p.progress * 100)}%`
          : p.message;

        ctx.setMessages(prev => prev.map(m =>
          m.id === wakingUpId ? { ...m, text: `Waking up...\n${subtext}` } : m
        ));
      });
    } finally {
      // Remove the waking up message once ready
      if (wakingMsgAdded) {
        ctx.setMessages(prev => prev.filter(m => m.id !== wakingUpId));
      }
    }
  }

  // 4. Triage: classify intent(s)
  ctx.setSendingStatus('Classifying...');

  let triageResult;
  try {
    console.log('[Pipeline] Triage START (photos:', photos.length, ')');
    triageResult = await triage(photos, text);
    console.log('[Pipeline] Triage DONE:', JSON.stringify(triageResult.intents));
  } catch (triageErr: any) {
    console.error('[Pipeline] Triage FAILED:', triageErr?.message || triageErr);
    console.error('[Pipeline] Triage stack:', triageErr?.stack);
    throw triageErr;
  }

  // 5. Resolve timestamp
  const temporal = await resolveTimestamp(
    text,
    photoTime ? [photoTime] : (ctx.photoTimestampsRef.current || undefined),
  );

  // 6. Build pipeline input
  const pipelineInput: PipelineInput = {
    source: 'chat',
    text,
    photos: photos.length > 0 ? photos : undefined,
    temporal,
  };

  // 7. Build intent cards and show immediately
  const validIntents = triageResult.intents.filter(i => i.confidence >= 0.5);

  // Build intent phase lists (filtering by inferrablePhases)
  const intentCards: PipelineIntent[] = validIntents.map(intent => ({
    pipeline: intent.pipeline,
    status: 'queued' as const,
    phases: buildPhasesForIntent(intent),
  }));

  // Show progress message with intent cards immediately
  const progressMsgId = `m-${Date.now()}`;
  const hasVisibleIntents = intentCards.some(i =>
    i.phases.length > 0 && !['chat', 'email', 'watch'].includes(i.pipeline)
  );

  if (hasVisibleIntents) {
    const progressMsg: ChatMessage = {
      id: progressMsgId,
      clientId: progressMsgId,
      role: 'mittens',
      text: '',
      timestamp: new Date(),
      pipelineIntents: intentCards,
    };
    ctx.addMessage(progressMsg);
    ctx.scrollToEnd();
  }

  // Helper to update intent status in the progress message
  const updateIntentStatus = (pipeline: string, status: string, phaseUpdates?: Record<string, { status: string; result?: string }>) => {
    if (!hasVisibleIntents) return;
    ctx.setMessages(prev => prev.map(m => {
      if (m.id !== progressMsgId || !m.pipelineIntents) return m;
      return {
        ...m,
        pipelineIntents: m.pipelineIntents.map(i => {
          if (i.pipeline !== pipeline) return i;
          let updatedPhases = i.phases;
          if (phaseUpdates) {
            updatedPhases = i.phases.map(p => {
              const update = phaseUpdates[p.key];
              if (update) {
                return { ...p, status: update.status as any, result: update.result };
              }
              return p;
            });
          }
          return { ...i, status: status as any, phases: updatedPhases };
        }),
      };
    }));
  };

  // User-friendly phase labels for the typing indicator
  const PHASE_LABELS: Record<string, string> = {
    'pantry:identify': 'Identifying items...',
    'food:eatingContext': 'Analyzing meal...',
    'activity:detect': 'Detecting activity...',
    'activity:environment': 'Detecting environment...',
    'activity:social': 'Detecting social context...',
    'activity:objects': 'Detecting objects...',
    'activity:lifeDesign': 'Categorizing...',
    'sleep:detect': 'Logging sleep...',
    'chat:classify': 'Thinking...',
    'chat:respond': 'Composing reply...',
    'chat:sideEffects': 'Updating memory...',
    'email:plan': 'Planning...',
    'email:search': 'Searching emails...',
    'email:read': 'Reading emails...',
    'email:filter': 'Filtering results...',
    'email:parse': 'Extracting items...',
    'email:compose': 'Drafting email...',
    'watch:plan': 'Planning search...',
    'watch:fetch': 'Fetching content...',
    'watch:filter': 'Filtering results...',
    'watch:extract': 'Extracting details...',
  };

  // 8. Run pipelines SEQUENTIALLY (E2B is single-threaded)
  const runner = new PipelineRunner((domain: string, state: PipelineState) => {
    // Show user-friendly label for the current running phase
    if (state.status === 'running' && state.currentPhase) {
      const key = `${domain}:${state.currentPhase}`;
      ctx.setSendingStatus(PHASE_LABELS[key] || `Processing...`);

      // Update intent card phase status
      updateIntentStatus(domain, 'running', {
        [state.currentPhase]: { status: 'running' },
      });
    }

    if (state.status === 'complete') {
      // Mark all phases as complete
      const intentCard = intentCards.find(i => i.pipeline === domain);
      if (intentCard) {
        const phaseUpdates: Record<string, { status: string; result?: string }> = {};
        for (const phase of intentCard.phases) {
          phaseUpdates[phase.key] = { status: 'complete' };
        }
        updateIntentStatus(domain, 'complete', phaseUpdates);
      }
    }

    if (state.status === 'error') {
      updateIntentStatus(domain, 'error');
    }
  }, brainId);

  // Log triage result
  const triageSummary = validIntents.map(i => `${i.pipeline}(${(i.confidence * 100).toFixed(0)}%)`).join(', ');
  runner.logger.setTriageSummary(triageSummary);

  const results: PromiseSettledResult<{ type: string; data: any }>[] = [];

  for (const intent of validIntents) {
    console.log(`[Pipeline] Running intent: ${intent.pipeline} (conf: ${intent.confidence})`);
    updateIntentStatus(intent.pipeline, 'running');
    try {
      const result = await runIntent(runner, intent, pipelineInput, (pantryItems, pantryStatus) => {
        // Progressive pantry UI: update message with items as they're identified/checked
        ctx.setMessages(prev => prev.map(m => {
          if (m.id !== progressMsgId) return m;
          return {
            ...m,
            pantryPipelineItems: pantryItems,
            pantryPipelineStatus: pantryStatus as PantryPipelineStatus,
          };
        }));
        ctx.scrollToEnd();
      });
      console.log(`[Pipeline] Intent ${intent.pipeline} DONE`);
      results.push({ status: 'fulfilled', value: result });

      // MEAL: After eating context, run food identification + nutrient pipeline
      if (intent.pipeline === 'meal') {
        try {
          const runIdentify = !intent.inferrablePhases || intent.inferrablePhases.includes('identify');
          let foodResult: any = { foods: [], dishName: '', mealType: intent.context?.mealType };

          if (runIdentify) {
            updateIntentStatus('meal', 'running', {
              identify: { status: 'running' },
            });

            // Get the food identification provider
            const agentEnabled = await getAgentEnabled();
            const foodProvider = (agentEnabled && getAgentProvider()) || await getInferenceProvider();

            // Identify foods from photos
            foodResult = await foodProvider.identifyFoods(photos, text);
            console.log('[Pipeline] Food identification:', foodResult.foods.length, 'foods');

            updateIntentStatus('meal', 'running', {
              identify: { status: 'complete', result: `${foodResult.foods.length} items` },
            });
          }

          // Convert to pipeline items and attach to progress message
          const pipelineFoods = foodIdToPipeline(foodResult);

          ctx.setMessages(prev => prev.map(m => {
            if (m.id !== progressMsgId) return m;
            return { 
              ...m, 
              pipelineFoods,
              mealMetadata: {
                mealName: foodResult.dishName || foodResult.foods.map((f: any) => f.name).slice(0, 3).join(', ') || 'Meal',
                mealType: foodResult.mealType || intent.context?.mealType || 'snack',
                photoTimestamp: photoTime ? photoTime.toISOString() : undefined,
                source: photos.length > 0 ? 'vision' : 'manual'
              }
            };
          }));

          const runNutrients = pipelineFoods.length > 0;
          
          if (runNutrients) {
            // Start nutrient estimation pipeline in background
            updateIntentStatus('meal', 'running', {
              nutrients: { status: 'running' },
            });
            setTimeout(() => {
              ctx.startPipeline(progressMsgId, pipelineFoods);
            }, 300);
          } else {
            // Trigger pipeline completion to save the meal even if skipping nutrient estimation
            setTimeout(() => {
              ctx.startPipeline(progressMsgId, pipelineFoods);
            }, 300);
          }

          // Update the meal result with food data for composeReply
          const lastResult = results[results.length - 1];
          if (lastResult.status === 'fulfilled') {
            lastResult.value.data = {
              ...lastResult.value.data,
              foods: foodResult.foods,
              mealName: foodResult.dishName || foodResult.foods.map((f: any) => f.name).slice(0, 3).join(', ') || 'Meal',
              mealType: foodResult.mealType || intent.context?.mealType,
            };
          }
        } catch (foodErr: any) {
          console.error('[Pipeline] Food identification failed:', foodErr?.message);
          updateIntentStatus('meal', 'running', {
            identify: { status: 'error', result: foodErr?.message },
          });
          // Ensure we still start the pipeline so the UI can clear the processing state
          setTimeout(() => {
            ctx.startPipeline(progressMsgId, []);
          }, 300);
        }
      }

    } catch (error: any) {
      console.error(`[Pipeline] Intent ${intent.pipeline} FAILED:`, error?.message || error);
      console.error(`[Pipeline] Stack:`, error?.stack);
      results.push({ status: 'rejected', reason: error });
      updateIntentStatus(intent.pipeline, 'error');
    }
  }

  // 9. Persist pipeline results to DB
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { type, data } = r.value;

    switch (type) {
      case 'activity':
        if (data?.logName && data?.activityType) {
          try {
            await ctx.persistActivity({
              logName: data.logName,
              activityType: data.activityType,
              duration_min: data.duration_min,
              intensity: data.intensity,
              outdoors: data.environment === 'outdoor',
              location: data.location,
              aeiou: data.aeiou,
              lifeCategories: data.lifeCategories,
              loggedAt: temporal?.loggedAt || new Date().toISOString(),
              source: 'pipeline',
            });
            console.log('[Pipeline] Activity persisted to DB');
          } catch (e: any) {
            console.error('[Pipeline] Failed to persist activity:', e?.message);
          }
        }
        break;

      case 'sleep':
        if (data?.totalMinutes) {
          try {
            await ctx.persistSleep({
              sleepStart: data.sleepStart,
              sleepEnd: data.sleepEnd,
              totalMinutes: data.totalMinutes,
              quality: data.quality,
              energy: data.energy,
              source: 'inferred',
            });
            console.log('[Pipeline] Sleep persisted to DB');
          } catch (e: any) {
            console.error('[Pipeline] Failed to persist sleep:', e?.message);
          }
        }
        break;

      case 'pantry':
        // Persist each identified pantry item to cloud
        if (Array.isArray(data) && data.length > 0) {
          for (const item of data) {
            try {
              await ctx.persistPantryItem({
                foodName: item.name || item.foodName || 'Unknown',
                quantity: item.quantity,
                freshness: item.freshness,
              });
            } catch (e: any) {
              console.error('[Pipeline] Failed to persist pantry item:', item.name, e?.message);
            }
          }
          console.log(`[Pipeline] ${data.length} pantry item(s) persisted to cloud`);
        }
        break;

      // Meal persistence is handled by useNutrientPipeline after
      // all foods complete nutrient estimation
    }
  }

  // 10. Compose reply from all results
  const reply = composeReply(results, validIntents);

  // 11. Finalize pipeline log
  const pipelineLog = runner.logger.finalize();

  // 12. Build and add reply message -- update progress message or create new
  let finalReplyMsgId = progressMsgId;

  if (hasVisibleIntents) {
    // Update the existing progress message with the reply text
    ctx.setMessages(prev => prev.map(m => {
      if (m.id !== progressMsgId) return m;
      return {
        ...m,
        text: reply.text,
        pendingEntries: reply.pendingEntries.length > 0 ? reply.pendingEntries : undefined,
        entriesConfirmed: reply.pendingEntries.length > 0 ? true : undefined,
        pipelineLog,
        emailOrderItems: reply.emailData?.orderItems,
        emailDraft: reply.emailData?.draft,
        emailEvent: reply.emailData?.extractedEvent,
        emailNeedsConnect: reply.emailData?.needsConnect || undefined,
        pantryPipelineItems: reply.pantryPipelineItems,
        pantryPipelineStatus: reply.pantryPipelineStatus,
      };
    }));
  } else {
    // No visible intent cards -- create a regular reply message
    finalReplyMsgId = `m-${Date.now()}`;
    const replyMsg: ChatMessage = {
      id: finalReplyMsgId,
      role: 'mittens',
      text: reply.text,
      timestamp: new Date(),
      pendingEntries: reply.pendingEntries.length > 0 ? reply.pendingEntries : undefined,
      entriesConfirmed: reply.pendingEntries.length > 0 ? true : undefined,
      pipelineLog,
      emailOrderItems: reply.emailData?.orderItems,
      emailDraft: reply.emailData?.draft,
      emailEvent: reply.emailData?.extractedEvent,
      emailNeedsConnect: reply.emailData?.needsConnect || undefined,
      pantryPipelineItems: reply.pantryPipelineItems,
      pantryPipelineStatus: reply.pantryPipelineStatus,
    };
    ctx.addMessage(replyMsg);
  }
  ctx.scrollToEnd();

  // 13. Save reply to local DB
  try {
    const metadata: Record<string, any> = { pipelineLog };
    if (reply.pendingEntries.length > 0) metadata.pendingEntries = reply.pendingEntries;
    if (reply.pantryPipelineItems) {
      metadata.pantryPipelineItems = reply.pantryPipelineItems;
      metadata.pantryPipelineStatus = reply.pantryPipelineStatus;
    }
    const savedReply = await dataProvider.saveMessage({
      role: 'mittens',
      text: reply.text || 'Done!',
      replyToId: tempUserMsgId && !tempUserMsgId.startsWith('t-') ? tempUserMsgId : undefined,
      metadata,
    });
    if (savedReply?.id && finalReplyMsgId) {
      ctx.setMessages(prev => prev.map(m =>
        m.id === finalReplyMsgId
          ? { ...m, id: `db-${savedReply.id}` }
          : m
      ));
    }
  } catch {}

  // 14. TTS if voice-sent
  if (ctx.voiceSentRef.current && reply.text) {
    speak(reply.text);
    ctx.voiceSentRef.current = false;
  }

  // 15. Fire side effects in background (non-blocking).
  //     The agent inside sideEffects decides what to run.
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { type, data } = r.value;
    if (type === 'chat' && typeof data?.runSideEffects === 'function') {
      data.runSideEffects().catch((e: any) =>
        console.warn('[Pipeline] Background side effects failed:', e?.message)
      );
    }
  }
}
