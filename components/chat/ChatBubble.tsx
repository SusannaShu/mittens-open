/**
 * ChatBubble -- Reusable chat message bubble.
 * Supports: text-only, single/multi photo+text, mittens reply, inline entry cards.
 */

import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import MapView, { Marker } from 'react-native-maps';
import { colors, fonts, radius, spacing } from '../../lib/theme';
import EntryReviewCard, { PendingEntry } from './EntryReviewCard';
import MealPipelineCard, { FoodPipelineItem } from './MealPipelineCard';
import PipelineLogBubble from './PipelineLogBubble';
import OrderItemCard from './OrderItemCard';
import PantryPipelineCard from './PantryPipelineCard';
import type { PantryPipelineItem, PantryPipelineStatus } from './PantryPipelineCard';
import IntentCardsRow from './IntentCardsRow';
import type { PipelineIntent } from './IntentCardsRow';
import EmailDraftCard from './EmailDraftCard';
import CalendarConfirmCard from './CalendarConfirmCard';
import GmailConnectModal from './GmailConnectModal';
import type { PipelineLog } from '../../lib/pipelines/logger';
import type { EmailOrderItem, EmailDraft, EmailExtractedEvent } from '../../lib/pipelines/types';

/** Resolve photo string to a displayable URI. Handles http URLs, local file paths, and base64. */
function resolvePhotoUri(photo: string): string {
  if (photo.startsWith('http')) return photo;          // Cloudinary URL
  if (photo.startsWith('file://') || photo.startsWith('/')) return photo;  // Local file path
  return `data:image/jpeg;base64,${photo}`;             // Raw base64
}

const DATA_LABELS: Record<string, string> = {
  nutrition: 'nutrition',
  pantry: 'pantry',
  mealPlan: 'meal plan',
  activities: 'activities',
  failures: 'failure log',
  sleep: 'sleep data',
  calendar: 'calendar',
  locationHistory: 'location history',
  messageSearch: 'past conversations',
};

export interface ChatMessage {
  id: string;
  clientId?: string;
  role: 'user' | 'mittens';
  text: string;
  photos?: string[];
  itemsLogged?: number;
  timestamp: Date;
  activityType?: string;
  // Legacy confirmed card fields (kept for old saved messages)
  logEntry?: {
    mealName: string;
    itemCount: number;
    imageUrl?: string;
    logId?: number;
  };
  logEntries?: any[];
  logSummary?: string;
  replyTo?: { id: string; text: string };
  // Inline entry cards (meals + activities)
  pendingEntries?: PendingEntry[];
  entriesConfirmed?: boolean;
  loggedActivities?: any[];
  // What data Mittens pulled for this reply
  dataFetched?: string[];
  // Optional button to jump somewhere in the app
  actionButton?: { label: string; route: string };
  // Location prompt for unnamed places
  locationPrompt?: { latitude: number; longitude: number };
  // Queue states for self-hosted/BYOK inference
  queuePrompt?: boolean;
  queued?: boolean;
  queueTaskId?: string;
  // Per-food pipeline state (phased async)
  pipelineFoods?: FoodPipelineItem[];
  /** Pipeline execution log for debugging */
  pipelineLog?: PipelineLog;
  /** Email pipeline: order items */
  emailOrderItems?: EmailOrderItem[];
  /** Email pipeline: composed draft */
  emailDraft?: EmailDraft;
  /** Email pipeline: extracted calendar event */
  emailEvent?: EmailExtractedEvent;
  /** Email pipeline: needs Gmail connection */
  emailNeedsConnect?: boolean;
  /** Pantry pipeline: identified items for inline card */
  pantryPipelineItems?: PantryPipelineItem[];
  /** Pantry pipeline: overall status */
  pantryPipelineStatus?: PantryPipelineStatus;
  /** Intent-level pipeline states for IntentCardsRow */
  pipelineIntents?: PipelineIntent[];
  /** Metadata for meal logging persistence */
  mealMetadata?: {
    mealName: string;
    mealType: string;
    logId?: number;
    photoTimestamp?: string;
    source?: 'vision' | 'manual';
    imageId?: number;
  };
}

interface ChatBubbleProps {
  message: ChatMessage;
  onPhotoPress?: (base64: string) => void;
  onEditEntry?: (logId: number) => void;
  onActionPress?: (route: string) => void;
  onEditActivity?: (activityId: number) => void;
  onDeleteEntry?: (logId: number, messageId: string) => void;
  onDeleteActivity?: (activityId: number, messageId: string) => void;
  onRetry?: () => void;
  onEditPendingEntry?: (entry: PendingEntry, index: number) => void;
  onDismissEntry?: (index: number, messageId: string) => void;
  onLongPress?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onSwitchBrain?: (message: ChatMessage) => void;
  onQueueTask?: (message: ChatMessage) => void;
  onViewNutrients?: (food: FoodPipelineItem, index: number) => void;
  onFoodEdit?: (messageId: string, index: number, newName: string) => void;
  onPortionEdit?: (messageId: string, index: number, newPortionG: number) => void;
  onFoodRemove?: (messageId: string, index: number) => void;
  onAddFood?: (messageId: string, name: string) => void;
  onViewAllNutrients?: (messageId: string) => void;
  onScrollToEnd?: () => void;
  // Email pipeline handlers
  onAddToCloset?: (item: EmailOrderItem, index: number) => void;
  onSendEmail?: (draft: EmailDraft) => void;
  onAddToCalendar?: (event: EmailExtractedEvent) => void;
  onGmailConnected?: () => void;
  // Pantry pipeline handlers
  onPantryItemEdit?: (messageId: string, index: number, newName: string) => void;
  onPantryItemRemove?: (messageId: string, index: number) => void;
  onPantryAddItem?: (messageId: string, name: string) => void;
}

export default function ChatBubble({ message, onPhotoPress, onRetry, onActionPress, onEditPendingEntry, onDismissEntry, onLongPress, onDelete, onSwitchBrain, onQueueTask, onViewNutrients, onFoodEdit, onPortionEdit, onFoodRemove, onAddFood, onViewAllNutrients, onScrollToEnd, onAddToCloset, onSendEmail, onAddToCalendar, onGmailConnected, onPantryItemEdit, onPantryItemRemove, onPantryAddItem }: ChatBubbleProps) {
  const router = useRouter();
  const isUser = message.role === 'user';
  const isError = message.id.startsWith('e-');
  const photos = message.photos || [];
  const hasPendingEntries = message.pendingEntries && message.pendingEntries.length > 0;
  const hasPipeline = message.pipelineFoods && message.pipelineFoods.length > 0;
  const hasEmailOrders = message.emailOrderItems && message.emailOrderItems.length > 0;
  const hasEmailDraft = !!message.emailDraft;
  const hasEmailEvent = !!message.emailEvent;
  const hasEmailConnect = !!message.emailNeedsConnect;
  const hasPantryPipeline = message.pantryPipelineItems && message.pantryPipelineItems.length > 0;
  const hasPipelineIntents = message.pipelineIntents && message.pipelineIntents.length > 0;

  // Progress-only message: has intent cards but no text/content yet
  const isIntentOnly = !isUser && hasPipelineIntents && !message.text && photos.length === 0;

  // Format time from message timestamp
  const timeStr = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <View>
    <Pressable
      onLongPress={() => onLongPress?.(message)}
      delayLongPress={400}
      style={[styles.row, isUser && styles.rowUser]}
    >
      {/* Delete (x) button for user messages */}
      {isUser && onDelete && (
        <TouchableOpacity
          onPress={() => onDelete(message)}
          style={styles.deleteBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="x" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      )}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleMittens, isIntentOnly && { backgroundColor: 'transparent' }]}>
        {/* Reply reference */}
        {message.replyTo && (
          <View style={{ borderLeftWidth: 2, borderLeftColor: colors.textMuted, paddingLeft: 8, marginBottom: 6, opacity: 0.7 }}>
            <Text style={{ fontSize: 11, color: colors.textMuted }} numberOfLines={2}>{message.replyTo.text}</Text>
          </View>
        )}
        {/* Photos */}
        {photos.length === 1 && (
          <TouchableOpacity onPress={() => onPhotoPress?.(photos[0])} activeOpacity={0.8}>
            <Image
              source={{ uri: resolvePhotoUri(photos[0]) }}
              style={styles.singlePhoto}
              resizeMode="cover"
            />
          </TouchableOpacity>
        )}

        {photos.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoScroll} contentContainerStyle={styles.photoScrollContent}>
            {photos.map((photo, i) => (
              <TouchableOpacity key={i} onPress={() => onPhotoPress?.(photo)} activeOpacity={0.8}>
                <Image
                  source={{ uri: resolvePhotoUri(photo) }}
                  style={styles.multiPhoto}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {photos.length > 1 && (
          <View style={styles.photoCountBadge}>
            <Text style={[styles.photoCountText, isUser && { color: '#CCC' }]}>{photos.length} photos</Text>
          </View>
        )}

        {/* Data sources Mittens checked */}
        {!isUser && message.dataFetched && message.dataFetched.length > 0 && (
          <Text style={styles.dataFetchedTag}>
            Checked: {message.dataFetched.map(d => DATA_LABELS[d] || d).join(', ')}
          </Text>
        )}

        {/* Message text */}
        {message.text ? (
          <Text style={[styles.text, isUser && styles.textUser]}>{message.text}</Text>
        ) : null}

        {/* Pipeline execution log (expandable) */}
        {!isUser && message.pipelineLog && (
          <View style={{ paddingHorizontal: 10, paddingBottom: 4 }}>
            <PipelineLogBubble log={message.pipelineLog} />
          </View>
        )}

        {/* Action Button */}
        {message.actionButton && (
          <TouchableOpacity 
             style={[styles.actionBtn, isUser && styles.actionBtnUser]} 
             onPress={() => {
               if (onActionPress) {
                 onActionPress(message.actionButton!.route);
               } else {
                 try { router.push(message.actionButton!.route as any); } catch {}
               }
             }}
             activeOpacity={0.8}
          >
             <Text style={[styles.actionBtnText, isUser && { color: '#000' }]}>{message.actionButton.label}</Text>
          </TouchableOpacity>
        )}

        {/* Location Map View */}
        {message.locationPrompt && (
          <View style={[styles.mapContainer, { marginHorizontal: 14, marginBottom: 10, marginTop: message.text ? -2 : 10 }]}>
            <MapView
              style={{ flex: 1 }}
              initialRegion={{
                latitude: message.locationPrompt.latitude,
                longitude: message.locationPrompt.longitude,
                latitudeDelta: 0.005,
                longitudeDelta: 0.005,
              }}
              scrollEnabled={false}
              zoomEnabled={false}
              pitchEnabled={false}
              rotateEnabled={false}
              showsUserLocation={false}
            >
              <Marker 
                coordinate={{ latitude: message.locationPrompt.latitude, longitude: message.locationPrompt.longitude }} 
                pinColor="#fc4c02" 
              />
            </MapView>
          </View>
        )}

        {/* Logged items tag removed in favor of EntryReviewCard cards */}

        {/* Queue prompt: server unreachable, offer fallback or queue */}
        {message.queuePrompt && !message.queued && (
          <View style={styles.queuePromptRow}>
            <TouchableOpacity style={styles.queueBtn} onPress={() => onSwitchBrain?.(message)} activeOpacity={0.7}>
              <Feather name="cpu" size={12} color={colors.textPrimary} />
              <Text style={styles.queueBtnText}>Switch brain</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.queueBtn, styles.queueBtnPrimary]} onPress={() => onQueueTask?.(message)} activeOpacity={0.7}>
              <Feather name="clock" size={12} color="#fff" />
              <Text style={[styles.queueBtnText, { color: '#fff' }]}>Queue it</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Queued badge */}
        {message.queued && (
          <View style={styles.queuedBadge}>
            <Feather name="clock" size={12} color="#E67E22" />
            <Text style={styles.queuedText}>Queued -- process when server is on</Text>
          </View>
        )}

        {/* Retry button for error messages */}
        {isError && !message.queuePrompt && onRetry && (
          <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.7}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        )}

        {/* Intent cards row (shown after triage) */}
        {hasPipelineIntents && (
          <View style={[isIntentOnly && { minWidth: 280 }]}>
            <IntentCardsRow
              intents={message.pipelineIntents!}
              renderMealContent={hasPipeline ? () => (
                <MealPipelineCard
                  foods={message.pipelineFoods!}
                  onViewNutrients={onViewNutrients}
                  onFoodEdit={(idx, newName) => onFoodEdit?.(message.id, idx, newName)}
                  onPortionEdit={(idx, newPortionG) => onPortionEdit?.(message.id, idx, newPortionG)}
                  onFoodRemove={(idx) => onFoodRemove?.(message.id, idx)}
                  onAddFood={(name) => onAddFood?.(message.id, name)}
                  onViewAll={() => onViewAllNutrients?.(message.id)}
                  onScrollToEnd={onScrollToEnd}
                />
              ) : undefined}
            />
          </View>
        )}

        {/* Pipeline card (phased async per-food status) -- standalone when no intents */}
        {hasPipeline && !hasPipelineIntents && (
          <View style={[{ paddingHorizontal: 6, paddingBottom: 8 }, !message.text && photos.length === 0 && { minWidth: 280 }]}>
            <MealPipelineCard
              foods={message.pipelineFoods!}
              onViewNutrients={onViewNutrients}
              onFoodEdit={(idx, newName) => onFoodEdit?.(message.id, idx, newName)}
              onPortionEdit={(idx, newPortionG) => onPortionEdit?.(message.id, idx, newPortionG)}
              onFoodRemove={(idx) => onFoodRemove?.(message.id, idx)}
              onAddFood={(name) => onAddFood?.(message.id, name)}
              onViewAll={() => onViewAllNutrients?.(message.id)}
              onScrollToEnd={onScrollToEnd}
            />
          </View>
        )}

        {/* Pantry pipeline card */}
        {hasPantryPipeline && (
          <View style={[{ paddingHorizontal: 6, paddingBottom: 8 }, (!message.text || isIntentOnly) && photos.length === 0 && { minWidth: 280 }]}>
            <PantryPipelineCard
              items={message.pantryPipelineItems!}
              status={message.pantryPipelineStatus || 'complete'}
              onItemEdit={(idx, newName) => onPantryItemEdit?.(message.id, idx, newName)}
              onItemRemove={(idx) => onPantryItemRemove?.(message.id, idx)}
              onAddItem={(name) => onPantryAddItem?.(message.id, name)}
            />
          </View>
        )}

        {/* Inline entry cards (permanent -- no confirm step) */}
        {hasPendingEntries && !hasPipeline && (
          <EntryReviewCard
            entries={message.pendingEntries!}
            onEdit={onEditPendingEntry}
            onDismiss={(index) => onDismissEntry?.(index, message.id)}
          />
        )}

        {/* Email: Gmail connect prompt */}
        {hasEmailConnect && (
          <View style={{ paddingHorizontal: 6, paddingBottom: 8 }}>
            <GmailConnectModal onConnected={onGmailConnected} />
          </View>
        )}

        {/* Email: Order item cards */}
        {hasEmailOrders && (
          <View style={{ paddingHorizontal: 6, paddingBottom: 8 }}>
            <OrderItemCard
              items={message.emailOrderItems!}
              onAddToCloset={onAddToCloset}
            />
          </View>
        )}

        {/* Email: Draft preview card */}
        {hasEmailDraft && (
          <View style={{ paddingHorizontal: 6, paddingBottom: 8 }}>
            <EmailDraftCard
              draft={message.emailDraft!}
              onSend={onSendEmail}
            />
          </View>
        )}

        {/* Email: Calendar event confirmation */}
        {hasEmailEvent && (
          <View style={{ paddingHorizontal: 6, paddingBottom: 8 }}>
            <CalendarConfirmCard
              event={message.emailEvent!}
              onAddToCalendar={onAddToCalendar}
            />
          </View>
        )}
      </View>
    </Pressable>
    {timeStr && !isIntentOnly ? (
      <Text style={[styles.timestamp, isUser && styles.timestampUser]}>{timeStr}</Text>
    ) : null}
    </View>
  );
}

/** Date divider shown between messages on different days */
export function DateDivider({ date }: { date: Date }) {
  const formatted = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>{formatted}</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: 2, alignItems: 'flex-end' },
  rowUser: { justifyContent: 'flex-end' },

  bubble: { maxWidth: '80%', borderRadius: radius.lg, overflow: 'hidden' },
  bubbleMittens: { backgroundColor: '#F2F2F2', borderBottomLeftRadius: 4 },
  bubbleUser: { backgroundColor: '#000', borderBottomRightRadius: 4 },

  timestamp: { fontSize: 10, color: colors.textMuted, marginBottom: spacing.sm, marginTop: 2, opacity: 0.5 },
  timestampUser: { textAlign: 'right' },

  deleteBtn: {
    alignSelf: 'center',
    marginRight: 6,
    padding: 2,
    opacity: 0.4,
  },

  singlePhoto: { width: '100%', aspectRatio: 4 / 3 },
  photoScroll: { maxHeight: 130 },
  photoScrollContent: { paddingHorizontal: 4, paddingTop: 4, gap: 4 },
  multiPhoto: { width: 120, height: 120, borderRadius: 4 },
  photoCountBadge: { paddingHorizontal: 14, paddingTop: 4 },
  photoCountText: { fontSize: 11, color: colors.textMuted, fontWeight: '500' },

  text: { fontSize: 15, color: colors.textPrimary, lineHeight: 21, paddingHorizontal: 14, paddingVertical: 10 },
  textUser: { color: '#FFF' },

  loggedTag: {
    fontSize: 12, color: colors.textMuted, marginTop: -4,
    paddingHorizontal: 14, paddingBottom: 10, fontStyle: 'italic',
  },

  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.md, paddingHorizontal: spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: 12, color: colors.textMuted, marginHorizontal: spacing.md, fontWeight: '500' },

  retryBtn: {
    marginTop: 8, paddingVertical: 6, paddingHorizontal: 14,
    borderRadius: 14, borderWidth: 1, borderColor: colors.textPrimary,
    alignSelf: 'flex-start',
  },
  retryText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },

  dataFetchedTag: {
    fontSize: 11, color: colors.textMuted, fontStyle: 'italic',
    paddingHorizontal: 14, paddingTop: 8, paddingBottom: 0,
  },

  actionBtn: {
    marginHorizontal: 14,
    marginBottom: 10,
    marginTop: -2,
    paddingVertical: 10,
    backgroundColor: '#000',
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnUser: {
    backgroundColor: '#fff',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  mapContainer: {
    height: 120,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  queuePromptRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 10,
    marginTop: 4,
  },
  queueBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  queueBtnPrimary: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  queueBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  queuedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingBottom: 10,
    marginTop: 2,
  },
  queuedText: {
    fontSize: 12,
    color: '#E67E22',
    fontWeight: '500',
  },
});
