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
    router.push({
      pathname: '/results',
      params: {
        data: JSON.stringify({ items: entry.items || [], mealName: entry.name }),
        mealType: entry.mealType || 'snack',
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
                await dataProvider.deleteEntry?.(backendId);
              }
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Delete failed');
              return;
            }
          }
          ctx.setMessages(prev => prev.map(m => {
            if ((m.id !== messageId && m.clientId !== messageId) || !m.pendingEntries) return m;
            const updated = [...m.pendingEntries];
            updated.splice(index, 1);
            return { ...m, pendingEntries: updated.length > 0 ? updated : undefined };
          }));
        },
      },
    ]
  );
}
