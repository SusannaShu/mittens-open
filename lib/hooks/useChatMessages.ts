/**
 * useChatMessages -- Message loading, pagination, and welcome logic for Chat screen.
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChatMessage } from '../../components/chat/ChatBubble';
import { getApiBase, getAuthToken } from '../api';
import { getUserDisplayName } from '../userContext';
import { useGetProfileQuery } from '../services/profileApi';
import { useGetMessagesQuery, useSaveMessageBatchMutation } from '../services/messagesApi';
import { getDataMode, getDataProvider } from '../providers/providerFactory';

export function useChatMessages() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [scrollReady, setScrollReady] = useState(false);
  const [isLocalMode, setIsLocalMode] = useState(false);
  const needsInitialScroll = useRef(false);
  const welcomeSentRef = useRef(false);
  const lastModeRef = useRef<string | null>(null);

  // Pagination
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [oldestLoaded, setOldestLoaded] = useState<string | null>(null);

  // Detect mode on mount and on changes
  useEffect(() => {
    const checkMode = async () => {
      const mode = await getDataMode();
      setIsLocalMode(mode === 'local');
      if (lastModeRef.current !== null && lastModeRef.current !== mode) {
        // Mode changed -- reset so messages re-load
        setInitialized(false);
        welcomeSentRef.current = false;
      }
      lastModeRef.current = mode;
    };
    checkMode();
  }, []);

  // RTK Query -- skip in local mode (SQLite is sole source of truth)
  const { data: profile } = useGetProfileQuery();
  const { data: messageHistory, isLoading: messagesLoading, isError: messagesError } = useGetMessagesQuery({ limit: 10 }, { skip: isLocalMode });
  const [saveMessageBatch] = useSaveMessageBatchMutation();

  /** Map raw API message to ChatMessage */
  const mapMessage = (m: any): ChatMessage => ({
    id: `db-${m.id}`,
    role: m.role,
    text: m.text || '',
    photos: m.photos && m.photos.length > 0
      ? m.photos.map((p: any) => {
          if (typeof p === 'string') {
            // Relative Backend path -> prepend API base
            if (p.startsWith('/uploads/')) return `${getApiBase()}${p}`;
            return p;
          }
          if (p?.url) {
            const url = p.url;
            if (url.startsWith('/uploads/')) return `${getApiBase()}${url}`;
            return url;
          }
          return null;
        }).filter(Boolean)
      : undefined,
    activityType: m.activityType || undefined,
    itemsLogged: m.metadata?.itemsLogged || undefined,
    logEntry: m.metadata?.logEntry || undefined,
    logEntries: m.metadata?.logEntries || undefined,
    logSummary: m.metadata?.logSummary || undefined,
    pendingEntries: m.metadata?.pendingEntries || undefined,
    entriesConfirmed: m.metadata?.entriesConfirmed || undefined,
    actionButton: m.metadata?.actionButton || undefined,
    locationPrompt: m.metadata?.locationPrompt || undefined,
    pantryPipelineItems: m.metadata?.pantryPipelineItems || undefined,
    pantryPipelineStatus: m.metadata?.pantryPipelineStatus || undefined,
    timestamp: new Date(m.created_at),
  });

  /** Show welcome message for new users / empty history */
  const showWelcome = useCallback(() => {
    const profileName = profile?.name || getUserDisplayName('');
    const welcomeMsg: ChatMessage = {
      id: 'welcome',
      role: 'mittens',
      text: `Hi${profileName ? `, ${profileName}` : ''}. What's on your mind? You can tell me what you ate, snap a photo, or just chat.`,
      timestamp: new Date(),
    };
    setMessages([welcomeMsg]);
    saveMessageBatch([{ role: 'mittens', text: welcomeMsg.text, activityType: 'welcome' }]);
  }, [profile, saveMessageBatch]);

  // Load messages -- mode-aware
  useEffect(() => {
    if (initialized) return;
    if (messagesLoading) return;

    const loadMessages = async () => {
      const mode = await getDataMode();

      if (mode === 'local') {
        // Local mode: SQLite is the sole source of truth
        let localMessages: ChatMessage[] = [];
        try {
          const provider = await getDataProvider();
          const result = await provider.loadMessages(50, 0);
          if (result.messages.length > 0) {
            localMessages = [...result.messages].reverse().map(mapMessage);
          }
        } catch {
          // SQLite not ready yet
        }

        if (localMessages.length > 0) {
          setMessages(localMessages);
          setHasOlder(localMessages.length >= 50);
          setInitialized(true);
          needsInitialScroll.current = true;
        } else {
          setHasOlder(false);
          setInitialized(true);
          setScrollReady(true);
          if (!welcomeSentRef.current) {
            welcomeSentRef.current = true;
            showWelcome();
          }
        }
      } else {
        // Cloud mode: use RTK Query data
        if (messageHistory?.messages && messageHistory.messages.length > 0) {
          const loaded: ChatMessage[] = [...messageHistory.messages].reverse().map(mapMessage);
          setMessages(loaded);
          setOldestLoaded(messageHistory.messages[messageHistory.messages.length - 1]?.created_at || null);
          if (messageHistory.messages.length < 10) setHasOlder(false);
          setInitialized(true);
          needsInitialScroll.current = true;
        } else if (!messagesLoading) {
          setHasOlder(false);
          setInitialized(true);
          setScrollReady(true);
          if (!welcomeSentRef.current) {
            welcomeSentRef.current = true;
            showWelcome();
          }
        }
      }
    };

    loadMessages();
  }, [messageHistory, messagesLoading, messagesError, initialized, isLocalMode, showWelcome]);

  // No proactive check needed anymore since we load past midnight natively

  /** Load older messages when scrolling up */
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasOlder || !oldestLoaded) return;
    setLoadingOlder(true);
    try {
      const res = await fetch(
        `${getApiBase()}/mittens-messages?_limit=20&_sort=created_at:DESC&created_at_lt=${encodeURIComponent(oldestLoaded as string)}`,
        { headers: { 'Content-Type': 'application/json', ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}) } }
      );
      if (!res.ok) throw new Error('Failed to load older messages');
      const data = await res.json();
      const older: any[] = data.messages || data;
      if (!older || older.length === 0) {
        setHasOlder(false);
      } else {
        const mapped: ChatMessage[] = [...older].reverse().map(mapMessage);
        setMessages(prev => [...mapped, ...prev]);
        setOldestLoaded(older[older.length - 1]?.created_at || oldestLoaded);
        if (older.length < 20) setHasOlder(false);
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, hasOlder, oldestLoaded]);

  /** Add message to local state */
  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  // Listen for pendant messages emitted globally
  useEffect(() => {
    const { DeviceEventEmitter } = require('react-native');
    const sub = DeviceEventEmitter.addListener('pendantMessageAdded', (msg: ChatMessage) => {
      addMessage(msg);
      // Persist the message to the DB so it survives app restarts
      saveMessageBatch([{
        role: msg.role,
        text: msg.text,
        activityType: msg.activityType,
        photos: msg.photos,
        metadata: {
          logEntry: msg.logEntry,
          logEntries: msg.logEntries,
          logSummary: msg.logSummary,
          pendingEntries: msg.pendingEntries,
          entriesConfirmed: msg.entriesConfirmed,
          actionButton: msg.actionButton,
          locationPrompt: msg.locationPrompt,
          pantryPipelineItems: msg.pantryPipelineItems,
          pantryPipelineStatus: msg.pantryPipelineStatus,
          itemsLogged: msg.itemsLogged,
          pipelineFoods: (msg as any).pipelineFoods,
          mealMetadata: (msg as any).mealMetadata,
        }
      }]);
    });
    return () => sub.remove();
  }, [addMessage, saveMessageBatch]);

  /** Check if two dates are different days */
  const isDifferentDay = (a: Date, b: Date) => {
    return a.toDateString() !== b.toDateString();
  };

  return {
    messages,
    setMessages,
    initialized,
    scrollReady,
    setScrollReady,
    needsInitialScroll,
    loadingOlder,
    hasOlder,
    loadOlderMessages,
    addMessage,
    isDifferentDay,
    saveMessageBatch,
    profile,
  };
}
