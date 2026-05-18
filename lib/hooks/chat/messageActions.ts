/**
 * messageActions -- Delete message, long press reply, voice auto-send.
 * All local-first operations.
 */

import { Alert, Platform, ActionSheetIOS } from 'react-native';
import { ChatMessage } from '../../../components/chat/ChatBubble';
import { getDataProvider } from '../../providers/providerFactory';
import { InferenceQueue } from '../../services/ai/inferenceQueue';
import { getInferenceProvider } from '../../providers/providerFactory';
import type { ChatContext } from './types';
import { handleMessage } from './handleMessage';

/** Delete a user message + everything after it, restore text to input */
export function doDeleteMessage(
  msg: ChatMessage,
  ctx: ChatContext,
): void {
  Alert.alert(
    'Delete from here?',
    'This will delete this message and all messages after it and put the text back so you can edit and resend.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete & Edit',
        style: 'destructive',
        onPress: async () => {
          const dbIdMatch = msg.id.match(/^db-(\d+)$/);

          if (dbIdMatch) {
            const numericId = parseInt(dbIdMatch[1], 10);

            // Check data mode to decide local vs cloud delete
            const { getDataMode } = require('../../providers/providerFactory');
            const dataMode = await getDataMode();

            try {
              const dataProvider = await getDataProvider();
              if (dataProvider.deleteMessagesSince) {
                await dataProvider.deleteMessagesSince(numericId);
              } else {
                // Fallback to direct DB query if needed
                const { getDb } = require('../../database');
                const db = getDb();
                db.runSync('DELETE FROM mittens_messages WHERE id >= ?', [numericId]);
              }
              
              if (msg.mealMetadata?.logId) {
                const { getDb } = require('../../database');
                const db = getDb();
                db.runSync('DELETE FROM nutrition_logs WHERE id = ?', [msg.mealMetadata.logId]);
                
                // Trigger refresh
                const { nutritionApi } = require('../../services/nutritionApi');
                ctx.dispatch(nutritionApi.util.invalidateTags(['DailySummary', 'MealPlan']));
              }
            } catch (err: any) {
              console.log('[doDeleteMessage] Local delete error:', err);
            }
          }

          // Remove from UI state
          const msgIndex = ctx.messages.findIndex(m => m.id === msg.id);
          if (msgIndex >= 0) {
            ctx.setMessages(prev => prev.slice(0, msgIndex));
          }

          // Restore text to input
          if (msg.text && msg.text !== 'Photo') {
            ctx.setInput(msg.text);
          }
          if (msg.photos && msg.photos.length > 0) {
            ctx.setPendingPhotos(msg.photos);
          }
        },
      },
    ]
  );
}

/** Long press on a message -- show reply option */
export function doLongPress(
  m: ChatMessage,
  setReplyTo: (r: { id: string; text: string } | null) => void,
): void {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Reply', 'Cancel'], cancelButtonIndex: 1 },
      (idx) => {
        if (idx === 0) setReplyTo({ id: m.id, text: m.text.substring(0, 200) });
      }
    );
  } else {
    setReplyTo({ id: m.id, text: m.text.substring(0, 200) });
  }
}

/** Voice final result -- auto-send after short delay */
export function doVoiceFinalResult(
  text: string,
  ctx: ChatContext,
): void {
  if (!text.trim()) return;

  ctx.setInput(text);
  ctx.voiceSentRef.current = true;

  setTimeout(() => {
    ctx.setInput('');
    const finalText = text.trim();
    if (!finalText) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: finalText,
      timestamp: new Date(),
      replyTo: ctx.replyTo || undefined,
    };
    ctx.addMessage(userMsg);
    ctx.setSending(true);
    ctx.setReplyTo?.(null);

    handleMessage(finalText, [], ctx, null, userMsg.id)
      .catch(() => {
        ctx.addMessage({
          id: `e-${Date.now()}`,
          role: 'mittens',
          text: 'Sorry, I had trouble processing that. Can you try again?',
          timestamp: new Date(),
        });
      })
      .finally(() => ctx.setSending(false));
  }, 400);
}

/** Queue a message for later processing (self-hosted Ollama) */
export async function doQueueTask(
  message: ChatMessage,
  ctx: ChatContext,
): Promise<void> {
  const payload = (message as any)._queuePayload;
  if (!payload) return;

  const task = await InferenceQueue.enqueue({
    type: payload.type,
    payload,
    messageId: message.id,
  });

  ctx.setMessages(prev => prev.map(m =>
    m.id === message.id
      ? { ...m, queuePrompt: false, queued: true, queueTaskId: task.id, text: `Queued: "${payload.text || payload.caption || 'Photo'}"` }
      : m
  ));
}

/** Process all queued tasks */
export async function doProcessQueue(
  ctx: ChatContext,
): Promise<{ processed: number; failed: number }> {
  const inferenceProvider = await getInferenceProvider();

  const result = await InferenceQueue.processQueue(
    async (task) => {
      if (task.type === 'text') {
        const response = await inferenceProvider.chat({ message: task.payload.text || '' });
        return response.reply;
      } else {
        const foodResult = await inferenceProvider.identifyFoods(
          task.payload.photos || [],
          task.payload.caption,
        );
        const foodNames = foodResult.foods.map((f: any) => f.name).filter(Boolean);
        return foodNames.length > 0
          ? `I see: ${foodNames.join(', ')}. Want me to log this as a meal?`
          : "I couldn't identify any foods. Can you tell me what you ate?";
      }
    },
    (task, reply) => {
      ctx.setMessages(prev => prev.map(m =>
        m.queueTaskId === task.id
          ? { ...m, text: reply, queued: false, queueTaskId: undefined }
          : m
      ));
      ctx.scrollToEnd();
    },
  );

  if (result.failed > 0) {
    Alert.alert(
      'Queue Processing',
      `Processed ${result.processed}, failed ${result.failed}. Failed tasks will stay in queue.`,
    );
  }

  return result;
}
