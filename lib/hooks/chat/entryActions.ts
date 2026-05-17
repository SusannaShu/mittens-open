/**
 * entryActions -- Edit, dismiss, and delete pending entries.
 * All operations go through local DB + sync queue.
 */

import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { ChatMessage } from '../../../components/chat/ChatBubble';
import { PendingEntry } from '../../../components/chat/EntryReviewCard';
import { getDataProvider } from '../../providers/providerFactory';
import { ActivityEntry } from '../../services/activityApi';
import type { ChatContext } from './types';

/** Edit a pending entry -- opens the appropriate editor */
export async function handleEditPendingEntry(
  entry: PendingEntry,
  _index: number,
  ctx: ChatContext,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  if (entry.entryType === 'fridge') {
    ctx.setShowPantry(true);
  } else if (entry.entryType === 'activity' && entry._activityId) {
    try {
      const dataProvider = await getDataProvider();
      const act = await dataProvider.getActivity?.(entry._activityId);
      if (act) {
        ctx.setEditingActivity(act as ActivityEntry);
        ctx.setActivityEditVisible(true);
      }
    } catch { /* fallback: do nothing */ }
  } else if (entry.entryType === 'meal') {
    const { setResultsPayload } = require('../../resultsPayload');
    let items = entry.data?.foods || entry.items;
    
    // Fallback: fetch from DB if missing
    if ((!items || items.length === 0) && (entry as any)._logId) {
      try {
        const { getDb } = require('../../database');
        const db = getDb();
        const row = db.getFirstSync('SELECT items FROM nutrition_logs WHERE id = ?', [(entry as any)._logId]) as any;
        if (row && row.items) {
          items = JSON.parse(row.items);
        }
      } catch { /* ignore */ }
    }

    setResultsPayload({
      foods: items || [],
      mealMetadata: {
        mealName: entry.data?.logName || entry.name || 'Meal',
        mealType: entry.mealType || 'snack',
        photoTimestamp: entry.loggedAt,
        source: 'pendant',
      }
    });

    router.push({
      pathname: '/results',
      params: {
        source: 'manual',
        type: 'meal',
        existingLogId: (entry as any)._logId?.toString() || undefined,
      },
    } as any);
  } else if (entry.entryType === 'other' && entry.activitySubtype === 'rest' && entry._activityId) {
    try {
      const dataProvider = await getDataProvider();
      const sleepData = await dataProvider.getSleepLog?.(entry._activityId);
      if (sleepData) {
        ctx.setEditingSleep(sleepData);
        ctx.setSleepEditVisible(true);
      }
    } catch { /* fallback: do nothing */ }
  }
}

/** Dismiss/delete a pending entry */
export function handleDismissEntry(
  index: number,
  messageId: string,
  ctx: ChatContext,
): void {
  const msg = ctx.messages.find(m => m.id === messageId || m.clientId === messageId);
  const entry = msg?.pendingEntries?.[index];
  if (!entry) return;

  const isActivity = entry.entryType === 'activity';
  const backendId = isActivity ? entry._activityId : (entry as any)._logId;

  Alert.alert(
    `Delete ${isActivity ? 'activity' : 'entry'}?`,
    `This will remove "${entry.name}" from your logs.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (backendId) {
            try {
              const dataProvider = await getDataProvider();
              if (isActivity) {
                await dataProvider.deleteActivity?.(backendId);
              } else {
                await dataProvider.deleteMeal?.(backendId);
              }
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Delete failed');
              return;
            }
          }
          ctx.setMessages(prev => {
            const next = prev.map(m => {
              if ((m.id !== messageId && m.clientId !== messageId) || !m.pendingEntries) return m;
              const updated = [...m.pendingEntries];
              updated.splice(index, 1);
              
              const newPendingEntries = updated.length > 0 ? updated : undefined;
              
              // Persist the updated pendingEntries to the backend
              // If we have a backendId, we can find the exact message in the DB
              if (backendId) {
                getDataProvider().then(dp => {
                  const { getDb } = require('../../database');
                  const db = getDb();
                  const rows = db.getAllSync('SELECT id, metadata FROM mittens_messages WHERE metadata LIKE ?', [`%${backendId}%`]) as any[];
                  for (const r of rows) {
                    try {
                      const meta = r.metadata ? JSON.parse(r.metadata) : {};
                      let modified = false;
                      
                      if (meta.logIds && Array.isArray(meta.logIds)) {
                         const orig = meta.logIds.length;
                         meta.logIds = meta.logIds.filter((id: any) => id !== backendId);
                         if (meta.logIds.length < orig) modified = true;
                      }
                      
                      if (meta.activityIds && Array.isArray(meta.activityIds)) {
                         const orig = meta.activityIds.length;
                         meta.activityIds = meta.activityIds.filter((id: any) => id !== backendId);
                         if (meta.activityIds.length < orig) modified = true;
                      }

                      if (meta.pendingEntries && Array.isArray(meta.pendingEntries)) {
                        const orig = meta.pendingEntries.length;
                        meta.pendingEntries = meta.pendingEntries.filter((e: any) => {
                           const eId = e.entryType === 'activity' ? e._activityId : e._logId;
                           return eId !== backendId;
                        });
                        if (meta.pendingEntries.length < orig) modified = true;
                        if (meta.pendingEntries.length === 0) delete meta.pendingEntries;
                      }

                      if (modified) {
                        db.runSync('UPDATE mittens_messages SET metadata = ? WHERE id = ?', [JSON.stringify(meta), r.id]);
                      }
                    } catch (e) { /* ignore parse errors */ }
                  }
                }).catch(() => {});
              } else {
                // Fallback to msgDbId if backendId is missing
                const msgDbId = typeof m.id === 'string' && m.id.startsWith('db-') ? parseInt(m.id.replace('db-', ''), 10) : (typeof m.id === 'number' ? m.id : NaN);
                if (!isNaN(msgDbId) && msgDbId > 0) {
                  getDataProvider().then(dp => {
                    const newMetadata = { ...(m.metadata || {}), pendingEntries: newPendingEntries };
                    if (!newPendingEntries) delete newMetadata.pendingEntries;
                    dp.updateMessage?.(msgDbId, { metadata: newMetadata });
                  }).catch(() => {});
                }
              }
              
              return { ...m, pendingEntries: newPendingEntries };
            });
            return next;
          });
        },
      },
    ]
  );
}
