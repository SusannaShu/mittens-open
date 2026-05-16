/**
 * Mittens Chat -- The primary interface.
 * Text, snap photos, talk. AI classifies and routes.
 * Camera + gallery embedded in input bar.
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image, Keyboard,
} from 'react-native';
import { TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { colors, spacing, radius } from '../../lib/theme';
import { ChatMessage, DateDivider } from '../../components/chat/ChatBubble';
import ChatBubble from '../../components/chat/ChatBubble';
import TypingIndicator from '../../components/chat/TypingIndicator';
import ActivityEditModal from '../../components/common/ActivityEditModal';
import SleepEditModal from '../../components/common/SleepEditModal';
import { useUpdateSleepLogMutation, useDeleteSleepLogMutation } from '../../lib/services/schedule/sleepApi';
import FridgePantryOverlay from '../../components/chat/FridgePantryOverlay';
import PhotoViewerModal from '../../components/chat/PhotoViewerModal';
import ChatInputBar from '../../components/chat/ChatInputBar';
import NutrientDetailSheet from '../../components/chat/NutrientDetailSheet';
import BrainFallbackModal from '../../components/chat/BrainFallbackModal';
import type { FoodPipelineItem } from '../../components/chat/MealPipelineCard';
import { useChatMessages } from '../../lib/hooks/useChatMessages';
import { useMittensChat } from '../../lib/hooks/chat';
import { useTodayHandlers } from '../../hooks/useTodayHandlers';
import { ManualEntryModal, ManualEntryType } from '../../components/today/ManualEntryModal';

const MITTENS_ICON = require('../../assets/icon.png');

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ loggedMeal?: string; loggedItemCount?: string; loggedImageUrl?: string; loggedId?: string; prompt?: string; editedLogId?: string; editedItems?: string; editedMealName?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  
  const [updateSleep] = useUpdateSleepLogMutation();
  const [deleteSleep] = useDeleteSleepLogMutation();

  const h = useTodayHandlers(() => {});
  const [manualInitialTab, setManualInitialTab] = useState<ManualEntryType>('meal');

  // Nutrient detail sheet state
  const [detailSheetVisible, setDetailSheetVisible] = useState(false);
  const [detailFood, setDetailFood] = useState<FoodPipelineItem | undefined>();
  const [detailAllFoods, setDetailAllFoods] = useState<FoodPipelineItem[] | undefined>();

  const scrollToEnd = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  // Scroll to bottom when keyboard appears
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      scrollToEnd();
    });
    return () => sub.remove();
  }, []);

  // Message state + pagination
  const {
    messages, setMessages, initialized, scrollReady, setScrollReady,
    needsInitialScroll, loadingOlder, hasOlder, loadOlderMessages,
    addMessage, isDifferentDay, saveMessageBatch,
  } = useChatMessages();

  // All handlers + input state
  const {
    input, setInput, pendingPhotos, setPendingPhotos, replyTo, setReplyTo,
    sending, setSending, sendingStatus, fullScreenPhoto, setFullScreenPhoto,
    lastFailedPayload,
    editingActivity, setEditingActivity, activityEditVisible, setActivityEditVisible,
    editingSleep, setEditingSleep, sleepEditVisible, setSleepEditVisible,
    pantryItems, showPantry, setShowPantry, fridgeResult, setFridgeResult,
    brainFallbackError, setBrainFallbackError, switchBrainAfterError,
    reflectActivity, deleteActivity,
    handleSend,
    handlePhotoCapture, removePendingPhoto, clearPendingPhotos,
    handleEditPendingEntry, handleDismissEntry, handleDeleteMessage,
    handleLongPress, handleVoiceFinalResult,
    handlePipelineFoodEdit, handlePipelinePortionEdit, handlePipelineFoodRemove, handlePipelineAddFood, handlePipelineUsdaReplace,
    MAX_PHOTOS,
  } = useMittensChat({ messages, setMessages, addMessage, saveMessageBatch, scrollToEnd });

  // Handle loggedMeal param from results screen
  const lastLoggedMealRef = useRef<string | null>(null);
  const lastEditedLogRef = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      // Handle edit return: update existing card in-place
      if (params.editedLogId) {
        if (lastEditedLogRef.current === params.editedLogId) return;
        lastEditedLogRef.current = params.editedLogId;

        const editedLogId = parseInt(params.editedLogId, 10);
        const editedItems = params.editedItems ? JSON.parse(params.editedItems) : null;
        const editedMealName = params.editedMealName || '';

        if (editedItems) {
          setMessages(prev => prev.map(m => {
            if (!m.pendingEntries) return m;
            const entryIdx = m.pendingEntries.findIndex(
              (e: any) => e._logId === editedLogId
            );
            if (entryIdx < 0) return m;
            const updated = [...m.pendingEntries];
            updated[entryIdx] = {
              ...updated[entryIdx],
              items: editedItems,
              name: editedMealName || updated[entryIdx].name,
            };
            return { ...m, pendingEntries: updated };
          }));
        }
        router.setParams({ editedLogId: undefined, editedItems: undefined, editedMealName: undefined });
        return;
      }

      if (params.loggedMeal) {
        const logKey = `${params.loggedMeal}-${params.loggedItemCount}-${params.loggedId}`;
        if (lastLoggedMealRef.current === logKey) return;
        lastLoggedMealRef.current = logKey;

        const count = params.loggedItemCount ? parseInt(params.loggedItemCount, 10) : 0;
        const imageUrl = params.loggedImageUrl || undefined;
        const logId = params.loggedId ? parseInt(params.loggedId, 10) : undefined;
        const confirmMsg: ChatMessage = {
          id: `logged-${Date.now()}`,
          role: 'mittens',
          text: `Got it!`,
          pendingEntries: [{
            entryType: 'meal',
            name: params.loggedMeal || 'Meal',
            itemCount: count,
            imageUrl: imageUrl,
            _logId: logId,
            mealType: 'snack', // Default since explicit isn't passed here
          }],
          timestamp: new Date(),
        };
        addMessage(confirmMsg);
        scrollToEnd();
        saveMessageBatch([{
          role: 'mittens',
          text: `Got it!`,
          activityType: 'log_confirm',
          metadata: { pendingEntries: confirmMsg.pendingEntries },
        }]);
        router.setParams({ loggedMeal: undefined, loggedItemCount: undefined, loggedImageUrl: undefined, loggedId: undefined });
      }

      if (params.prompt) {
        setInput(params.prompt);
        router.setParams({ prompt: undefined });
      }
    }, [params.loggedMeal, params.prompt, params.editedLogId])
  );

  // Fridge inventory overlay
  if (showPantry) {
    return (
      <FridgePantryOverlay
        pantryItems={pantryItems}
        fridgeResult={fridgeResult}
        onClose={() => { setShowPantry(false); setFridgeResult(null); }}
      />
    );
  }

  return (
    <>
      <ManualEntryModal
        visible={h.manualModalVisible}
        onClose={() => { h.setManualModalVisible(false); h.setManualPhotos([]); }}
        initialTab={manualInitialTab}
        loggedAt={h.manualLoggedAt}
        onLoggedAtChange={h.setManualLoggedAt}
        text={h.manualText}
        onTextChange={h.setManualText}
        usdaFoods={h.manualUsdaFoods}
        onUsdaFoodsChange={h.setManualUsdaFoods}
        photos={h.manualPhotos}
        onPhotosChange={h.setManualPhotos}
        mealType={h.manualMealType}
        onMealTypeChange={h.setManualMealType}
        analyzing={h.analyzingManual}
        onSubmit={h.handleManualSubmit}
        onSkip={h.handleSkipManual}
        onActivitySubmit={async (data) => {
          try {
            await h.logActivity(data).unwrap();
            h.setManualModalVisible(false);
          } catch (e: any) {
            Alert.alert('Error', e.data?.message || 'Failed to log activity');
          }
        }}
        onSleepSubmit={async (data) => {
          try {
            await h.logSleep(data).unwrap();
            h.setManualModalVisible(false);
          } catch (e: any) {
            Alert.alert('Error', e.data?.message || 'Failed to log sleep');
          }
        }}
      />
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 56}
    >
      {/* Loading state */}
      {!initialized && (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="small" color={colors.textMuted} />
        </View>
      )}
      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={[styles.messageList, !initialized && { display: 'none' }]}
        contentContainerStyle={styles.messageListContent}
        onContentSizeChange={() => {
          if (needsInitialScroll.current) {
            needsInitialScroll.current = false;
            scrollRef.current?.scrollToEnd({ animated: false });
            setTimeout(() => {
              scrollRef.current?.scrollToEnd({ animated: false });
              setScrollReady(true);
            }, 100);
          }
        }}
        onScroll={({ nativeEvent }) => {
          if (nativeEvent.contentOffset.y < 50 && hasOlder && !loadingOlder && initialized) {
            loadOlderMessages();
          }
        }}
        scrollEventThrottle={200}
      >
        {/* Load older indicator */}
        {loadingOlder && (
          <View style={{ alignItems: 'center', paddingVertical: 12 }}>
            <ActivityIndicator size="small" color={colors.textMuted} />
          </View>
        )}
        {hasOlder && !loadingOlder && initialized && messages.length > 0 && (
          <TouchableOpacity onPress={loadOlderMessages} style={{ alignItems: 'center', paddingVertical: 8, marginBottom: 4 }}>
            <Text style={{ fontSize: 13, color: colors.textMuted }}>Load earlier messages</Text>
          </TouchableOpacity>
        )}
        {!hasOlder && initialized && messages.length > 0 && (
          <View style={{ alignItems: 'center', paddingVertical: 8, marginBottom: 4 }}>
            <Text style={{ fontSize: 12, color: colors.textMuted }}>End of messages</Text>
          </View>
        )}

        {messages.map((msg, idx) => {
          const showDate = idx === 0 ||
            isDifferentDay(messages[idx - 1].timestamp, msg.timestamp);
          // Use index suffix to guarantee unique keys even if db-IDs collide
          const key = msg.id.startsWith('db-') ? `${msg.id}-${idx}` : msg.id;

          return (
            <View key={key}>
              {showDate && <DateDivider date={msg.timestamp} />}
              <ChatBubble
                message={msg}
                onPhotoPress={(b64) => setFullScreenPhoto(b64)}
                onRetry={msg.id.startsWith('e-') && lastFailedPayload.current ? async () => {
                  setMessages(prev => prev.filter(m => m.id !== msg.id));
                  const payload = lastFailedPayload.current!;
                  lastFailedPayload.current = null;
                  // Restore failed payload so user can retry via send button
                  if (payload.caption) setInput(payload.caption);
                  if (payload.photos?.length > 0) setPendingPhotos(payload.photos);
                } : undefined}
                onEditPendingEntry={handleEditPendingEntry}
                onDismissEntry={handleDismissEntry}
                onDelete={handleDeleteMessage}
                onLongPress={handleLongPress}
                onActionPress={(route) => {
                  if (route === '/places' || route === '/(tabs)/places') {
                    router.push('/places');
                  } else if (route.includes('openManual=')) {
                    const tab = route.split('openManual=')[1] as ManualEntryType;
                    setManualInitialTab(tab);
                    h.setManualModalVisible(true);
                  } else {
                    router.push(route as any);
                  }
                }}
                onViewNutrients={(food: FoodPipelineItem) => {
                  setDetailFood(food);
                  setDetailAllFoods(undefined);
                  setDetailSheetVisible(true);
                }}
                onFoodEdit={handlePipelineFoodEdit}
                onPortionEdit={handlePipelinePortionEdit}
                onFoodRemove={handlePipelineFoodRemove}
                onAddFood={handlePipelineAddFood}
                onUsdaReplace={handlePipelineUsdaReplace}
                onViewAllNutrients={(messageId: string) => {
                  const m = messages.find(msg => msg.id === messageId);
                  if (m?.pipelineFoods) {
                    setDetailFood(undefined);
                    setDetailAllFoods(m.pipelineFoods);
                    setDetailSheetVisible(true);
                  }
                }}
                onScrollToEnd={scrollToEnd}
              />
            </View>
          );
        })}

        {sending && (
          <View style={styles.typingRow}>
            <Image source={MITTENS_ICON} style={styles.avatar} />
            <View style={styles.typingBubble}>
              <TypingIndicator label={sendingStatus} />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Input area */}
      <ChatInputBar
        input={input}
        setInput={setInput}
        pendingPhotos={pendingPhotos}
        maxPhotos={MAX_PHOTOS}
        replyTo={replyTo}
        sending={sending}
        onSend={handleSend}
        onPhotoCapture={handlePhotoCapture}
        onRemovePhoto={removePendingPhoto}
        onClearPhotos={clearPendingPhotos}
        onClearReply={() => setReplyTo(null)}
        onVoiceFinalResult={handleVoiceFinalResult}
      />

      {/* Full-screen photo viewer */}
      <PhotoViewerModal
        photo={fullScreenPhoto}
        onClose={() => setFullScreenPhoto(null)}
      />
    </KeyboardAvoidingView>

    {/* Activity Edit Modal */}
    <ActivityEditModal
      visible={activityEditVisible}
      activity={editingActivity}
      onClose={() => { setActivityEditVisible(false); setEditingActivity(null); }}
      onSave={async (id, data) => {
        await reflectActivity({ id, ...data }).unwrap();
        setActivityEditVisible(false);
        setEditingActivity(null);
      }}
      onDelete={async (id) => {
        await deleteActivity(id).unwrap();
        setActivityEditVisible(false);
        setEditingActivity(null);
      }}
    />

    {/* Sleep Edit Modal */}
    <SleepEditModal
      visible={sleepEditVisible}
      sleep={editingSleep}
      onClose={() => { setSleepEditVisible(false); setEditingSleep(null); }}
      onSave={async (id, data) => {
        await updateSleep({ id, ...data }).unwrap();
        setSleepEditVisible(false);
        setEditingSleep(null);
      }}
      onDelete={async (id) => {
        await deleteSleep(id).unwrap();
        setSleepEditVisible(false);
        setEditingSleep(null);
      }}
    />

    {/* Nutrient Detail Sheet */}
    <NutrientDetailSheet
      visible={detailSheetVisible}
      onClose={() => setDetailSheetVisible(false)}
      food={detailFood}
      allFoods={detailAllFoods}
    />

    {/* Brain Fallback Modal */}
    <BrainFallbackModal
      visible={!!brainFallbackError}
      errorMsg={brainFallbackError?.msg || ''}
      failedBrain={brainFallbackError?.failedBrain || ''}
      onSelectBrain={async (brainId) => {
        setBrainFallbackError(null);
        await switchBrainAfterError(brainId);
      }}
      onClose={() => setBrainFallbackError(null)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  messageList: { flex: 1 },
  messageListContent: { padding: spacing.md, paddingBottom: spacing.lg },
  typingRow: {
    flexDirection: 'row',
    marginBottom: spacing.md,
    alignItems: 'flex-end',
  },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    marginRight: 8,
  },
  typingBubble: {
    backgroundColor: '#F2F2F2',
    borderRadius: radius.lg,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
});
