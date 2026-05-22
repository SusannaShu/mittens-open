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
      try {
        const { getDb } = require('../../database');
        const db = getDb();
        const now = new Date().toISOString();
        const foodName = data.foodName || data.name || 'Unknown';

        const singularize = (name: string): string => {
          const clean = name.trim().toLowerCase();
          const manualMap: Record<string, string> = {
            'strawberries': 'strawberry',
            'blueberries': 'blueberry',
            'raspberries': 'raspberry',
            'blackberries': 'blackberry',
            'potatoes': 'potato',
            'sweet potatoes': 'sweet potato',
            'tomatoes': 'tomato',
            'avocados': 'avocado',
            'oranges': 'orange',
            'apples': 'apple',
            'bananas': 'banana',
            'carrots': 'carrot',
            'onions': 'onion',
            'cucumbers': 'cucumber',
            'zucchinis': 'zucchini',
            'lemons': 'lemon',
            'limes': 'lime',
            'peaches': 'peach',
            'pears': 'pear',
            'plums': 'plum',
            'peppers': 'pepper',
            'bell peppers': 'bell pepper',
            'mushrooms': 'mushroom',
            'eggs': 'egg',
            'almonds': 'almond',
            'walnuts': 'walnut',
            'nuts': 'nut',
          };
          if (manualMap[clean]) return manualMap[clean];
          if (clean.endsWith('ies')) return clean.slice(0, -3) + 'y';
          if (clean.endsWith('oes')) return clean.slice(0, -2);
          if (clean.endsWith('s') && !clean.endsWith('ss') && !clean.endsWith('us') && !clean.endsWith('is') && !clean.endsWith('as')) {
            return clean.slice(0, -1);
          }
          return clean;
        };

        const sName = singularize(foodName);
        const displayName = sName.charAt(0).toUpperCase() + sName.slice(1);

        const existing = db.getFirstSync(
          'SELECT id, quantity, unit FROM smart_pantry WHERE LOWER(item_name) = ?',
          [sName]
        ) as any;

        const parseQuantityAndUnit = (rawQty: string | number | undefined | null): { qty: number; unit: string } => {
          if (rawQty == null) return { qty: 1, unit: 'whole' };
          if (typeof rawQty === 'number') return { qty: rawQty, unit: 'units' };
          const clean = String(rawQty).trim().toLowerCase();
          if (!clean || clean === 'whole') return { qty: 1, unit: 'whole' };
          const match = clean.match(/^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/);
          if (match) {
            const qty = parseFloat(match[1]) || 1;
            const unit = match[2].trim() || 'units';
            return { qty, unit };
          }
          return { qty: 1, unit: clean };
        };

        const { qty, unit } = parseQuantityAndUnit(data.quantity);

        if (existing) {
          const existingUnit = existing.unit;
          const finalUnit = (existingUnit && (unit === 'units' || unit === 'whole') && existingUnit !== 'units' && existingUnit !== 'whole')
            ? existingUnit
            : unit;
          db.runSync(
            `UPDATE smart_pantry SET quantity = quantity + ?, unit = ?, freshness = ?, updated_at = ?, last_seen_at = ?, last_added_qty = ? WHERE id = ?`,
            [qty, finalUnit, data.freshness || 'fresh', now, now, qty, existing.id]
          );
          return { data: { status: 'ok', id: existing.id } };
        }

        const result = db.runSync(
          `INSERT INTO smart_pantry (item_name, quantity, unit, freshness, confidence, last_seen_at, updated_at, last_added_qty) VALUES (?, ?, ?, ?, 'high', ?, ?, ?)`,
          [displayName, qty, unit, data.freshness || 'fresh', now, now, qty]
        );
        return { data: { status: 'ok', id: result.lastInsertRowId } };
      } catch (e: any) {
        console.error('[Headless] Failed to persist pantry item:', e?.message || e);
        return { data };
      }
    },
    updatePantryItem: async (data: any) => {
      console.log('[Headless] Update pantry item:', data);
      try {
        const { getDb } = require('../../database');
        const db = getDb();
        const sets: string[] = [];
        const vals: any[] = [];
        if (data.foodName !== undefined) { sets.push('item_name = ?'); vals.push(data.foodName); }
        if (data.quantity !== undefined) { sets.push('quantity = ?'); vals.push(parseFloat(data.quantity) || 0); }
        if (data.freshness !== undefined) { sets.push('freshness = ?'); vals.push(data.freshness); }
        sets.push("updated_at = datetime('now')");
        vals.push(data.id);
        if (sets.length > 1) {
          db.runSync(`UPDATE smart_pantry SET ${sets.join(', ')} WHERE id = ?`, vals);
        }
        return { data: { status: 'ok' } };
      } catch (e: any) {
        console.error('[Headless] Failed to update pantry item:', e?.message || e);
        return { data };
      }
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
