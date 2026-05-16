/**
 * @deprecated This monolith hook is superseded by `lib/hooks/chat/useMittensChat.ts`.
 * Kept as reference only. Do not use for new code.
 *
 * useChatHandlers -- Send, photo, text message, and entry management handlers for Chat screen.
 */

import { useState, useRef } from 'react';
import { Alert, Platform, ActionSheetIOS } from 'react-native';
import { useRouter } from 'expo-router';
import { getApiBase, getAuthToken, uploadImage } from '../api';
import { ChatMessage } from '../../components/chat/ChatBubble';
import { PendingEntry } from '../../components/chat/EntryReviewCard';
import { useSmartSnapAsyncMutation, useChatAsyncMutation, useLazyCheckJobStatusQuery, useUpdateSunExposureMutation, useLogConfirmedMutation, useDeleteEntryMutation, useGenerateMealPlanAsyncMutation, nutritionApi } from '../services/nutritionApi';
import { useDispatch } from 'react-redux';
import { useDeleteActivityMutation, useReflectActivityMutation, ActivityEntry } from '../services/activityApi';
import { useDeleteMessagesSinceMutation, useSaveMessageBatchMutation } from '../services/messagesApi';
import { failureApi } from '../services/failureApi';
import { speak } from '../services/ai/voiceService';
import { detectMealTypeFromHour, buildDateLabel } from './chatUtils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FOCUS_TIMER_STORAGE_KEY } from '../../hooks/useFocusTimer';
import { getInferenceMode, getDataMode, getInferenceProvider, getDataProvider, getOllamaConfig, getAgentEnabled, getAgentProvider } from '../providers/providerFactory';
import { ConnectionError, OllamaProvider } from '../providers/ollamaProvider';
import { InferenceQueue } from '../services/ai/inferenceQueue';
import { resizeBase64ForVision, resizeForVision } from '../imageUtils';
import { useNutrientPipeline, foodIdToPipeline } from './useNutrientPipeline';
import type { FoodPipelineItem } from '../../components/chat/MealPipelineCard';

const MAX_PHOTOS = 4;

interface UseChatHandlersOptions {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  addMessage: (msg: ChatMessage) => void;
  saveMessageBatch: ReturnType<typeof useSaveMessageBatchMutation>[0];
  scrollToEnd: () => void;
}

export function useChatHandlers({ messages, setMessages, addMessage, saveMessageBatch, scrollToEnd }: UseChatHandlersOptions) {
  const router = useRouter();
  const dispatch = useDispatch();
  const [sending, setSending] = useState(false);
  const [sendingStatus, setSendingStatus] = useState<string | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; text: string } | null>(null);
  const [fullScreenPhoto, setFullScreenPhoto] = useState<string | null>(null);
  const lastFailedPayload = useRef<{ photos: string[]; caption: string } | null>(null);

  // Activity edit modal state
  const [editingActivity, setEditingActivity] = useState<ActivityEntry | null>(null);
  const [activityEditVisible, setActivityEditVisible] = useState(false);

  // Sleep edit modal state
  const [editingSleep, setEditingSleep] = useState<any | null>(null);
  const [sleepEditVisible, setSleepEditVisible] = useState(false);

  // Fridge inventory state
  const [pantryItems, setPantryItems] = useState<any[]>([]);
  const [showPantry, setShowPantry] = useState(false);
  const [fridgeResult, setFridgeResult] = useState<any>(null);

  // Sun exposure follow-up tracking
  const pendingSunLogId = useRef<number | null>(null);

  // Voice: track if the current message was sent via voice (for TTS reply)
  const voiceSentRef = useRef(false);

  // Photo EXIF timestamps
  const photoTimestampsRef = useRef<Date[] | null>(null);

  // ── Pipeline state management ──
  const updateFood = (messageId: string, index: number, updates: Partial<FoodPipelineItem>) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId || !m.pipelineFoods) return m;
      const foods = [...m.pipelineFoods];
      foods[index] = { ...foods[index], ...updates };
      return { ...m, pipelineFoods: foods };
    }));
  };

  const updateAllFoods = (messageId: string, foods: FoodPipelineItem[]) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, pipelineFoods: foods } : m
    ));
  };

  const { startPipeline, restartFood, restartFoodPortion, addFood, removeFood, replaceWithUsda } = useNutrientPipeline({ updateFood, updateAllFoods });

  // RTK Query mutations (async versions to avoid Heroku timeout)
  const [smartSnapAsync] = useSmartSnapAsyncMutation();
  const [chatAsync] = useChatAsyncMutation();
  const [checkJobStatus] = useLazyCheckJobStatusQuery();
  const [updateSunExposure] = useUpdateSunExposureMutation();
  const [logConfirmed] = useLogConfirmedMutation();
  const [generateMealPlanAsync] = useGenerateMealPlanAsyncMutation();
  const [deleteEntry] = useDeleteEntryMutation();
  const [deleteActivity] = useDeleteActivityMutation();
  const [reflectActivity] = useReflectActivityMutation();
  const [deleteMessagesSince] = useDeleteMessagesSinceMutation();

  /** Poll for async job result. Returns the completed result or throws on failure. */
  const pollForResult = async (jobId: string, maxAttempts = 60, intervalMs = 3000): Promise<any> => {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      const { data } = await checkJobStatus(jobId, false);
      if (data?.status === 'completed') return data.result;
      if (data?.status === 'failed') throw new Error(data.error || 'Job failed');
    }
    throw new Error('Request timed out');
  };

  /** Handle photos captured from camera/gallery */
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

  /** Handle text-only message via chat endpoint (async + polling) */
  const handleTextMessage = async (text: string, refMsg?: { id: string; text: string; metadata?: any } | null) => {
    const inferenceMode = await getInferenceMode();
    const agentEnabled = await getAgentEnabled();
    const agent = agentEnabled ? getAgentProvider() : null;

    // ── AGENT + BRAIN: agent triages, brain handles heavy work ──
    if (agent || inferenceMode === 'ollama') {
      try {
        const dataProvider = await getDataProvider();
        // Save user message
        const savedUserMsg = await dataProvider.saveMessage({ role: 'user', text });
        if (savedUserMsg?.id) {
          setMessages(prev => prev.map(m =>
            m.text === text && m.role === 'user' && m.id.startsWith('u-')
              ? { ...m, id: `db-${savedUserMsg.id}` }
              : m
          ));
        }

        let replyText: string;

        // If agent available: classify intent, handle quick chats locally
        if (agent) {
          const { intent } = await (agent as any).classifyIntent(text);

          if (intent === 'quick_chat') {
            // E2B handles simple greetings / quick questions directly
            const response = await agent.chat({ message: text });
            replyText = response.reply;
          } else {
            // Route to brain for heavy tasks
            const brain = await getInferenceProvider();
            const response = await brain.chat({ message: text });
            replyText = response.reply;
          }
        } else {
          // No agent: send directly to brain (ollama or cloud)
          const brain = await getInferenceProvider();
          const response = await brain.chat({ message: text });
          replyText = response.reply;
        }

        const replyMsg: ChatMessage = {
          id: `m-${Date.now()}`,
          role: 'mittens',
          text: replyText,
          timestamp: new Date(),
        };
        addMessage(replyMsg);
        scrollToEnd();

        // Save reply
        const savedReplyMsg = await dataProvider.saveMessage({ role: 'mittens', text: replyText });
        if (savedReplyMsg?.id) {
          setMessages(prev => prev.map(m =>
            m.id === replyMsg.id ? { ...m, id: `db-${savedReplyMsg.id}` } : m
          ));
        }

        // TTS if voice-sent
        if (voiceSentRef.current && replyText) {
          speak(replyText);
          voiceSentRef.current = false;
        }
      } catch (e: any) {
        // For Ollama: distinguish connection errors from other failures
        if (inferenceMode === 'ollama' && e instanceof ConnectionError) {
          const errMsg: ChatMessage = {
            id: `e-${Date.now()}`,
            role: 'mittens',
            text: `Server unreachable. ${e.message}`,
            timestamp: new Date(),
            queuePrompt: true,
          };
          (errMsg as any)._queuePayload = { type: 'text', text, replyTo: refMsg };
          addMessage(errMsg);
        } else {
          addMessage({
            id: `e-${Date.now()}`,
            role: 'mittens',
            text: `Inference error: ${e.message || 'Unknown error'}`,
            timestamp: new Date(),
          });
        }
        scrollToEnd();
      }
      return;
    }

    // ── CLOUD MODE: existing behavior (unchanged) ──
    const payload: any = refMsg
      ? { message: text, replyTo: refMsg }
      : { message: text };
    const { jobId } = await chatAsync(payload).unwrap();
    const result = await pollForResult(jobId);
    // Invalidate caches since chat can log meals, activities, pantry, etc.
    dispatch(nutritionApi.util.invalidateTags(['DailySummary']));
    if (result.failureLog) {
      dispatch(failureApi.util.invalidateTags(['FailureLog']));
    }

    // Track sun exposure log for follow-ups
    if (result.sunExposure?.detected && result.sunExposure.logId) {
      pendingSunLogId.current = result.sunExposure.logId;
    }

    // Handle sun exposure follow-up update
    if (result.sunExposureUpdate && pendingSunLogId.current) {
      try {
        await updateSunExposure({
          id: pendingSunLogId.current,
          ...result.sunExposureUpdate,
        }).unwrap();
        pendingSunLogId.current = null;
      } catch {
        // Non-blocking
      }
    }

    // Agentic meal plan update
    if (result.mealPlanUpdate && result.mealPlanUpdate.constraint) {
      generateMealPlanAsync({ customConstraint: result.mealPlanUpdate.constraint }).catch(() => { /* non-blocking */ });
    }

    // Determine activity type for display
    const actDet = result.activityDetection;
    const actType = actDet?.detected ? actDet.subtype : (result.sunExposure?.detected ? 'sun_exposure' : undefined);

    // Auto-start focus timer when work activity is detected
    if (actDet?.detected && actDet.subtype === 'work') {
      const existing = await AsyncStorage.getItem(FOCUS_TIMER_STORAGE_KEY);
      if (!existing || parseInt(existing, 10) < Date.now()) {
        const durationMin = actDet.duration_min || 45;
        const endMs = Date.now() + durationMin * 60 * 1000;
        await AsyncStorage.setItem(FOCUS_TIMER_STORAGE_KEY, endMs.toString());
      }
    }

    // Update mapped geofences if Mittens confirmed a new known place
    if (result.knownPlaceUpdate) {
      try {
        const { setCurrentPlaceManual, updateGeofences } = require('../services/location/locationService');
        setCurrentPlaceManual(result.knownPlaceUpdate.name);
        const base = getApiBase();
        const token = getAuthToken();
        const res = await fetch(`${base}/known-places?_limit=-1`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const places = await res.json();
          await updateGeofences(places);
        }
      } catch (err) {
        console.warn('Failed to update known places after chat:', err);
      }
    }

    const pendingEntries: PendingEntry[] = [];
    if (result.knownPlaceUpdate) {
      pendingEntries.push({
        entryType: 'place',
        name: result.knownPlaceUpdate.name,
        placeType: result.knownPlaceUpdate.placeType || 'other',
        _confirmed: true,
      });
    }

    const replyMsg: ChatMessage = {
      id: `m-${Date.now()}`,
      role: 'mittens',
      text: result.reply,
      itemsLogged: result.itemsLogged,
      timestamp: new Date(),
      activityType: actType,
      dataFetched: result.dataFetched || undefined,
      pendingEntries: pendingEntries.length > 0 ? pendingEntries : undefined,
    };
    addMessage(replyMsg);
    scrollToEnd();

    // Speak reply via TTS if the message was sent via voice
    if (voiceSentRef.current && result.reply) {
      speak(result.reply);
      voiceSentRef.current = false;
    }
  };

  /** Handle photo message: classify using first photo and route (async + polling) */
  const handlePhotoMessage = async (photos: string[], caption: string, photoTime?: Date | null, allPhotoTimes?: Date[] | null, localUris?: string[]) => {
    const inferenceMode = await getInferenceMode();
    const agentEnabled = await getAgentEnabled();
    const agent = agentEnabled ? getAgentProvider() : null;

    console.log('[PhotoHandler] mode:', inferenceMode, 'agent:', !!agent, 'photos:', photos.length, 'localUris:', localUris?.length);

    // ── LOCAL INFERENCE: use on-device agent or Ollama vision ──
    if (agent || inferenceMode === 'ollama') {
      try {
        const dataProvider = await getDataProvider();
        const dataMode = await getDataMode();

        // Local file paths for on-device vision (NOT Cloudinary URLs)
        let visionPaths = localUris && localUris.length > 0
          ? localUris.filter(u => u.startsWith('file://') || u.startsWith('/'))
          : [];

        // If no local files (e.g. cloud mode overwrote them), create temp from base64
        if (visionPaths.length === 0 && photos.length > 0) {
          const FileSystem = require('expo-file-system/legacy');
          for (let i = 0; i < photos.length; i++) {
            const tmpPath = FileSystem.cacheDirectory + `vision_${Date.now()}_${i}.jpg`;
            await FileSystem.writeAsStringAsync(tmpPath, photos[i], { encoding: FileSystem.EncodingType.Base64 });
            visionPaths.push(tmpPath);
          }
        }

        console.log('[PhotoHandler] visionPaths:', visionPaths.map(u => u?.substring(0, 60)));

        // Upload photos to Cloudinary when syncing to cloud
        let photoIds: number[] | undefined;
        if (dataMode === 'cloud' && photos.length > 0) {
          const ids: number[] = [];
          for (const b64 of photos) {
            const id = await uploadImage(b64);
            if (id) ids.push(id);
          }
          if (ids.length > 0) photoIds = ids;
        }

        // Save user message with upload IDs (cloud) or local URIs (local)
        const savedMsg = await dataProvider.saveMessage({
          role: 'user',
          text: caption || 'Photo',
          photos: dataMode === 'local' ? visionPaths : (photoIds as any || undefined),
        });

        // Update local message ID so delete works
        if (savedMsg?.id) {
          setMessages(prev => prev.map(m =>
            m.text === (caption || 'Photo') && m.role === 'user' && m.id.startsWith('u-')
              ? { ...m, id: `db-${savedMsg.id}` }
              : m
          ));
        }

        // ── Phase 1: Food identification (pass 1 only -- fast return) ──
        // Use agent (E2B) for food ID when available, otherwise brain
        const foodProvider = agent || await getInferenceProvider();
        console.log('[PhotoHandler] foodProvider:', foodProvider.constructor?.name, 'visionPaths:', visionPaths.length);
        const foodResult = await foodProvider.identifyFoods(visionPaths, caption);

        console.log('[PhotoHandler] foodResult:', foodResult.foods.length, 'foods:', foodResult.foods.map(f => f.name));

        const foodNames = foodResult.foods.map(f => f.name).filter(Boolean);
        const dishLabel = foodResult.dishName || foodNames.slice(0, 3).join(', ');
        const replyText = foodNames.length > 0
          ? `I see ${dishLabel}. Estimating nutrients for each item...`
          : 'I couldn\'t identify any foods. Can you tell me what you ate?';

        // Detect meal type: caption keyword > model's guess > time-of-day fallback
        const captionLower = (caption || '').toLowerCase();
        const captionMealType = captionLower.includes('breakfast') ? 'breakfast'
          : captionLower.includes('lunch') ? 'lunch'
          : captionLower.includes('dinner') ? 'dinner'
          : captionLower.includes('snack') ? 'snack'
          : null;

        // Build pipeline foods (all start as 'idle')
        const pipelineFoods = foodResult.foods.length > 0
          ? foodIdToPipeline(foodResult)
          : undefined;

        // Also keep pendingEntries for log confirmation flow
        const pendingEntries = foodResult.foods.length > 0
          ? [{
              entryType: 'meal' as const,
              name: dishLabel,
              mealType: captionMealType || foodResult.mealType || detectMealTypeFromHour(new Date().getHours()),
              items: foodResult.foods.map(f => ({
                name: f.name,
                portion_g: f.portion_g,
                nutrients: {},
              })),
              _confirmed: false,
            }]
          : undefined;

        const replyMsgId = `m-${Date.now()}`;
        const replyMsg: ChatMessage = {
          id: replyMsgId,
          role: 'mittens',
          text: replyText,
          timestamp: new Date(),
          pipelineFoods,
          pipelineLoadingMore: foodResult.hasMore,
          pendingEntries,
        };
        addMessage(replyMsg);
        scrollToEnd();

        // Save reply
        const savedReply = await dataProvider.saveMessage({
          role: 'mittens', text: replyText,
          metadata: pendingEntries ? { pendingEntries } : undefined,
        });
        // Update reply message ID so delete works
        let finalMsgId = replyMsgId;
        if (savedReply?.id) {
          finalMsgId = `db-${savedReply.id}`;
          setMessages(prev => prev.map(m =>
            m.id === replyMsgId ? { ...m, id: finalMsgId } : m
          ));
        }

        // ── Phase 2+3: Kick off per-food nutrient estimation in background ──
        if (pipelineFoods && pipelineFoods.length > 0) {
          console.log('[PhotoHandler] Starting nutrient pipeline for', finalMsgId, 'foods:', pipelineFoods.length);
          // Use a small delay to ensure the message state has settled
          setTimeout(() => {
            console.log('[PhotoHandler] Pipeline setTimeout fired for', finalMsgId);
            startPipeline(finalMsgId, pipelineFoods);
          }, 300);
        }

        // ── "What else?" pass: find more items in background ──
        if (foodResult.hasMore && 'identifyMoreFoods' in foodProvider) {
          (async () => {
            try {
              console.log('[PhotoHandler] Starting "what else" pass for:', finalMsgId);
              const moreResult = await (foodProvider as any).identifyMoreFoods(visionPaths, foodNames);
              if (moreResult.foods.length > 0) {
                console.log('[PhotoHandler] Found', moreResult.foods.length, 'more items:', moreResult.foods.map((f: any) => f.name));
                const morePipelineFoods = foodIdToPipeline(moreResult);

                // Append new foods to existing message
                setMessages(prev => prev.map(m => {
                  if (m.id === finalMsgId && m.pipelineFoods) {
                    return {
                      ...m,
                      pipelineFoods: [...m.pipelineFoods, ...morePipelineFoods],
                      pipelineLoadingMore: false,
                    };
                  }
                  return m;
                }));

                // Start nutrient estimation for new items
                setTimeout(() => {
                  startPipeline(finalMsgId, morePipelineFoods, pipelineFoods.length);
                }, 300);
              } else {
                // No more items found -- clear loading indicator
                setMessages(prev => prev.map(m =>
                  m.id === finalMsgId ? { ...m, pipelineLoadingMore: false } : m
                ));
              }
            } catch (err) {
              console.log('[PhotoHandler] "What else" pass failed:', err);
              setMessages(prev => prev.map(m =>
                m.id === finalMsgId ? { ...m, pipelineLoadingMore: false } : m
              ));
            }
          })();
        }

      } catch (e: any) {
        // For Ollama: distinguish connection errors from other failures
        if (inferenceMode === 'ollama' && e instanceof ConnectionError) {
          const errMsg: ChatMessage = {
            id: `e-${Date.now()}`,
            role: 'mittens',
            text: `Server unreachable. ${e.message}`,
            timestamp: new Date(),
            queuePrompt: true,
          };
          (errMsg as any)._queuePayload = { type: 'photo', photos: localUris || photos, caption, photoTime: photoTime?.toISOString() };
          addMessage(errMsg);
        } else {
          addMessage({
            id: `e-${Date.now()}`,
            role: 'mittens',
            text: `Local vision error: ${e.message || 'Unknown error'}. Make sure the model is loaded.`,
            timestamp: new Date(),
          });
        }
        scrollToEnd();
      }
      return;
    }

    // ── CLOUD MODE: existing behavior (unchanged) ──
    try {
      const { jobId } = await smartSnapAsync({
        image: photos[0],
        extraImages: photos.slice(1),
        caption: caption || undefined,
        photoTimestamps: allPhotoTimes && allPhotoTimes.length > 0
          ? allPhotoTimes.map(t => t.toISOString())
          : (photoTime ? [photoTime.toISOString()] : undefined),
      }).unwrap();
      const result = await pollForResult(jobId);
      const photoIds = result.imageIds || (result.imageId ? [result.imageId] : undefined);

      const effectiveTime = photoTime || new Date();
      const mealTypeFromTime = detectMealTypeFromHour(effectiveTime.getHours());

      const pendingEntries: PendingEntry[] = JSON.parse(JSON.stringify(result.pendingEntries || []));

      for (const entry of pendingEntries) {
        if (entry.entryType === 'meal' && !entry.mealType) {
          entry.mealType = result.suggestedMealType || mealTypeFromTime;
        }
      }

      if (result.detectedMode === 'fridge') {
        setFridgeResult(result);
        setPantryItems(result.pantry || []);
        const itemCount = result.pantry?.length || 0;
        const fridgeImageUrl = result.imageUrls?.[0] || (pendingEntries[0]?.imageUrl as string) || undefined;
        const fridgeReplyText = `Pantry updated with ${itemCount} item${itemCount !== 1 ? 's' : ''}.`;
        addMessage({
          id: `m-${Date.now()}`,
          role: 'mittens',
          text: fridgeReplyText,
          activityType: 'fridge',
          timestamp: new Date(),
          logEntry: {
            mealName: `Pantry Update`,
            itemCount,
            imageUrl: fridgeImageUrl,
          },
        });
        scrollToEnd();
        // Refresh Today tab data (pantry, meal plan, groceries)
        dispatch(nutritionApi.util.invalidateTags(['DailySummary', 'MealPlan']));
        saveMessageBatch([
          { role: 'user', text: caption || 'Fridge photo', photos: photoIds, activityType: 'fridge' },
          { role: 'mittens', text: fridgeReplyText, activityType: 'fridge', metadata: { logEntry: { mealName: 'Pantry Update', itemCount, imageUrl: fridgeImageUrl } } },
        ]);
      } else {
        const autoLoggedActivities: any[] = result.loggedActivities || [];

        const dateLabel = buildDateLabel(photoTime);

        for (const entry of pendingEntries) {
          if (entry.entryType === 'meal' && photoTime) {
            (entry as any)._photoTimestamp = photoTime.toISOString();
            (entry as any)._dateLabel = dateLabel;
          }
        }

        const activityCards: PendingEntry[] = autoLoggedActivities.map((act: any) => ({
          entryType: 'activity' as const,
          activitySubtype: act.type || 'other',
          name: act.logName || act.type,
          duration_min: act.duration_min,
          _confirmed: true,
          _activityId: act.id,
        }));

        // Auto-log meals immediately
        for (const entry of pendingEntries) {
          if (entry.entryType === 'meal' && entry.items && entry.items.length > 0) {
            try {
              const loggedAt = (entry as any)._photoTimestamp || undefined;
              const res = await logConfirmed({
                mealName: entry.name,
                foods: entry.items,
                mealType: entry.mealType || 'snack',
                imageId: entry.imageId || undefined,
                imageIds: entry.imageIds || undefined,
                loggedAt,
              }).unwrap();
              entry._confirmed = true;
              (entry as any)._logId = res?.ids?.[0];
              generateMealPlanAsync().catch(() => { /* non-blocking */ });
            } catch {
              // Meal log failed -- keep entry so user can retry
            }
          }
        }

        const allEntries = [...pendingEntries, ...activityCards];

        const replyText = result.reply
          || (allEntries.length > 0
            ? `Detected ${allEntries.length} ${allEntries.length === 1 ? 'entry' : 'entries'}${dateLabel}.`
            : result.note || 'Not sure what to do with this one -- tell me more?');

        const detectedMode = result.detectedMode || 'other';

        addMessage({
          id: `m-${Date.now()}`,
          role: 'mittens',
          text: replyText,
          activityType: detectedMode,
          timestamp: new Date(),
          pendingEntries: allEntries.length > 0 ? allEntries : undefined,
          entriesConfirmed: true,
        });
        scrollToEnd();
        saveMessageBatch([
          { role: 'user', text: caption || 'Photo', photos: photoIds, activityType: detectedMode },
          { role: 'mittens', text: replyText, activityType: detectedMode, metadata: {
            pendingEntries: allEntries.map(e => {
              const { ...rest } = e as any;
              return rest;
            }),
            entriesConfirmed: true,
          }},
        ]);
      }
    } catch (err: any) {
      lastFailedPayload.current = { photos, caption };
      addMessage({
        id: `e-${Date.now()}`,
        role: 'mittens',
        text: `I couldn't analyze that photo. ${err.message || 'Try again?'}`,
        timestamp: new Date(),
      });
      scrollToEnd();
    }
  };

  /** Send message (text-only or text+photos) */
  const handleSend = async () => {
    const text = input.trim();
    const photos = [...pendingPhotos];

    if ((!text && photos.length === 0) || sending) return;

    // Photos are now file URIs from picker/camera.
    // Copy to permanent storage for chat display, read base64 for cloud upload.
    let localPhotoUris: string[] = [];
    let base64Photos: string[] = [];
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
            // Download remote photo (e.g. Cloudinary URL from deleted cloud message)
            const download = await FileSystem.downloadAsync(photos[i], permanentPath);
            localPhotoUris.push(download.uri || permanentPath);
          } else {
            // Copy from cache/gallery URI to permanent storage
            await FileSystem.copyAsync({ from: photos[i], to: permanentPath });
            localPhotoUris.push(permanentPath);
          }
          // Read base64 for cloud upload
          const b64 = await FileSystem.readAsStringAsync(localPhotoUris[i], { encoding: FileSystem.EncodingType.Base64 });
          base64Photos.push(b64);
        }
      } catch {
        // Fallback: use original URIs + try reading base64 directly
        localPhotoUris = photos;
        base64Photos = [];
      }
    }

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
    const currentReplyTo = replyTo;
    setReplyTo(null);
    const photoTimes = photoTimestampsRef.current;
    const photoTime = photoTimes && photoTimes.length > 0 ? photoTimes[0] : null;
    setPendingPhotos([]);
    photoTimestampsRef.current = null;
    setSending(true);
    scrollToEnd();

    try {
      if (photos.length > 0) {
        // Pass base64 for cloud upload + local URIs for Gemma
        const photosForUpload = base64Photos.length > 0 ? base64Photos : photos;
        await handlePhotoMessage(photosForUpload, text, photoTime, photoTimes, localPhotoUris);
      } else {
        await handleTextMessage(text, currentReplyTo);
      }
    } catch {
      addMessage({
        id: `e-${Date.now()}`,
        role: 'mittens',
        text: 'Sorry, I had trouble processing that. Can you try again?',
        timestamp: new Date(),
      });
    } finally {
      setSending(false);
      setSendingStatus(null);
    }
  };

  /** Edit a pending entry */
  const handleEditPendingEntry = async (entry: PendingEntry, _index: number) => {
    if (entry.entryType === 'fridge') {
      setShowPantry(true);
    } else if (entry.entryType === 'activity' && entry._activityId) {
      try {
        const base = await getApiBase();
        const token = await getAuthToken();
        const res = await fetch(`${base}/activity-logs/${entry._activityId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const act = await res.json();
          setEditingActivity(act);
          setActivityEditVisible(true);
        }
      } catch { /* fallback: do nothing */ }
    } else if (entry.entryType === 'place') {
      router.push({
        pathname: '/places',
        params: {
          editPlaceName: entry.name,
          editPlaceType: entry.placeType || 'other',
        },
      });
    } else if (entry.entryType === 'meal') {
      let items = entry.items;
      if (!items && (entry as any)._logId) {
        try {
          const base = await getApiBase();
          const token = await getAuthToken();
          const res = await fetch(`${base}/nutrition-logs/${(entry as any)._logId}`, { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            const data = await res.json();
            items = data.items || [];
          }
        } catch { /* fallback */ }
      }

      router.push({
        pathname: '/results',
        params: {
          data: JSON.stringify({ items: items || [], mealName: entry.name }),
          imageId: entry.imageId?.toString() || undefined,
          imageUrl: entry.imageUrl || undefined,
          imageIds: entry.imageIds ? JSON.stringify(entry.imageIds) : undefined,
          mealType: entry.mealType || 'snack',
          photoTimestamp: (entry as any)._photoTimestamp || undefined,
          existingLogId: (entry as any)._logId?.toString() || undefined,
        },
      });
    } else if (entry.entryType === 'other' && entry.activitySubtype === 'rest' && entry._activityId) {
      try {
        const base = await getApiBase();
        const token = await getAuthToken();
        const res = await fetch(`${base}/sleep-logs/${entry._activityId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const sleepData = await res.json();
          setEditingSleep(sleepData);
          setSleepEditVisible(true);
        }
      } catch { /* fallback: do nothing */ }
    }
  };

  /** Delete a logged entry (meal or activity) from backend + UI */
  const handleDismissEntry = (index: number, messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    const entry = msg?.pendingEntries?.[index];
    if (!entry) return;

    const isActivity = entry.entryType === 'activity';
    const backendId = isActivity ? entry._activityId : (entry as any)._logId;

    Alert.alert(
      `Delete ${isActivity ? 'activity' : 'entry'}?`,
      `This will remove "${entry.name}" from your logs.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          if (backendId) {
            try {
              if (isActivity) {
                await deleteActivity(backendId).unwrap();
              } else {
                await deleteEntry(backendId).unwrap();
              }
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Delete failed');
              return;
            }
          }
          setMessages(prev => prev.map(m => {
            if (m.id !== messageId || !m.pendingEntries) return m;
            const updated = [...m.pendingEntries];
            updated.splice(index, 1);
            return { ...m, pendingEntries: updated.length > 0 ? updated : undefined };
          }));
        }},
      ]
    );
  };

  /** Delete a user message + everything after it + restore text to input */
  const handleDeleteMessage = (msg: ChatMessage) => {
    Alert.alert(
      'Delete from here?',
      'This will delete this message and all messages after it, undo any logged meals/activities, and put the text back so you can edit and resend.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete & Edit', style: 'destructive', onPress: async () => {
          const dataMode = await getDataMode();
          const dbIdMatch = msg.id.match(/^db-(\d+)$/);

          if (dataMode === 'local') {
            // Local mode: just remove from local state, no server call
            const msgIndex = messages.findIndex(m => m.id === msg.id);
            if (msgIndex >= 0) {
              setMessages(prev => prev.slice(0, msgIndex));
            }
            if (msg.text && msg.text !== 'Photo') {
              setInput(msg.text);
            }
            if (msg.photos && msg.photos.length > 0) {
              setPendingPhotos(msg.photos);
            }
          } else {
            // Cloud mode: delete from server
            if (dbIdMatch) {
              try {
                await deleteMessagesSince(parseInt(dbIdMatch[1], 10)).unwrap();
              } catch (err: any) {
                Alert.alert('Error', err.message || 'Failed to delete from server');
                return;
              }
            }
            const msgIndex = messages.findIndex(m => m.id === msg.id);
            if (msgIndex >= 0) {
              setMessages(prev => prev.slice(0, msgIndex));
            }
            if (msg.text && msg.text !== 'Photo') {
              setInput(msg.text);
            }
            if (msg.photos && msg.photos.length > 0) {
              setPendingPhotos(msg.photos);
            }
          }
        }},
      ]
    );
  };

  /** Handle long press on a message (reply) */
  const handleLongPress = (m: ChatMessage) => {
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
  };

  /** Handle voice final result -- auto-send after short delay */
  const handleVoiceFinalResult = (text: string) => {
    if (text.trim()) {
      setInput(text);
      voiceSentRef.current = true;
      setTimeout(() => {
        setInput(prev => {
          const finalText = prev.trim();
          if (finalText) {
            const userMsg: ChatMessage = {
              id: `u-${Date.now()}`,
              role: 'user',
              text: finalText,
              timestamp: new Date(),
            };
            addMessage(userMsg);
            setSending(true);
            handleTextMessage(finalText)
              .catch(() => {
                addMessage({
                  id: `e-${Date.now()}`,
                  role: 'mittens',
                  text: 'Sorry, I had trouble processing that. Can you try again?',
                  timestamp: new Date(),
                });
              })
              .finally(() => setSending(false));
          }
          return '';
        });
      }, 400);
    }
  };

  /** Use Flash instead: re-run a failed ollama message with cloud provider */
  const handleUseFlashInstead = async (message: ChatMessage) => {
    const payload = (message as any)._queuePayload;
    if (!payload) return;

    // Remove the queue prompt from the message
    setMessages(prev => prev.map(m =>
      m.id === message.id ? { ...m, queuePrompt: false, text: 'Switching to Flash...' } : m
    ));

    // Force cloud mode for this message
    const { GeminiCloudProvider } = require('../providers/geminiCloudProvider');
    const cloudProvider = new GeminiCloudProvider();

    try {
      if (payload.type === 'text') {
        const response = await cloudProvider.chat({ message: payload.text });
        setMessages(prev => prev.map(m =>
          m.id === message.id ? { ...m, text: response.reply, queuePrompt: false } : m
        ));
      } else {
        // For photos, re-run through cloud flow
        await handlePhotoMessage(payload.photos, payload.caption || '', payload.photoTime ? new Date(payload.photoTime) : null);
      }
    } catch (e: any) {
      setMessages(prev => prev.map(m =>
        m.id === message.id ? { ...m, text: `Flash also failed: ${e.message}`, queuePrompt: false } : m
      ));
    }
  };

  /** Queue a failed ollama message for later processing */
  const handleQueueTask = async (message: ChatMessage) => {
    const payload = (message as any)._queuePayload;
    if (!payload) return;

    const task = await InferenceQueue.enqueue({
      type: payload.type,
      payload,
      messageId: message.id,
    });

    // Update the message to show queued state
    setMessages(prev => prev.map(m =>
      m.id === message.id
        ? { ...m, queuePrompt: false, queued: true, queueTaskId: task.id, text: `Queued: "${payload.text || payload.caption || 'Photo'}"` }
        : m
    ));
  };

  /** Process all queued tasks -- user triggers this manually */
  const handleProcessQueue = async () => {
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
          const foodNames = foodResult.foods.map(f => f.name).filter(Boolean);
          return foodNames.length > 0
            ? `I see: ${foodNames.join(', ')}. Want me to log this as a meal?`
            : 'I couldn\'t identify any foods. Can you tell me what you ate?';
        }
      },
      (task, reply) => {
        // Replace the queued message with the actual reply
        setMessages(prev => prev.map(m =>
          m.queueTaskId === task.id
            ? { ...m, text: reply, queued: false, queueTaskId: undefined }
            : m
        ));
        scrollToEnd();
      },
    );

    if (result.failed > 0) {
      Alert.alert(
        'Queue Processing',
        `Processed ${result.processed}, failed ${result.failed}. Failed tasks will stay in queue.`,
      );
    }

    return result;
  };

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

    // Mutations for ActivityEditModal
    reflectActivity, deleteActivity,

    // Handlers
    handleSend,
    handleTextMessage,
    handlePhotoMessage,
    handlePhotoCapture,
    removePendingPhoto,
    clearPendingPhotos,
    handleEditPendingEntry,
    handleDismissEntry,
    handleDeleteMessage,
    handleLongPress,
    handleVoiceFinalResult,

    // Pipeline handlers
    handlePipelineFoodEdit: (messageId: string, index: number, newName: string) => {
      const msg = messages.find(m => m.id === messageId);
      if (msg?.pipelineFoods) {
        restartFood(messageId, index, newName, msg.pipelineFoods);
      }
    },
    handlePipelineFoodRemove: (messageId: string, index: number) => {
      const msg = messages.find(m => m.id === messageId);
      if (msg?.pipelineFoods) {
        removeFood(messageId, index, msg.pipelineFoods);
      }
    },
    handlePipelinePortionEdit: (messageId: string, index: number, newPortionG: number) => {
      const msg = messages.find(m => m.id === messageId);
      if (msg?.pipelineFoods) {
        restartFoodPortion(messageId, index, newPortionG, msg.pipelineFoods);
      }
    },
    handlePipelineAddFood: (messageId: string, foodName: string) => {
      const msg = messages.find(m => m.id === messageId);
      if (msg?.pipelineFoods) {
        addFood(messageId, foodName, msg.pipelineFoods);
      }
    },
    handlePipelineUsdaReplace: (messageId: string, index: number, usdaFood: any) => {
      const msg = messages.find(m => m.id === messageId);
      if (msg?.pipelineFoods) {
        replaceWithUsda(messageId, index, usdaFood, msg.pipelineFoods);
      }
    },

    // Queue handlers for self-hosted/BYOK
    handleUseFlashInstead,
    handleQueueTask,
    handleProcessQueue,

    // Constants
    MAX_PHOTOS,
  };
}
