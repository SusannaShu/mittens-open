import { ChatContext } from './types';
import { ChatMessage } from '../../../components/chat/ChatBubble';
import { DeviceEventEmitter } from 'react-native';
import { getDataProvider } from '../../providers/providerFactory';

/**
 * Creates a headless ChatContext that can be used by background tasks 
 * (like pendant voice or ambient events) to run the exact same unified pipeline 
 * as the chat tab, without requiring the chat UI to be mounted.
 */
export function createHeadlessContext(
  initialMessage: ChatMessage,
): ChatContext {
  // We keep a local array of messages just for this pipeline execution
  let localMessages: ChatMessage[] = [initialMessage];

  return {
    messages: localMessages,
    setMessages: (updater: any) => {
      if (typeof updater === 'function') {
        localMessages = updater(localMessages);
      } else {
        localMessages = updater;
      }
      
      // In headless mode, we emit the updated messages so the UI can sync if open
      const updatedUserMsg = localMessages.find(m => m.id === initialMessage.id);
      if (updatedUserMsg) {
        DeviceEventEmitter.emit('pendantMessageUpdated', updatedUserMsg);
      }
      
      const replyMsg = localMessages.find(m => m.id !== initialMessage.id);
      if (replyMsg) {
         DeviceEventEmitter.emit('pendantMessageUpdated', replyMsg);
      }
    },
    addMessage: (msg: ChatMessage) => {
      localMessages.push(msg);
      DeviceEventEmitter.emit('pendantMessageAdded', msg);
    },
    scrollToEnd: () => {},
    setSending: () => {},
    setSendingStatus: () => {},
    setInput: () => {},
    setPendingPhotos: () => {},
    setEditingActivity: () => {},
    setActivityEditVisible: () => {},
    setEditingSleep: () => {},
    setSleepEditVisible: () => {},
    setPantryItems: () => {},
    setShowPantry: () => {},
    updateFood: () => {},
    updateAllFoods: () => {},
    startPipeline: () => {},
    persistActivity: async (data: any) => {
      console.log('[Headless] Persist activity:', data);
      const res = await getDataProvider().logActivity(data);
      return { data: { id: res.id, ...data } };
    },
    persistSleep: async (data: any) => {
      console.log('[Headless] Persist sleep:', data);
      const res = await getDataProvider().logSleep(data);
      return { data: { id: res.id, ...data } };
    },
    persistPantryItem: async (data: any) => {
      console.log('[Headless] Persist pantry item:', data);
      return { data };
    },
    updatePantryItem: async (data: any) => {
      console.log('[Headless] Update pantry item:', data);
      return { data };
    },
    voiceSentRef: { current: false },
    photoTimestampsRef: { current: null },
  };
}

/**
 * Runs the unified chat pipeline headlessly (without UI mounted).
 */
export async function runHeadlessPipeline(
  text: string,
  photos: string[],
  audioPath?: string,
  photoTime?: Date,
  source?: string
): Promise<ChatMessage[]> {
  const { handleMessage } = require('./handleMessage');
  
  const pInitMsg: ChatMessage = {
    id: `u-${Date.now()}`,
    role: 'user',
    text: text || '[Photo Capture]',
    audio: audioPath,
    photos: photos.length > 0 ? photos : undefined,
    timestamp: new Date(),
    source: source || 'pendant',
  };

  const ctx = createHeadlessContext(pInitMsg);

  // Handle message updates and creates the reply natively
  try {
    await handleMessage(text, photos, ctx, photoTime, pInitMsg.id, audioPath);
  } catch (err: any) {
    console.error('[Headless] handleMessage failed:', err?.message || err);
    // Add fallback error message
    ctx.addMessage({
      id: `e-${Date.now()}`,
      role: 'mittens',
      text: 'Sorry, I had trouble processing that. Can you try again?',
      timestamp: new Date(),
    });
  }

  return ctx.messages;
}
