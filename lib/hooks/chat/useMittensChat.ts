/**
 * useMittensChat -- The new local-first chat hook.
 *
 * Replaces useChatHandlers with a clean pipeline-based architecture.
 * All inputs go through: triage → parallel pipelines → compose reply.
 * All data goes to local DB first, synced to Backend via sync engine.
 */

import { useState, useRef, useEffect } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { ChatMessage } from '../../../components/chat/ChatBubble';
import { PendingEntry } from '../../../components/chat/EntryReviewCard';
import type { FoodPipelineItem } from '../../../components/chat/MealPipelineCard';
import { ActivityEntry, useDeleteActivityMutation, useReflectActivityMutation, useLogActivityMutation } from '../../services/activityApi';
import { useAddPantryItemMutation, useUpdatePantryItemMutation } from '../../services/profileApi';
import { useLogSleepMutation } from '../../services/schedule/sleepApi';
import { useNutrientPipeline, foodIdToPipeline } from '../useNutrientPipeline';
import type { UseMittensChatOptions, ChatContext } from './types';
import { handleMessage } from './handleMessage';
import { handleEditPendingEntry, handleDismissEntry } from './entryActions';
import { doDeleteMessage, doLongPress, doVoiceFinalResult, doQueueTask, doProcessQueue } from './messageActions';
import { useDispatch } from 'react-redux';
import { updateProfile } from '../../api';
import { invalidateBrainCache, setBrainId } from '../../brain/selector';
import { setInferenceMode, getDataProvider } from '../../providers/providerFactory';
import { nutritionApi } from '../../services/nutritionApi';

const MAX_PHOTOS = 4;

function brainLabel(modelKey: string): string {
  switch (modelKey) {
    case 'gemma-e2b':
      return 'Gemma E2B (on-device)';
    default:
      return modelKey;
  }
}

export function useMittensChat({ messages, setMessages, addMessage, saveMessageBatch, scrollToEnd }: UseMittensChatOptions) {
  const router = useRouter();
  const dispatch = useDispatch();

  // ── Input state ──
  const [sending, setSending] = useState(false);
  const [sendingStatus, setSendingStatus] = useState<string | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; text: string } | null>(null);
  const [fullScreenPhoto, setFullScreenPhoto] = useState<string | null>(null);
  const lastFailedPayload = useRef<{ photos: string[]; caption: string } | null>(null);

  // ── Modal state ──
  const [editingActivity, setEditingActivity] = useState<ActivityEntry | null>(null);
  const [activityEditVisible, setActivityEditVisible] = useState(false);
  const [editingSleep, setEditingSleep] = useState<any | null>(null);
  const [sleepEditVisible, setSleepEditVisible] = useState(false);
  const [brainFallbackError, setBrainFallbackError] = useState<{ msg: string; failedBrain: string } | null>(null);

  // ── Pantry state ──
  const [pantryItems, setPantryItems] = useState<any[]>([]);
  const [showPantry, setShowPantry] = useState(false);
  const [fridgeResult, setFridgeResult] = useState<any>(null);

  const switchBrainAfterError = async (modelKey: string) => {
    // Map modal model keys to brain IDs
    const brainIdMap: Record<string, string> = {
      'gemma-e2b': 'e2b',
      'ollama-selfhost': 'gemma26b',
      'ollama-byok': 'gemma26b',
    };
    const brainId = brainIdMap[modelKey] || modelKey;
    await setBrainId(brainId as any);

    // Set the right inference mode
    const isOllama = modelKey === 'ollama-byok' || modelKey === 'ollama-selfhost';
    if (isOllama) await setInferenceMode('ollama');
    invalidateBrainCache();
    await updateProfile({ aiModel: modelKey }).catch(() => {});
    addMessage({
      id: `brain-${Date.now()}`,
      role: 'mittens',
      text: `Switched brain to ${brainLabel(modelKey)}. Try that message again.`,
      timestamp: new Date(),
    });
    scrollToEnd();
  };

  const showBrainFallbackModal = async (errorMsg: string) => {
    // Use the actual selected brain ID instead of guessing from the error string
    const { getBrainId } = require('../../brain/selector');
    let failedBrain = 'unknown';
    try {
      failedBrain = await getBrainId();
    } catch {
      // Fallback: try to detect from error message
      const lower = errorMsg.toLowerCase();
      if (lower.includes('groq')) failedBrain = 'groq-free';
      else if (lower.includes('openrouter')) failedBrain = 'openrouter-free';
      else if (lower.includes('gemini')) failedBrain = 'gemini-flash';
      else if (lower.includes('claude') || lower.includes('anthropic')) failedBrain = 'claude-sonnet';
    }
    
    setBrainFallbackError({ msg: errorMsg, failedBrain });
  };

  // ── Refs ──
  const voiceSentRef = useRef(false);
  const photoTimestampsRef = useRef<Date[] | null>(null);

  // ── RTK mutations (kept for sync transport) ──
  const [reflectActivity] = useReflectActivityMutation();
  const [deleteActivity] = useDeleteActivityMutation();
  const [logActivity] = useLogActivityMutation();
  const [logSleep] = useLogSleepMutation();
  const [addPantryItem] = useAddPantryItemMutation();
  const [updatePantryItemMut] = useUpdatePantryItemMutation();

  // ── Pipeline state ──
  const updateFood = (messageId: string, index: number, updates: Partial<FoodPipelineItem>) => {
    setMessages(prev => prev.map(m => {
      if ((m.id !== messageId && m.clientId !== messageId) || !m.pipelineFoods) return m;
      const foods = [...m.pipelineFoods];
      foods[index] = { ...foods[index], ...updates };
      return { ...m, pipelineFoods: foods };
    }));
  };

  const updateAllFoods = (messageId: string, foods: FoodPipelineItem[]) => {
    setMessages(prev => prev.map(m =>
      (m.id === messageId || m.clientId === messageId) ? { ...m, pipelineFoods: foods } : m
    ));
  };

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const onPipelineComplete = async (messageId: string, completedFoods: FoodPipelineItem[]) => {
    const msg = messagesRef.current.find(m => m.id === messageId || m.clientId === messageId);
    if (!msg || !msg.mealMetadata) return;

    // Update the intent UI to complete immediately
    setMessages(prev => prev.map(m => {
      if ((m.id !== messageId && m.clientId !== messageId) || !m.pipelineIntents) return m;
      return {
        ...m,
        pipelineIntents: m.pipelineIntents.map(i => {
          if (i.pipeline !== 'meal') return i;
          return {
            ...i,
            status: 'complete',
            phases: i.phases.map(p => 
              p.key === 'nutrients' ? { ...p, status: 'complete' } : p
            )
          };
        })
      };
    }));

    const dataProvider = await getDataProvider();
    
    const items = completedFoods.map(f => ({
      name: f.name,
      portion_g: f.portion_g,
      nutrients: f.nutrients || {},
      usdaRef: f.usedRef ? { fdcId: f.usedRef.fdcId, name: f.usedRef.name } : undefined,
      adjustments: f.adjustments,
      reasoning: f.reasoning,
      retentionChanges: f.retentionChanges,
      interactionChanges: f.interactionChanges,
      cookingSeverity: f.cookingSeverity,
      cookingMethod: f.cookingMethod
    }));

    try {
      if (msg.mealMetadata.logId) {
        // Update existing
        await dataProvider.updateMeal(msg.mealMetadata.logId, {
          items,
          logName: msg.mealMetadata.mealName,
          mealType: msg.mealMetadata.mealType,
        });
      } else {
        // Create new
        const res = await dataProvider.logMeal({
          logName: msg.mealMetadata.mealName,
          mealType: msg.mealMetadata.mealType,
          items,
          source: msg.mealMetadata.source || 'vision',
          imageId: msg.mealMetadata.imageId,
          loggedAt: new Date(msg.timestamp).toISOString(),
        });
        if (res?.id) {
          // Save logId back to message so future edits update it
          setMessages(prev => prev.map(m => {
            if ((m.id !== messageId && m.clientId !== messageId) || !m.mealMetadata) return m;
            return { ...m, mealMetadata: { ...m.mealMetadata, logId: res.id } };
          }));
        }
      }

      // Invalidate RTK cache to refresh Today tab
      dispatch(nutritionApi.util.invalidateTags(['DailySummary', 'MealPlan']));
    } catch (err) {
      console.error('[Pipeline] Failed to persist meal:', err);
    }

    // Update the chat message in DB with finalized pipelineFoods + mealMetadata
    // so the meal card survives app reload
    try {
      let dbId: number | null = null;
      let finalMsg: ChatMessage | undefined;
      
      // Retry up to 5 times (2.5s) to wait for handleMessage to assign a db- id
      for (let i = 0; i < 5; i++) {
        finalMsg = messagesRef.current.find(m => m.id === messageId || m.clientId === messageId);
        dbId = finalMsg?.id?.startsWith('db-') ? parseInt(finalMsg.id.slice(3), 10) : null;
        if (dbId && !isNaN(dbId)) break;
        await new Promise(r => setTimeout(r, 500));
      }

      if (dbId && !isNaN(dbId) && dataProvider.updateMessage) {
        await dataProvider.updateMessage(dbId, {
          metadata: {
            pipelineFoods: completedFoods,
            mealMetadata: finalMsg?.mealMetadata,
          },
        });
      }
    } catch (err) {
      console.error('[Pipeline] Failed to update message with final foods:', err);
    }
  };

  const { startPipeline, restartFood, restartFoodPortion, addFood, removeFood, replaceWithUsda } =
    useNutrientPipeline({ updateFood, updateAllFoods, onPipelineComplete });

  useEffect(() => {
    const { DeviceEventEmitter } = require('react-native');
    const sub = DeviceEventEmitter.addListener('pendantStartPipeline', ({ messageId, foods }: any) => {
      startPipeline(messageId, foods);
    });
    return () => sub.remove();
  }, [startPipeline]);

  // ── Build context ──
  const ctx: ChatContext = {
    messages, setMessages, addMessage, scrollToEnd,
    getMessages: () => messagesRef.current,
    setSending, setSendingStatus,
    setInput, setPendingPhotos,
    setEditingActivity, setActivityEditVisible,
    setEditingSleep, setSleepEditVisible,
    setPantryItems, setShowPantry,
    updateFood, updateAllFoods, startPipeline,
    persistActivity: (data) => logActivity(data).unwrap(),
    persistSleep: (data) => logSleep(data).unwrap(),
    persistPantryItem: (data) => addPantryItem(data).unwrap(),
    updatePantryItem: (data) => updatePantryItemMut(data).unwrap(),
    voiceSentRef, photoTimestampsRef, dispatch,
  };

  // ── Photo capture ──
  const handlePhotoCapture = (photos: string[], timestamps?: Date[]) => {
    if (timestamps && timestamps.length > 0) {
      photoTimestampsRef.current = [...(photoTimestampsRef.current || []), ...timestamps];
    }
    setPendingPhotos(prev => {
      const combined = [...prev, ...photos];
      if (combined.length > MAX_PHOTOS) {
        Alert.alert('Photo Limit', `You can attach up to ${MAX_PHOTOS} photos per message.`);
        return combined.slice(0, MAX_PHOTOS);
      }
      return combined;
    });
  };

  const removePendingPhoto = (index: number) => {
    setPendingPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const clearPendingPhotos = () => {
    setPendingPhotos([]);
  };

  // ── Send (unified: text, photo, or both) ──
  const handleSend = async () => {
    const text = input.trim();
    const photos = [...pendingPhotos];

    if ((!text && photos.length === 0) || sending) return;

    // Store photos to local filesystem
    let localPhotoUris: string[] = [];
    if (photos.length > 0) {
      try {
        const FileSystem = require('expo-file-system/legacy');
        const photosDir = FileSystem.documentDirectory + 'photos/';
        const dirInfo = await FileSystem.getInfoAsync(photosDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(photosDir, { intermediates: true });
        }
        for (let i = 0; i < photos.length; i++) {
          const fileName = `photo_${Date.now()}_${i}.jpg`;
          const permanentPath = photosDir + fileName;
          const isRemote = photos[i].startsWith('http://') || photos[i].startsWith('https://');

          if (isRemote) {
            const download = await FileSystem.downloadAsync(photos[i], permanentPath);
            localPhotoUris.push(download.uri || permanentPath);
          } else {
            await FileSystem.copyAsync({ from: photos[i], to: permanentPath });
            localPhotoUris.push(permanentPath);
          }
        }
      } catch {
        localPhotoUris = photos;
      }
    }

    // Build user message
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      photos: localPhotoUris.length > 0 ? localPhotoUris : (photos.length > 0 ? photos : undefined),
      timestamp: new Date(),
      replyTo: replyTo || undefined,
    };
    addMessage(userMsg);
    setInput('');
    const photoTime = photoTimestampsRef.current?.[0] || null;
    setReplyTo(null);
    setPendingPhotos([]);
    photoTimestampsRef.current = null;
    setSending(true);
    scrollToEnd();

    try {
      const photosForHandler = localPhotoUris.length > 0 ? localPhotoUris : photos;
      await handleMessage(text, photosForHandler, ctx, photoTime, userMsg.id);
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      console.error('[Pipeline] handleSend FAILED:', errorMsg);
      console.error('[Pipeline] Stack:', err?.stack);
      addMessage({
        id: `e-${Date.now()}`,
        role: 'mittens',
        text: `Error: ${errorMsg}`,
        timestamp: new Date(),
      });
      showBrainFallbackModal(errorMsg);
    } finally {
      setSending(false);
      setSendingStatus(null);
    }
  };

  // ── Return (same shape as old useChatHandlers for easy swap) ──
  return {
    // Input state
    input, setInput,
    pendingPhotos, setPendingPhotos,
    replyTo, setReplyTo,
    sending, setSending, sendingStatus,
    fullScreenPhoto, setFullScreenPhoto,
    lastFailedPayload,
    editingActivity, setEditingActivity, activityEditVisible, setActivityEditVisible,
    editingSleep, setEditingSleep, sleepEditVisible, setSleepEditVisible,
    pantryItems, showPantry, setShowPantry, fridgeResult, setFridgeResult,
    brainFallbackError, setBrainFallbackError, switchBrainAfterError,

    // RTK mutations for modals
    reflectActivity, deleteActivity,

    // Handlers
    handleSend,
    handlePhotoCapture,
    removePendingPhoto,
    clearPendingPhotos,
    handleEditPendingEntry: (entry: PendingEntry, index: number) =>
      handleEditPendingEntry(entry, index, ctx, router),
    handleDismissEntry: (index: number, messageId: string) =>
      handleDismissEntry(index, messageId, ctx),
    handleDeleteMessage: (msg: ChatMessage) => doDeleteMessage(msg, ctx),
    handleLongPress: (m: ChatMessage) => doLongPress(m, setReplyTo),
    handleVoiceFinalResult: (text: string) => doVoiceFinalResult(text, ctx),

    // Pipeline food handlers
    handlePipelineFoodEdit: (messageId: string, index: number, newName: string) => {
      const msg = messages.find(m => m.id === messageId || m.clientId === messageId);
      if (msg?.pipelineFoods) restartFood(messageId, index, newName, msg.pipelineFoods);
    },
    handlePipelineFoodRemove: (messageId: string, index: number) => {
      const msg = messages.find(m => m.id === messageId || m.clientId === messageId);
      if (msg?.pipelineFoods) removeFood(messageId, index, msg.pipelineFoods);
    },
    handlePipelinePortionEdit: (messageId: string, index: number, newPortionG: number) => {
      const msg = messages.find(m => m.id === messageId || m.clientId === messageId);
      if (msg?.pipelineFoods) restartFoodPortion(messageId, index, newPortionG, msg.pipelineFoods);
    },
    handlePipelineAddFood: (messageId: string, foodName: string) => {
      const msg = messages.find(m => m.id === messageId || m.clientId === messageId);
      if (msg?.pipelineFoods) addFood(messageId, foodName, msg.pipelineFoods);
    },
    handlePipelineUsdaReplace: (messageId: string, index: number, usdaFood: any) => {
      const msg = messages.find(m => m.id === messageId || m.clientId === messageId);
      if (msg?.pipelineFoods) replaceWithUsda(messageId, index, usdaFood, msg.pipelineFoods);
    },

    // Queue handlers (self-hosted Ollama)
    handleQueueTask: (msg: ChatMessage) => doQueueTask(msg, ctx),
    handleProcessQueue: () => doProcessQueue(ctx),

    MAX_PHOTOS,
  };
}
