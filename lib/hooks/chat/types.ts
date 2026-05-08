import { ChatMessage } from '../../../components/chat/ChatBubble';
import { PendingEntry } from '../../../components/chat/EntryReviewCard';
import { FoodPipelineItem } from '../../../components/chat/MealPipelineCard';
import { ActivityEntry } from '../../services/activityApi';

/**
 * Shared context passed to all handler modules.
 * Contains state refs + setters so handlers can update UI.
 */
export interface ChatContext {
  // Message state
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  addMessage: (msg: ChatMessage) => void;
  scrollToEnd: () => void;

  // Sending state
  setSending: (v: boolean) => void;
  setSendingStatus: (v: string | null) => void;

  // Input state
  setInput: (v: string) => void;
  setPendingPhotos: (v: string[]) => void;

  // Modal triggers
  setEditingActivity: (act: ActivityEntry | null) => void;
  setActivityEditVisible: (v: boolean) => void;
  setEditingSleep: (s: any | null) => void;
  setSleepEditVisible: (v: boolean) => void;

  // Pantry
  setPantryItems: (items: any[]) => void;
  setShowPantry: (v: boolean) => void;

  // Pipeline food state
  updateFood: (messageId: string, index: number, updates: Partial<FoodPipelineItem>) => void;
  updateAllFoods: (messageId: string, foods: FoodPipelineItem[]) => void;
  startPipeline: (messageId: string, foods: FoodPipelineItem[], startIndex?: number) => void;

  // Persistence: save pipeline results to DB via RTK mutations
  /** Persist a completed activity log */
  persistActivity: (data: any) => Promise<any>;
  /** Persist a completed sleep log */
  persistSleep: (data: any) => Promise<any>;
  /** Add a pantry item (after identify) */
  persistPantryItem: (data: { foodName: string; quantity?: string; freshness?: string }) => Promise<any>;
  /** Update a pantry item (after freshness) */
  updatePantryItem: (data: { id: number; foodName?: string; quantity?: string; freshness?: string }) => Promise<any>;

  // Voice
  voiceSentRef: React.MutableRefObject<boolean>;
  photoTimestampsRef: React.MutableRefObject<Date[] | null>;
}

/** Per-domain pipeline status shown in message cards */
export interface DomainStatus {
  status: 'queued' | 'running' | 'complete' | 'error';
  currentPhase?: string;
  result?: any;
  error?: string;
}

/** Pipeline status across all domains for a single message */
export type MessagePipelineStatus = Record<string, DomainStatus>;

export interface UseMittensChatOptions {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  addMessage: (msg: ChatMessage) => void;
  saveMessageBatch: (batch: any[]) => any;
  scrollToEnd: () => void;
}
